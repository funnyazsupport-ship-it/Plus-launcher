'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { useTempRoot, freshRequire } = require('./helpers');

let root;
let config;
let cleanup;

before(() => { root = useTempRoot(); });

beforeEach(() => {
  try { fs.rmSync(path.join(root, 'versions'), { recursive: true }); } catch { /* могло не быть */ }
  try { fs.unlinkSync(path.join(root, 'config.json')); } catch { /* могло не быть */ }
  config = freshRequire('../src/main/lib/config.js');
  cleanup = freshRequire('../src/main/lib/cleanup.js');
});

/** Кладёт версию на диск так, как её видит лаунчер */
function putVersion(id, json = {}) {
  const dir = path.join(root, 'versions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, ...json }));
}

describe('какие версии считаются нужными', () => {
  test('версия используемой сборки остаётся', async () => {
    putVersion('1.20.1');
    config.save({ instances: [{ id: 'i1', versionId: '1.20.1' }] });

    const { kept, broken } = await cleanup.keptVersions();
    assert.ok(kept.has('1.20.1'));
    assert.equal(broken.length, 0);
  });

  test('родительская версия загрузчика тоже остаётся', async () => {
    // моды ставятся на fabric-loader-..., но без родителя 1.20.1 игра не запустится
    putVersion('fabric-loader-0.15.11-1.20.1', { inheritsFrom: '1.20.1' });
    putVersion('1.20.1');
    config.save({ instances: [{ id: 'i1', versionId: 'fabric-loader-0.15.11-1.20.1' }] });

    const { kept } = await cleanup.keptVersions();
    assert.ok(kept.has('fabric-loader-0.15.11-1.20.1'), 'сама версия сборки');
    assert.ok(kept.has('1.20.1'), 'и её родитель');
  });

  test('чужая версия в набор нужных не попадает', async () => {
    putVersion('1.20.1');
    putVersion('1.16.5');
    config.save({ instances: [{ id: 'i1', versionId: '1.20.1' }] });

    const { kept } = await cleanup.keptVersions();
    assert.ok(!kept.has('1.16.5'));
  });

  /*
   * Если json версии не читается, состав её библиотек неизвестен. Такую версию
   * помечаем сломанной — по ней уборка обязана отказаться трогать библиотеки,
   * иначе удалит нужное и сломает запуск.
   */
  test('нечитаемая версия помечается сломанной', async () => {
    const dir = path.join(root, 'versions', 'битая');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'битая.json'), 'это не json');
    config.save({ instances: [{ id: 'i1', versionId: 'битая' }] });

    const { broken } = await cleanup.keptVersions();
    assert.deepEqual(broken, ['битая']);
  });

  test('уборка отказывается чистить библиотеки, пока есть сломанная версия', async () => {
    const dir = path.join(root, 'versions', 'битая');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'битая.json'), 'это не json');
    config.save({ instances: [{ id: 'i1', versionId: 'битая' }] });

    const res = await cleanup.scan();
    assert.ok(res.warning, 'должно быть предупреждение');
    const risky = (res.groups || []).filter((g) => g.id === 'libraries' || g.id === 'assets');
    assert.equal(risky.length, 0, 'библиотеки и ресурсы трогать нельзя');
  });

  test('циклическая ссылка версий не вешает обход', async () => {
    putVersion('a', { inheritsFrom: 'b' });
    putVersion('b', { inheritsFrom: 'a' });
    config.save({ instances: [{ id: 'i1', versionId: 'a' }] });

    const { kept } = await cleanup.keptVersions();
    assert.ok(kept.has('a') && kept.has('b'));
  });
});
