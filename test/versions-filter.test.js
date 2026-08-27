'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const { useTempRoot, freshRequire } = require('./helpers');

/*
 * Фильтр по загрузчику применим только к модам.
 *
 * У остального контента в каталогах своя разметка: шейдеры помечены iris
 * и optifine, датапаки — datapack, ресурспаки — minecraft. Фильтр по fabric
 * не совпадал с ними ни разу, и лаунчер писал «нет версий» там, где на сайте
 * версия есть. Сеть здесь не трогаем — проверяем, какой фильтр уходит в запрос.
 */

let mods;
const calls = [];

before(() => {
  useTempRoot();

  /*
   * Подменяем сетевой слой: нам важен адрес запроса, а не ответ.
   * Порядок важен — mods.js достаёт getJSON из net.js при загрузке, поэтому
   * сначала чистим кеш, потом подменяем net, и только затем грузим mods.
   */
  freshRequire('../src/main/lib/net.js');           // сбрасывает кеш всех lib-модулей
  const net = require('../src/main/lib/net.js');
  net.getJSON = async (url) => { calls.push(url); return []; };

  mods = require('../src/main/lib/mods.js');
});

const lastUrl = () => decodeURIComponent(calls[calls.length - 1] || '');

describe('фильтр по загрузчику в списке версий', () => {
  test('для модов загрузчик учитывается', async () => {
    await mods.versionsFor('modrinth', 'AANobbMI', '1.20.1', 'fabric', 'mod');
    assert.match(lastUrl(), /loaders=\["fabric"\]/);
  });

  test('для шейдеров загрузчик не подставляется', async () => {
    await mods.versionsFor('modrinth', 'HVnmMxH1', '26.1.2', 'fabric', 'shader');
    const url = lastUrl();
    assert.ok(!url.includes('loaders='), `в запросе остался фильтр: ${url}`);
    assert.match(url, /game_versions=\["26\.1\.2"\]/, 'версия игры фильтроваться должна');
  });

  test('для ресурспаков и датапаков тоже без загрузчика', async () => {
    for (const kind of ['resourcepack', 'datapack']) {
      await mods.versionsFor('modrinth', 'X', '1.20.1', 'forge', kind);
      assert.ok(!lastUrl().includes('loaders='), `${kind}: фильтр по загрузчику лишний`);
    }
  });

  test('без указания типа ведём себя как для мода — старое поведение', async () => {
    await mods.versionsFor('modrinth', 'AANobbMI', '1.20.1', 'quilt');
    assert.match(lastUrl(), /loaders=\["quilt"\]/);
  });

  test('на CurseForge правило то же', async () => {
    await mods.versionsFor('curseforge', '123', '1.20.1', 'fabric', 'shader');
    assert.ok(!lastUrl().includes('modLoaderType'), 'шейдеру фильтр загрузчика не нужен');
    await mods.versionsFor('curseforge', '123', '1.20.1', 'fabric', 'mod');
    assert.match(lastUrl(), /modLoaderType=4/, 'моду нужен');
  });
});
