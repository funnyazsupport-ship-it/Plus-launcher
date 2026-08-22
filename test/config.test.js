'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { storage, useTempRoot, freshRequire } = require('./helpers');

let root;
let config;

before(() => { root = useTempRoot(); });

beforeEach(() => {
  storage.available = true;
  storage.ready = true;
  // чистый конфиг и свежий модуль на каждый тест: у config.js есть кеш в памяти
  try { fs.unlinkSync(path.join(root, 'config.json')); } catch { /* его могло и не быть */ }
  config = freshRequire('../src/main/lib/config.js');
});

const readDisk = () => JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));

const account = (over = {}) => ({
  uuid: 'u-1', name: 'Steve', type: 'microsoft',
  accessToken: 'ACCESS-123', refreshToken: 'REFRESH-456', clientToken: 'CLIENT-789',
  ...over,
});

describe('шифрование токенов аккаунта', () => {
  test('на диск токены попадают зашифрованными, а в памяти остаются читаемыми', () => {
    config.save({ accounts: [account()] });

    const onDisk = readDisk().accounts[0];
    assert.ok(onDisk.accessToken.startsWith('enc:'), 'accessToken на диске должен быть зашифрован');
    assert.ok(!onDisk.accessToken.includes('ACCESS-123'), 'открытый токен не должен попадать в файл');

    const inMemory = config.load().accounts[0];
    assert.equal(inMemory.accessToken, 'ACCESS-123');
    assert.equal(inMemory.refreshToken, 'REFRESH-456');
    assert.equal(inMemory.clientToken, 'CLIENT-789');
  });

  test('оффлайн-профиль не шифруется — там шифровать нечего', () => {
    config.save({ accounts: [account({ type: 'offline', accessToken: '0' })] });
    assert.equal(readDisk().accounts[0].accessToken, '0');
  });

  /*
   * Главный тест. Конфиг может быть прочитан до готовности приложения — тогда
   * расшифровать нечем и в памяти токен пустой. Если в этот момент что-то сохранить,
   * пустая строка не должна затереть живой токен на диске: это разлогинивало людей.
   */
  test('сохранение при недоступном шифровании не стирает токены', () => {
    config.save({ accounts: [account()] });
    const before = readDisk().accounts[0].accessToken;

    // приложение «перезапустилось» и читает конфиг раньше, чем поднялось хранилище
    storage.available = false;
    config = freshRequire('../src/main/lib/config.js');

    const loaded = config.load().accounts[0];
    assert.equal(loaded.accessToken, '', 'расшифровать не вышло — в памяти пусто, это ожидаемо');

    // посторонняя настройка сохраняется, аккаунты трогать никто не собирался
    config.save({ maxRam: 4096 });

    const after = readDisk().accounts[0];
    assert.equal(after.accessToken, before, 'токен на диске обязан остаться прежним');
    assert.equal(readDisk().maxRam, 4096, 'а сама настройка — сохраниться');
  });

  test('после появления хранилища токены снова читаются', () => {
    config.save({ accounts: [account()] });

    storage.available = false;
    config = freshRequire('../src/main/lib/config.js');
    assert.equal(config.load().accounts[0].accessToken, '');

    storage.available = true;
    assert.equal(config.load().accounts[0].accessToken, 'ACCESS-123',
      'конфиг должен перечитаться, когда шифрование заработало');
  });

  test('ключ CurseForge открытым текстом на диск не пишется', () => {
    config.save({ curseforgeKey: 'SECRET-KEY' });
    assert.equal(readDisk().curseforgeKey, undefined);
  });
});

describe('настройки сборки поверх общих', () => {
  test('пустое значение у сборки — берётся общее', () => {
    config.save({ maxRam: 4096, javaPath: '' });
    const eff = config.effectiveFor({ id: 'i1', maxRam: null });
    assert.equal(eff.maxRam, 4096);
  });

  test('своё значение у сборки перекрывает общее', () => {
    config.save({ maxRam: 4096 });
    assert.equal(config.effectiveFor({ id: 'i1', maxRam: 8192 }).maxRam, 8192);
  });
});
