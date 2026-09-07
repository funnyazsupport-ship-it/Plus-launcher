'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { useTempRoot, freshRequire } = require('./helpers');

let root;
let config;
let friends;
let nbt;

before(() => { root = useTempRoot(); });

beforeEach(() => {
  // чистим и настройки, и список серверов: иначе состояние течёт между проверками
  try { fs.unlinkSync(path.join(root, 'config.json')); } catch { /* могло не быть */ }
  try { fs.rmSync(path.join(root, 'f1'), { recursive: true }); } catch { /* могло не быть */ }
  config = freshRequire('../src/main/lib/config.js');
  friends = freshRequire('../src/main/lib/friends.js');
  nbt = freshRequire('../src/main/lib/nbt.js');
});

const INST = { id: 'i1', name: 'Выживание', mc: '1.20.1', folder: 'f1' };
const serversPath = () => path.join(root, 'f1', 'servers.dat');

/** Список серверов, как его увидит игра */
function readList() {
  const rootTag = nbt.parse(fs.readFileSync(serversPath()));
  return (rootTag.value.servers.value.items || []).map((i) => ({
    name: i.name.value, ip: i.ip.value,
  }));
}

/** Кладёт файл со «своими» серверами, добавленными в игре руками */
function putOwnServers(entries) {
  const dir = path.dirname(serversPath());
  fs.mkdirSync(dir, { recursive: true });
  const items = entries.map(([name, ip]) => ({
    name: { __type: nbt.TAG.STRING, value: name },
    ip: { __type: nbt.TAG.STRING, value: ip },
    hidden: { __type: nbt.TAG.BYTE, value: 0 },
  }));
  fs.writeFileSync(serversPath(), nbt.write({
    name: '',
    value: { servers: { __type: nbt.TAG.LIST, value: { __list: nbt.TAG.COMPOUND, items } } },
  }));
}

describe('адрес друга', () => {
  test('обычные адреса принимаются', () => {
    for (const a of ['example.com', 'play.plus-launcher.fun:25571', '147.45.1.2', 'a-b_c.net:1234']) {
      assert.ok(friends.validAddress(a), a);
    }
  });

  test('мусор и опасное отклоняются', () => {
    for (const a of ['', null, 'адрес с пробелом', 'http://site.com', 'host:99999', 'a'.repeat(200), 'x;rm -rf']) {
      assert.equal(friends.validAddress(a), null, String(a));
    }
  });
});

describe('список друзей', () => {
  test('добавление и удаление', () => {
    const f = friends.add({ name: 'Ваня', address: 'vanya.playit.gg:25565' });
    assert.equal(friends.list().length, 1);
    assert.equal(f.name, 'Ваня');

    friends.remove(f.id);
    assert.equal(friends.list().length, 0);
  });

  test('один и тот же адрес дважды не добавляется', () => {
    friends.add({ name: 'Ваня', address: 'vanya.playit.gg' });
    assert.throws(() => friends.add({ name: 'Другой', address: 'VANYA.playit.gg' }), /уже есть/);
  });

  test('пустое имя и кривой адрес не принимаются', () => {
    assert.throws(() => friends.add({ name: '   ', address: 'a.com' }), /Введите ник/);
    assert.throws(() => friends.add({ name: 'Ваня', address: 'не адрес' }), /неправильно/);
  });

  test('переименование друга', () => {
    const f = friends.add({ name: 'Ваня', address: 'a.com' });
    const upd = friends.update(f.id, { name: 'Иван' });
    assert.equal(upd.name, 'Иван');
    assert.equal(friends.list()[0].name, 'Иван');
  });
});

