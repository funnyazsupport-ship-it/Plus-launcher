'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { useTempRoot, freshRequire } = require('./helpers');

let dir;
let packfile;

before(() => {
  useTempRoot();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plus-pack-'));
  packfile = freshRequire('../src/main/lib/packfile.js');
});

/** Кладёт файл сборки на диск и возвращает путь */
function put(name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

const valid = (over = {}) => ({
  format: 'plus.modpack',
  formatVersion: 2,
  name: 'Техника',
  mc: '1.20.1',
  loader: 'fabric',
  loaderVersion: '0.15.11',
  mods: [
    { source: 'modrinth', projectId: 'AANobbMI', versionId: 'v1', name: 'Sodium', enabled: true },
    { source: 'modrinth', projectId: 'gvQqBUqZ', versionId: 'v2', name: 'Lithium', enabled: true },
  ],
  ...over,
});

describe('чтение файла сборки', () => {
  test('нормальный файл читается', async () => {
    const pack = await packfile.read(put('ok.plusmodpack', valid()));
    assert.equal(pack.name, 'Техника');
    assert.equal(pack.mc, '1.20.1');
    assert.equal(pack.loader, 'fabric');
    assert.equal(pack.mods.length, 2);
    assert.equal(pack.mods[0].name, 'Sodium');
  });

  test('расширение узнаётся', () => {
    assert.ok(packfile.isPackFile('C:/что-то/сборка.plusmodpack'));
    assert.ok(packfile.isPackFile('сборка.PLUSMODPACK'), 'регистр не должен мешать');
    assert.ok(!packfile.isPackFile('сборка.zip'));
    assert.ok(!packfile.isPackFile(null));
  });
});

/*
 * Файл приходит от другого человека — из мессенджера, с флешки. Ни одному
 * его полю верить нельзя: битый или злонамеренный файл должен давать понятную
 * ошибку, а не ронять лаунчер и не подсовывать мусор в установку.
 */
describe('файл из чужих рук проверяется', () => {
  test('не json', async () => {
    await assert.rejects(() => packfile.read(put('bad.plusmodpack', 'просто текст')),
      /не файл сборки/i);
  });

  test('json, но чужого формата', async () => {
    await assert.rejects(() => packfile.read(put('other.plusmodpack', { format: 'curseforge' })),
      /не файл сборки/i);
  });

  test('формат новее, чем лаунчер понимает', async () => {
    await assert.rejects(() => packfile.read(put('new.plusmodpack', valid({ formatVersion: 99 }))),
      /обновите лаунчер/i);
  });

  test('без версии Minecraft', async () => {
    await assert.rejects(() => packfile.read(put('nomc.plusmodpack', valid({ mc: null }))),
      /версия Minecraft/i);
  });

  test('выдуманный загрузчик не принимается', async () => {
    await assert.rejects(() => packfile.read(put('ldr.plusmodpack', valid({ loader: 'мой-загрузчик' }))),
      /загрузчик/i);
  });

  test('несуществующий файл', async () => {
    await assert.rejects(() => packfile.read(path.join(dir, 'нет-такого.plusmodpack')),
      /не открывается/i);
  });

  test('мусорные записи модов отбрасываются, а не ломают чтение', async () => {
    const pack = await packfile.read(put('junk.plusmodpack', valid({
      mods: [
        { source: 'modrinth', projectId: 'AANobbMI', name: 'Sodium' },
        { source: 'откуда-то', projectId: 'x', name: 'Левый' },      // чужой источник
        { projectId: 123 },                                          // id не строка
        null,
      ],
    })));
    assert.equal(pack.mods.length, 1, 'остаться должен только пригодный мод');
    assert.equal(pack.skipped, 3, 'а про отброшенные надо сказать честно');
  });

  test('список на тысячи модов обрезается', async () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({
      source: 'modrinth', projectId: `p${i}`, name: `Мод ${i}`,
    }));
    const pack = await packfile.read(put('many.plusmodpack', valid({ mods: many })));
    assert.equal(pack.mods.length, 300);
  });

  test('слишком длинные названия подрезаются', async () => {
    const pack = await packfile.read(put('long.plusmodpack', valid({
      name: 'я'.repeat(5000),
      mods: [{ source: 'modrinth', projectId: 'p', name: 'м'.repeat(5000) }],
    })));
    assert.ok(pack.name.length <= 120);
    assert.ok(pack.mods[0].name.length <= 120);
  });

  test('огромный файл не читается целиком', async () => {
    const huge = path.join(dir, 'huge.plusmodpack');
    fs.writeFileSync(huge, 'x'.repeat(3 * 1024 * 1024));
    await assert.rejects(() => packfile.read(huge), /большой/i);
  });
});

