'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { gameDir } = require('./paths');
const config = require('./config');
const nbt = require('./nbt');

/*
 * Друзья.
 *
 * Смысл в том, чтобы не объяснять человеку про адреса и порты: добавил друга
 * один раз — и его мир сам появился в списке серверов внутри игры, во всех
 * сборках сразу. Дальше он просто заходит, как на обычный сервер.
 *
 * Список серверов игра держит в servers.dat рядом с миром. Свои записи мы
 * помечаем и обновляем только их: то, что человек добавил в игре руками,
 * трогать нельзя.
 */

const FILE = 'servers.dat';
const MARK = 'PL:';                   // приписка в названии — по ней узнаём свои записи
const MAX_NAME = 40;

const list = () => (config.load().friends || []);

const clean = (s, max = MAX_NAME) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Адрес друга: то, что он выдал из туннеля.
 * Пускаем имя хоста или адрес, при желании с портом — как в самой игре.
 */
function validAddress(value) {
  const s = String(value || '').trim();
  if (!s || s.length > 120) return null;
  // с дефиса имя хоста начинаться не может: такая строка сошла бы за ключ
  // командной строки, если адрес когда-нибудь попадёт в аргументы игры
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-_]*(:\d{1,5})?$/.test(s)) return null;
  const port = s.includes(':') ? Number(s.split(':').pop()) : 25565;
  if (!(port > 0 && port < 65536)) return null;
  return s;
}

function add({ name, address, nick: login }) {
  const nick = clean(name);
  const addr = validAddress(address);
  if (!nick) throw new Error('Введите ник друга');
  if (!addr) throw new Error('Адрес выглядит неправильно — нужен вид example.com или example.com:25565');

  const all = list();
  if (all.some((f) => f.address.toLowerCase() === addr.toLowerCase())) {
    throw new Error('Этот друг уже есть в списке');
  }
  const friend = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: nick,
    // ник на релее: адрес по нему можно перезапросить, если сервер переедет
    nick: String(login || nick).trim(),
    address: addr,
    added: Date.now(),
  };
  config.save({ friends: [...all, friend] });
  return friend;
}

function remove(id) {
  config.save({ friends: list().filter((f) => f.id !== id) });
  return true;
}

function update(id, patch = {}) {
  const all = list();
  const found = all.find((f) => f.id === id);
  if (!found) throw new Error('Друг не найден');

  const next = { ...found };
  if (patch.name !== undefined) {
    next.name = clean(patch.name);
    if (!next.name) throw new Error('Имя не может быть пустым');
  }
  if (patch.address !== undefined) {
    const addr = validAddress(patch.address);
    if (!addr) throw new Error('Адрес выглядит неправильно');
    next.address = addr;
  }
  config.save({ friends: all.map((f) => (f.id === id ? next : f)) });
  return next;
}

// ---------------- список серверов внутри игры ----------------

const serversFile = (inst) => path.join(gameDir(inst.folder || inst.mc || inst.id), FILE);

/** Пустой список серверов — с него начинаем, если файла ещё нет */
const emptyRoot = () => ({
  name: '',
  value: { servers: { __type: nbt.TAG.LIST, value: { __list: nbt.TAG.COMPOUND, items: [] } } },
});

function readServers(file) {
  try {
    const root = nbt.parse(fs.readFileSync(file));
    if (!root.value.servers) root.value.servers = emptyRoot().value.servers;
    return root;
  } catch {
    // файла нет или он испорчен — начинаем с чистого списка,
    // испорченный всё равно игра не прочитала бы
    return emptyRoot();
  }
}

const entryName = (friend) => `${MARK} ${friend.name}`.slice(0, 60);
const isOurs = (item) => String(item?.name?.value || '').startsWith(MARK);

/**
 * Пишет друзей в список серверов одной сборки.
 * Чужие записи сохраняются как есть — переписываем только свои.
 * @returns {Promise<number>} сколько друзей записано
 */
async function syncInstance(inst, friends = list()) {
  const file = serversFile(inst);
  const root = readServers(file);
  const items = root.value.servers.value.items || [];

  const theirs = items.filter((i) => !isOurs(i));
  const ours = friends.map((f) => ({
    name: { __type: nbt.TAG.STRING, value: entryName(f) },
    ip: { __type: nbt.TAG.STRING, value: f.address },
    hidden: { __type: nbt.TAG.BYTE, value: 0 },
  }));

  root.value.servers.value.items = [...theirs, ...ours];
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, nbt.write(root));
  return ours.length;
}

/** Раскладывает список друзей по всем сборкам */
async function syncAll() {
  const friends = list();
  const done = [];
  for (const inst of config.load().instances) {
    try {
      await syncInstance(inst, friends);
      done.push(inst.name);
    } catch (e) {
      // одна сборка не должна ронять остальные: папка могла быть занята игрой
      done.push(`${inst.name} — не вышло: ${e.message}`);
    }
  }
  return { friends: friends.length, instances: done.length };
}

/** Разрешено ли друзьям подключаться к нам */
const incomingAllowed = () => config.load().friendsIncoming !== false;

module.exports = {
  list, add, remove, update, syncAll, syncInstance,
  validAddress, incomingAllowed, MARK,
};