describe('друзья в списке серверов игры', () => {
  test('друг появляется в списке', async () => {
    friends.add({ name: 'Ваня', address: 'vanya.playit.gg:25565' });
    await friends.syncInstance(INST);

    const list = readList();
    assert.equal(list.length, 1);
    assert.equal(list[0].ip, 'vanya.playit.gg:25565');
    assert.match(list[0].name, /Ваня/);
  });

  /*
   * Главное свойство: сервера, которые человек добавил в игре сам,
   * не должны пропасть. Их в файле может быть много и они важнее наших.
   */
  test('чужие записи остаются нетронутыми', async () => {
    putOwnServers([['Мой сервер', 'mc.example.com'], ['Ещё один', 'play.other.net:1234']]);

    friends.add({ name: 'Ваня', address: 'vanya.playit.gg' });
    await friends.syncInstance(INST);

    const list = readList();
    assert.equal(list.length, 3);
    assert.ok(list.some((s) => s.ip === 'mc.example.com'), 'первый свой сервер пропал');
    assert.ok(list.some((s) => s.ip === 'play.other.net:1234'), 'второй свой сервер пропал');
  });

  test('удалённый друг исчезает из списка, свои сервера — нет', async () => {
    putOwnServers([['Мой сервер', 'mc.example.com']]);
    const f = friends.add({ name: 'Ваня', address: 'vanya.playit.gg' });
    await friends.syncInstance(INST);
    assert.equal(readList().length, 2);

    friends.remove(f.id);
    await friends.syncInstance(INST);

    const list = readList();
    assert.equal(list.length, 1);
    assert.equal(list[0].ip, 'mc.example.com');
  });

  test('повторная запись не плодит дубликаты', async () => {
    friends.add({ name: 'Ваня', address: 'vanya.playit.gg' });
    await friends.syncInstance(INST);
    await friends.syncInstance(INST);
    await friends.syncInstance(INST);
    assert.equal(readList().length, 1);
  });

  test('испорченный файл не роняет запись', async () => {
    fs.mkdirSync(path.dirname(serversPath()), { recursive: true });
    fs.writeFileSync(serversPath(), 'это не NBT');

    friends.add({ name: 'Ваня', address: 'vanya.playit.gg' });
    await friends.syncInstance(INST);
    assert.equal(readList().length, 1, 'после порчи список пересобирается заново');
  });

  test('файла ещё нет — он создаётся', async () => {
    friends.add({ name: 'Ваня', address: 'vanya.playit.gg' });
    assert.ok(!fs.existsSync(serversPath()));
    await friends.syncInstance(INST);
    assert.ok(fs.existsSync(serversPath()));
  });
});

describe('свои серверы', () => {
  test('добавление и удаление', () => {
    const s = friends.addServer({ name: 'Хайпиксель', address: 'mc.hypixel.net' });
    assert.equal(friends.servers().length, 1);
    friends.removeServer(s.id);
    assert.equal(friends.servers().length, 0);
  });

  test('один и тот же адрес дважды не добавляется', () => {
    friends.addServer({ name: 'Первый', address: 'mc.example.com' });
    assert.throws(() => friends.addServer({ name: 'Второй', address: 'MC.example.com' }), /уже есть/);
  });

  test('пустое название и кривой адрес не принимаются', () => {
    assert.throws(() => friends.addServer({ name: ' ', address: 'a.com' }), /Введите название/);
    assert.throws(() => friends.addServer({ name: 'Свой', address: 'не адрес' }), /неправильно/);
  });

  test('свой сервер попадает в список внутри игры вместе с друзьями', async () => {
    friends.add({ name: 'Ваня', address: 'vanya.playit.gg' });
    friends.addServer({ name: 'Хайпиксель', address: 'mc.hypixel.net' });
    await friends.syncInstance(INST);

    const list = readList();
    assert.equal(list.length, 2);
    assert.ok(list.some((s) => s.ip === 'vanya.playit.gg'), 'друга нет');
    assert.ok(list.some((s) => s.ip === 'mc.hypixel.net'), 'своего сервера нет');
  });

  /*
   * Свой сервер помечен так же, как друзья: иначе при следующей записи
   * лаунчер принял бы его за чужую строку и оставил бы после удаления.
   */
  test('удалённый сервер исчезает, добавленный в игре руками остаётся', async () => {
    putOwnServers([['Вручную', 'manual.example.com']]);
    const s = friends.addServer({ name: 'Хайпиксель', address: 'mc.hypixel.net' });
    await friends.syncInstance(INST);
    assert.equal(readList().length, 2);

    friends.removeServer(s.id);
    await friends.syncInstance(INST);

    const list = readList();
    assert.equal(list.length, 1);
    assert.equal(list[0].ip, 'manual.example.com');
  });

  test('повторная запись не плодит дубликаты', async () => {
    friends.addServer({ name: 'Хайпиксель', address: 'mc.hypixel.net' });
    await friends.syncInstance(INST);
    await friends.syncInstance(INST);
    assert.equal(readList().length, 1);
  });
});

describe('запрет входящих', () => {
  test('по умолчанию друзья пускаются', () => {
    assert.equal(friends.incomingAllowed(), true);
  });

  test('выключается настройкой', () => {
    config.save({ friendsIncoming: false });
    assert.equal(friends.incomingAllowed(), false);
  });
});