/*
 * Моды, которых нет в каталогах, едут в архиве файлами — иначе они терялись бы
 * при переносе сборки. Архив пришёл от постороннего, поэтому проверяем и то,
 * что распаковывается, и то, что распаковаться не должно.
 */
describe('вложенные моды в архиве', () => {
  const AdmZip = require('adm-zip');

  /** Собирает архив сборки руками, как это делает экспорт */
  function pack(name, entries, manifest = valid()) {
    const zip = new AdmZip();
    zip.addFile('pack.json', Buffer.from(JSON.stringify(manifest), 'utf8'));
    for (const [entryName, content] of entries) {
      zip.addFile(entryName, Buffer.from(content));
    }
    const file = path.join(dir, name);
    fs.writeFileSync(file, zip.toBuffer());
    return file;
  }

  test('вложенный мод виден при чтении', async () => {
    const file = pack('with-mods.plusmodpack', [['mods/самоделка.jar', 'содержимое мода']],
      valid({ bundled: [{ file: 'самоделка.jar', enabled: true }] }));
    const p = await packfile.read(file);
    assert.equal(p.bundled.length, 1);
    assert.equal(p.bundled[0].file, 'самоделка.jar');
    assert.equal(p.mods.length, 2, 'моды из каталога тоже на месте');
  });

  test('выключенный мод остаётся выключенным', async () => {
    const file = pack('off.plusmodpack', [['mods/off.jar', 'x']],
      valid({ bundled: [{ file: 'off.jar', enabled: false }] }));
    const p = await packfile.read(file);
    assert.equal(p.bundled[0].enabled, false);
  });

  test('файл, которого нет в описании, всё равно распакуется', async () => {
    // описание мог подправить кто угодно — верим тому, что реально лежит в архиве
    const file = pack('extra.plusmodpack', [['mods/забытый.jar', 'x']], valid({ bundled: [] }));
    const p = await packfile.read(file);
    assert.equal(p.bundled.length, 1);
    assert.equal(p.bundled[0].enabled, true, 'без пометки считаем включённым');
  });

  test('посторонние файлы в архиве не подхватываются', async () => {
    const file = pack('junk.plusmodpack', [
      ['mods/нормальный.jar', 'x'],
      ['mods/записка.txt', 'x'],
      ['где-то-ещё/чужой.jar', 'x'],
      ['вирус.exe', 'x'],
    ], valid({ bundled: [] }));
    const p = await packfile.read(file);
    assert.deepEqual(p.bundled.map((b) => b.file), ['нормальный.jar']);
  });

  test('попытка выйти из папки модов обезвреживается', async () => {
    const file = pack('escape.plusmodpack', [['mods/../../злой.jar', 'x']], valid({ bundled: [] }));
    const p = await packfile.read(file);
    // либо запись отброшена, либо имя очищено до безобидного — но не путь наружу
    for (const b of p.bundled) {
      assert.ok(!b.file.includes('..'), `осталось «${b.file}»`);
      assert.ok(!b.file.includes('/') && !b.file.includes('\\'), `осталось «${b.file}»`);
    }
  });

  test('старый формат без архива по-прежнему открывается', async () => {
    const old = put('old.plusmodpack', valid({ formatVersion: 1, bundled: undefined }));
    const p = await packfile.read(old);
    assert.equal(p.mods.length, 2);
    assert.deepEqual(p.bundled, [], 'вложенных модов там просто нет');
  });

  test('архив без описания за сборку не принимается', async () => {
    const zip = new AdmZip();
    zip.addFile('mods/что-то.jar', Buffer.from('x'));
    const file = path.join(dir, 'nomanifest.plusmodpack');
    fs.writeFileSync(file, zip.toBuffer());
    await assert.rejects(() => packfile.read(file), /не файл сборки/i);
  });
});
