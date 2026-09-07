'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { useTempRoot, freshRequire } = require('./helpers');

/*
 * Полный путь работы с миром: список — переименование — удаление.
 *
 * Проверяется на настоящих папках во временной корневой: миры лежат на диске,
 * копия перед удалением делается настоящая. Папку игрока это не трогает.
 */
describe('миры сборки от начала до конца', () => {
  const root = useTempRoot();
  let worlds;
  let config;
  let nbt;
  let saves;

  const INST = { id: 'inst1', name: 'Тест', mc: '1.20.1', folder: '1.20.1', loader: 'vanilla' };

  /** Пишет мир на диск: папка, level.dat с названием и что-нибудь внутри */
  function makeWorld(folder, title) {
    const dir = path.join(saves, folder);
    fs.mkdirSync(path.join(dir, 'region'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'region', 'r.0.0.mca'), Buffer.alloc(4096));
    const level = {
      name: '',
      value: {
        Data: {
          __type: nbt.TAG.COMPOUND,
          value: {
            LevelName: { __type: nbt.TAG.STRING, value: title },
            DayTime: { __type: nbt.TAG.LONG, value: 12345n },
          },
        },
      },
    };
    fs.writeFileSync(path.join(dir, 'level.dat'), zlib.gzipSync(nbt.write(level)));
    return dir;
  }

  before(() => {
    config = freshRequire('../src/main/lib/config');
    nbt = require('../src/main/lib/nbt');
    worlds = require('../src/main/lib/worlds');
    config.save({ instances: [INST] });
    saves = path.join(root, INST.folder, 'saves');
    fs.mkdirSync(saves, { recursive: true });
  });

  test('в списке только настоящие миры', async () => {
    makeWorld('Мир-1', 'Первый');
    makeWorld('flat', 'Плоскость');
    // папка без level.dat — не мир, а мусор рядом
    fs.mkdirSync(path.join(saves, 'не-мир'), { recursive: true });

    const list = await worlds.list(INST.id);
    assert.deepEqual(list.map((w) => w.folder).sort(), ['flat', 'Мир-1']);

    // название берётся из level.dat, а не из имени папки
    assert.equal(list.find((w) => w.folder === 'flat').name, 'Плоскость');
    assert.ok(list.every((w) => w.size > 0), 'размер мира должен считаться');
  });

  test('переименование меняет и название, и папку', async () => {
    makeWorld('Мир-2', 'Старое');
    const r = await worlds.rename(INST.id, 'Мир-2', 'Совсем новое');

    assert.equal(r.folder, 'Совсем новое');
    assert.ok(!fs.existsSync(path.join(saves, 'Мир-2')), 'прежняя папка должна исчезнуть');

    const list = await worlds.list(INST.id);
    const found = list.find((w) => w.folder === 'Совсем новое');
    assert.equal(found.name, 'Совсем новое');

    // регион на месте: мир переехал целиком, а не потерялся
    assert.ok(fs.existsSync(path.join(saves, 'Совсем новое', 'region', 'r.0.0.mca')));
  });

  test('занятое имя папки не отбирается у соседа', async () => {
    makeWorld('Занято', 'Занято');
    makeWorld('Другой', 'Другой');

    const r = await worlds.rename(INST.id, 'Другой', 'Занято');
    assert.equal(r.name, 'Занято', 'название всё равно меняется');
    assert.equal(r.folder, 'Другой', 'а папка остаётся своей');
    assert.ok(fs.existsSync(path.join(saves, 'Занято', 'level.dat')), 'чужой мир не перезаписан');
  });

  test('удаление сначала делает копию', async () => {
    makeWorld('Ненужный', 'Ненужный');
    const r = await worlds.remove(INST.id, 'Ненужный');

    assert.ok(!fs.existsSync(path.join(saves, 'Ненужный')), 'мир должен исчезнуть');
    assert.match(r.backup, /\.zip$/);

    const backups = require('../src/main/lib/backups');
    const copies = await backups.list(INST.id);
    assert.ok(copies.some((b) => b.file === r.backup), 'копия должна быть в списке');

    // и она не пустая: внутри лежит сам мир
    const AdmZip = require('adm-zip');
    const names = new AdmZip(copies.find((b) => b.file === r.backup).path)
      .getEntries().map((e) => e.entryName);
    assert.ok(names.some((n) => n.includes('level.dat')), 'в копии нет level.dat');
  });

  test('чужой папкой в имени не выйти из saves', async () => {
    await assert.rejects(() => worlds.rename(INST.id, '../../config.json', 'Хоп'), /Недопустимое имя|не найден/);
    await assert.rejects(() => worlds.remove(INST.id, '..'), /Недопустимое имя|не найден/);
  });

  test('несуществующий мир — понятный отказ, а не поломка', async () => {
    await assert.rejects(() => worlds.remove(INST.id, 'нет-такого'), /Мир не найден/);
  });
});
