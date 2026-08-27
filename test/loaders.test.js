'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert');

const { useTempRoot, freshRequire } = require('./helpers');

let loaders;

before(() => {
  useTempRoot();
  loaders = freshRequire('../src/main/lib/loaders.js');
});

/*
 * Имя папки версии, которую создаст установщик Forge или NeoForge.
 *
 * Нужно, чтобы понять: загрузчик уже стоит или его правда не установили.
 * Раньше лаунчер смотрел только на «появилась ли новая папка», и повторная
 * установка той же версии заканчивалась ошибкой «Установщик не создал профиль
 * версии», хотя всё было на месте.
 */
describe('имя профиля версии загрузчика', () => {
  // имена взяты из настоящих установок
  const REAL = [
    ['1.12.2', '1.12.2-14.23.5.2864', '1.12.2-forge-14.23.5.2864'],
    ['1.19.2', '1.19.2-43.5.2', '1.19.2-forge-43.5.2'],
    ['1.20.1', '1.20.1-47.4.23', '1.20.1-forge-47.4.23'],
  ];

  test('совпадает с тем, как установщик называет папки', () => {
    for (const [mc, version, expected] of REAL) {
      assert.equal(loaders.expectedProfile('forge', mc, version), expected, `${mc} / ${version}`);
    }
  });

  test('версия без приставки с номером игры тоже понимается', () => {
    // модпаки CurseForge пишут версию Forge коротко: 47.4.23 вместо 1.20.1-47.4.23
    assert.equal(loaders.expectedProfile('forge', '1.20.1', '47.4.23'), '1.20.1-forge-47.4.23');
  });

  test('у NeoForge своя схема имён', () => {
    assert.equal(loaders.expectedProfile('neoforge', '1.21.1', '21.1.95'), 'neoforge-21.1.95');
  });

  test('без версии загрузчика имени нет', () => {
    assert.equal(loaders.expectedProfile('forge', '1.20.1', null), null);
    assert.equal(loaders.expectedProfile('forge', '1.20.1', ''), null);
  });

  test('для fabric и quilt имя берётся отдельной функцией', () => {
    assert.equal(loaders.expectedProfile('fabric', '1.20.1', '0.16.9'), null);
    assert.equal(loaders.profileId('fabric', '1.20.1', '0.16.9'), 'fabric-loader-0.16.9-1.20.1');
    assert.equal(loaders.profileId('quilt', '1.20.1', '0.26.0'), 'quilt-loader-0.26.0-1.20.1');
  });
});

describe('подбор версии загрузчика', () => {
  test('ваниль версии загрузчика не требует', async () => {
    const r = await loaders.resolveVersion('vanilla', '1.20.1', null);
    assert.equal(r.version, null);
    assert.equal(r.exact, true);
  });
});

describe('версия NeoForge к версии игры', () => {
  test('старая схема нумерации', () => {
    assert.ok(loaders.neoMatches('21.1.95', '1.21.1'));
    assert.ok(loaders.neoMatches('20.0.14', '1.20'));
    assert.ok(!loaders.neoMatches('21.1.95', '1.20.1'));
  });

  test('новая схема с 26.x', () => {
    assert.ok(loaders.neoMatches('26.2.3', '26.2'));
    assert.ok(loaders.neoMatches('26.2.3', '26.2.1'));
  });
});
