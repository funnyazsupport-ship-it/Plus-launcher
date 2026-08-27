'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert');

const { useTempRoot, freshRequire } = require('./helpers');

let launch;

before(() => {
  useTempRoot();
  launch = freshRequire('../src/main/lib/launch.js');
});

describe('адрес мира, в который заходим', () => {
  test('порт по умолчанию — обычный игровой', () => {
    assert.deepEqual(launch.parseJoin('example.com'), { host: 'example.com', port: 25565 });
    assert.deepEqual(launch.parseJoin('89.168.120.170'), { host: '89.168.120.170', port: 25565 });
  });

  test('порт берётся из адреса, если указан', () => {
    assert.deepEqual(launch.parseJoin('89.168.120.170:25571'), { host: '89.168.120.170', port: 25571 });
  });

  test('пустое значение — просто «никуда не заходим»', () => {
    for (const v of ['', null, undefined, '   ']) assert.equal(launch.parseJoin(v), null, String(v));
  });

  test('мусор не превращается в аргументы игры', () => {
    // иначе чужая строка уехала бы в командную строку java
    for (const v of ['a b', 'host; rm -rf /', 'host:0', 'host:99999', '--fullscreen', 'ho st:25565']) {
      assert.equal(launch.parseJoin(v), null, v);
    }
  });
});
