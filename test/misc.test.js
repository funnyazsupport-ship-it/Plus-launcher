'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert');

const { useTempRoot, freshRequire } = require('./helpers');

before(() => { useTempRoot(); });

describe('ссылки на скины', () => {
  const skins = () => freshRequire('../src/main/lib/skins.js');

  test('ссылка NameMC распознаётся, в том числе с языковым поддоменом', () => {
    const s = skins();
    for (const url of [
      'https://namemc.com/skin/f9bb3d5b5962982a',
      'https://ru.namemc.com/skin/f9bb3d5b5962982a',
      'f9bb3d5b5962982a',
    ]) {
      const r = s.parseSkinLink(url);
      assert.equal(r.source, 'namemc', url);
      assert.equal(r.id, 'f9bb3d5b5962982a');
    }
  });

  test('ссылка Laby распознаётся, а текстура запрашивается именно в PNG', () => {
    const r = skins().parseSkinLink('https://laby.net/skin/497c555947a31e312fe1cfad857be2b4');
    assert.equal(r.source, 'laby');
    // без format=png сайт отдаёт webp, а игра понимает только png
    assert.match(r.url, /format=png/);
  });

  test('мусор не принимается за ссылку', () => {
    const s = skins();
    for (const bad of ['ерунда', 'https://example.com/skin/abc', '', null, 'javascript:alert(1)']) {
      assert.equal(s.parseSkinLink(bad), null, String(bad));
    }
  });
});

describe('сравнение версий для обновления', () => {
  const cmp = (...a) => freshRequire('../src/main/lib/updater.js').cmpVersion(...a);

  test('обычные номера', () => {
    assert.equal(cmp('1.15.0', '1.14.0'), 1);
    assert.equal(cmp('1.14.0', '1.15.0'), -1);
    assert.equal(cmp('1.15.0', '1.15.0'), 0);
  });

  test('разное число частей', () => {
    assert.equal(cmp('1.15', '1.15.0'), 0);
    assert.equal(cmp('1.15.1', '1.15'), 1);
  });

  test('двузначные числа сравниваются как числа, а не как текст', () => {
    // при строковом сравнении «1.9» оказалось бы новее «1.10» — и обновление не пришло бы
    assert.equal(cmp('1.10.0', '1.9.0'), 1);
    assert.equal(cmp('1.14.0', '1.9.0'), 1);
  });

  test('префикс v не мешает', () => {
    assert.equal(cmp('v1.15.0', '1.14.0'), 1);
  });

  test('релиз новее своего предрелиза', () => {
    assert.equal(cmp('1.15.0', '1.15.0-beta'), 1);
    assert.equal(cmp('1.15.0-beta', '1.15.0'), -1);
  });
});

describe('адрес репозитория обновлений', () => {
  const parse = (s) => freshRequire('../src/main/lib/updater.js').parseRepo(s);

  test('полная ссылка на GitHub', () => {
    assert.deepEqual(parse('https://github.com/funnyazsupport-ship-it/Plus-launcher'),
      { owner: 'funnyazsupport-ship-it', repo: 'Plus-launcher' });
  });

  test('короткая запись owner/repo', () => {
    assert.deepEqual(parse('owner/repo'), { owner: 'owner', repo: 'repo' });
  });

  test('пустое значение не роняет проверку обновлений', () => {
    assert.equal(parse(''), null);
    assert.equal(parse(null), null);
  });
});
