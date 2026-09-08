'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert');

const { useTempRoot, freshRequire } = require('./helpers');

let up;

before(() => {
  useTempRoot();
  up = freshRequire('../src/main/lib/updater.js');
});

/*
 * В релизе может не быть ни установщика отдельно, ни файла описания —
 * только архивы. Лаунчер всё равно не должен отправлять человека на сайт.
 */
describe('что брать из релиза', () => {
  const win = up.PLATFORM.win32;
  const a = (...names) => names.map((name) => ({ name, size: 1, url: 'https://x/' + name }));

  test('отдельный установщик важнее архива', () => {
    const got = up.pickAsset(a('PlusLauncher-1.0.0.zip', 'PlusLauncher-Setup-1.0.0.exe'), win);
    assert.equal(got.name, 'PlusLauncher-Setup-1.0.0.exe');
  });

  test('если установщика нет — берём zip, внутрь заглянем', () => {
    assert.equal(up.pickAsset(a('PlusLauncher-1.0.0.zip'), win).name, 'PlusLauncher-1.0.0.zip');
  });

  test('rar не берём — распаковать его нечем', () => {
    // тащить стороннюю библиотеку в лаунчер ради одного файла не стоит
    assert.equal(up.pickAsset(a('PlusLauncher-1.0.0.rar'), win), null);
  });

  test('пустой релиз — ничего, а не случайный файл', () => {
    assert.equal(up.pickAsset(a('README.md', 'latest.yml'), win), null);
  });

  /*
   * Когда в релизе лежит по архиву на каждую систему, первый по алфавиту —
   * линуксовый. Раньше его и качали на Windows, а распаковка падала с
   * «в архиве нет установщика».
   */
  test('из нескольких архивов берём свой, а не первый', () => {
    const assets = a('App-1.0.0-Linux.zip', 'App-1.0.0-macOS.zip', 'App-1.0.0-Windows.zip');
    assert.equal(up.pickAsset(assets, up.PLATFORM.win32).name, 'App-1.0.0-Windows.zip');
    assert.equal(up.pickAsset(assets, up.PLATFORM.darwin).name, 'App-1.0.0-macOS.zip');
    assert.equal(up.pickAsset(assets, up.PLATFORM.linux).name, 'App-1.0.0-Linux.zip');
  });

  test('чужой архив не берём — лучше ничего', () => {
    assert.equal(up.pickAsset(a('App-1.0.0-Linux.zip', 'App-1.0.0-macOS.zip'), win), null);
  });

  // под macOS установщиков два: на Apple Silicon и на Intel
  test('из двух установщиков macOS берём под свою архитектуру', () => {
    const assets = a('App-1.0.0-arm64.dmg', 'App-1.0.0-x64.dmg');
    const got = up.pickAsset(assets, up.PLATFORM.darwin);
    assert.equal(got.name, `App-1.0.0-${process.arch}.dmg`);
  });

  test('у каждой системы свой установщик', () => {
    const assets = a('app-1.0.0.exe', 'app-1.0.0.dmg', 'app-1.0.0.AppImage');
    assert.equal(up.pickAsset(assets, up.PLATFORM.win32).name, 'app-1.0.0.exe');
    assert.equal(up.pickAsset(assets, up.PLATFORM.darwin).name, 'app-1.0.0.dmg');
    assert.equal(up.pickAsset(assets, up.PLATFORM.linux).name, 'app-1.0.0.AppImage');
  });
});

describe('сравнение версий', () => {
  test('обновление видно, откат — нет', () => {
    assert.ok(up.cmpVersion('1.24.2', '1.24.1') > 0);
    assert.ok(up.cmpVersion('1.24.1', '1.24.1') === 0);
    assert.ok(up.cmpVersion('1.9.0', '1.10.0') < 0, '1.10 новее 1.9, а не наоборот');
  });

  test('предрелиз считается старше готового', () => {
    assert.ok(up.cmpVersion('1.24.0', '1.24.0-beta.1') > 0);
  });
});
