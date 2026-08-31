'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const { useTempRoot, freshRequire } = require('./helpers');

let launch;
let root;

before(() => {
  root = useTempRoot();
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

describe('java-агенты из сборки', () => {
  const dir = () => path.join(root, 'сборка');

  /** Собирает jar с нужным манифестом — так же, как это делают настоящие моды */
  function makeJar(sub, name, manifest) {
    const d = path.join(dir(), sub);
    fs.mkdirSync(d, { recursive: true });
    const zip = new AdmZip();
    if (manifest !== null) zip.addFile('META-INF/MANIFEST.MF', Buffer.from(manifest, 'utf8'));
    zip.addFile('какой-то/Класс.class', Buffer.from('не настоящий'));
    zip.writeZip(path.join(d, name));
    return path.join(d, name);
  }

  beforeEach(() => { try { fs.rmSync(dir(), { recursive: true }); } catch { /* не было */ } });

  test('агент опознаётся по манифесту и подключается', () => {
    const agent = makeJar('mods', 'wild-class-dump-agent.jar',
      'Manifest-Version: 1.0\r\nPremain-Class: ru.example.Agent\r\n');

    assert.deepEqual(launch.findAgents(dir()), [agent]);
  });

  test('обычный мод агентом не считается', () => {
    // иначе лаунчер подсовывал бы -javaagent на каждый мод подряд
    makeJar('mods', 'sodium.jar', 'Manifest-Version: 1.0\r\nImplementation-Title: Sodium\r\n');
    makeJar('mods', 'fabric-api.jar', null);

    assert.deepEqual(launch.findAgents(dir()), []);
  });

  test('папка agents тоже просматривается', () => {
    const agent = makeJar('agents', 'свой-агент.jar',
      'Manifest-Version: 1.0\r\nPremain-Class: com.example.Main\r\n');

    assert.deepEqual(launch.findAgents(dir()), [agent]);
  });

  test('битый архив не роняет запуск', () => {
    const d = path.join(dir(), 'mods');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'сломанный.jar'), 'это вообще не zip');

    assert.deepEqual(launch.findAgents(dir()), []);
  });

  test('нет папки сборки — пустой список, а не падение', () => {
    assert.deepEqual(launch.findAgents(path.join(root, 'которой-нет')), []);
  });
});
