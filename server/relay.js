'use strict';
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/*
 * Релей: выставляет чужой мир наружу.
 *
 * Дома роутер не пускает внутрь никого — поэтому лаунчер хозяина мира звонит
 * сюда сам, наружу, и держит одно управляющее соединение открытым. Друзья
 * приходят на публичный порт этой машины. Дальше релей просто переливает байты
 * между ними: что такое Minecraft, он не знает и знать не должен.
 *
 * Учётки нужны, чтобы человеку не пришлось никому диктовать адрес. Он заводит
 * ник с паролем, друг добавляет его по нику — адрес релей подставляет сам.
 * Поэтому порт закрепляется за ником навсегда: если бы он менялся, запись в
 * списке серверов у друга протухала бы после каждого перезапуска.
 *
 * Когда приходит друг, релей не может «протолкнуть» его по управляющему
 * соединению — там уже идёт разговор. Вместо этого он говорит хозяину «на тебя
 * идёт соединение N», хозяин открывает сюда ещё одно и представляется тем же N.
 * Две половинки складываются, и получается сквозная труба.
 *
 * Всё приходит на один и тот же порт: и хозяин, и его соединения для данных,
 * и запросы про чужие ники. Различаются первой строкой. Так на файрволе хватает
 * двух правил вместо трёх.
 *
 * Зависимостей нет: файл кладётся на сервер как есть и запускается node relay.js
 */

const HELLO_MS = 10000;   // столько ждём, пока пришедший представится
// Первая строка обычно короткая, но вместе с ней приезжает описание сборки —
// список модов на полсотни позиций. Это по-прежнему килобайты, не мегабайты.
const LINE_MAX = 256 * 1024;
const PACK_MAX = 128 * 1024;
const PAIR_MS = 10000;    // столько друг ждёт, пока хозяин откроет вторую половину
const PING_MS = 30000;    // молчащее соединение так и не заметит, что оборвалось

const NICK = /^[a-z0-9_-]{3,20}$/;
const PASS_MIN = 6;

/**
 * Читает из соединения первую строку с JSON.
 * Соединение после этого остановлено, а хвост байтов отдаётся вызвавшему —
 * потерять его нельзя, это уже игровые данные.
 */
function readHello(sock, cb) {
  let buf = Buffer.alloc(0);
  let done = false;

  const finish = (err, msg, rest) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    sock.pause();                    // иначе поток продолжит идти в пустоту
    sock.removeListener('data', onData);
    sock.removeListener('error', onErr);
    sock.removeListener('close', onErr);
    cb(err, msg, rest);
  };

  const timer = setTimeout(() => finish(new Error('молчит')), HELLO_MS);
  const onErr = (e) => finish(e || new Error('оборвалось'));

  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const nl = buf.indexOf(0x0a);
    if (nl < 0) {
      if (buf.length > LINE_MAX) finish(new Error('слишком длинная строка'));
      return;
    }
    let msg;
    try {
      msg = JSON.parse(buf.subarray(0, nl).toString('utf8'));
    } catch {
      return finish(new Error('не разобрать строку'));
    }
    finish(null, msg, buf.subarray(nl + 1));
  };

  sock.on('data', onData);
  sock.on('error', onErr);
  sock.on('close', onErr);
}

const line = (obj) => `${JSON.stringify(obj)}\n`;

/** Складывает две половинки в сквозную трубу и следит, чтобы закрылись вместе */
function join(a, b) {
  const done = () => { a.destroy(); b.destroy(); };
  for (const s of [a, b]) {
    s.setTimeout(0);                 // игровое соединение живёт долго
    s.on('error', done);
    s.on('close', done);
  }
  a.pipe(b);
  b.pipe(a);
}

/**
 * Учётки на диске. Файл переписывается целиком через временный —
 * иначе при выключении питания он мог бы остаться обрезанным.
 */
function openAccounts(file) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    data = {};                       // файла ещё нет — это первый запуск
  }
  const save = () => {
    const tmp = `${file}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  };
  return { data, save };
}

/**
 * Поднимает релей.
 * @param {object} opts port — управляющий порт, key — пароль сервера
 *   (пусто = заводить учётки может кто угодно), from/to — промежуток портов,
 *   data — файл с учётками, onError — куда отдать отказ прослушивания
 *   (без него запуск службой просто завершается с понятной строкой в журнале)
 */
function start(opts = {}) {
  const controlPort = Number(opts.port) || Number(process.env.RELAY_PORT) || 7000;
  const key = opts.key !== undefined ? opts.key : (process.env.RELAY_KEY || '');
  const from = Number(opts.from) || Number(process.env.RELAY_PORT_FROM) || 25565;
  const to = Number(opts.to) || Number(process.env.RELAY_PORT_TO) || 25584;
  const dataFile = opts.data || process.env.RELAY_DATA || '/var/lib/relay/accounts.json';

  const store = openAccounts(dataFile);
  const accounts = store.data;

  const hosts = new Map();           // публичный порт -> хозяин, который сейчас на связи
  const waiting = new Map();         // номер соединения -> ждущий друг
  let counter = 0;

  const log = (...a) => console.log(new Date().toISOString(), ...a);
  const idOf = (nick) => String(nick || '').trim().toLowerCase();

  // ---------------- учётки ----------------

  /** Порт, ещё не закреплённый ни за кем */
  function freePort() {
    const taken = new Set(Object.values(accounts).map((a) => a.port));
    for (let p = from; p <= to; p++) if (!taken.has(p)) return p;
    return null;
  }

  function register(nick, pass, cb) {
    const id = idOf(nick);
    if (!NICK.test(id)) return cb(new Error('Ник: 3–20 знаков, латиница, цифры, дефис и подчёркивание'));
    if (String(pass || '').length < PASS_MIN) return cb(new Error(`Пароль короче ${PASS_MIN} знаков`));
    if (accounts[id]) return cb(new Error('Такой ник уже занят'));

    const port = freePort();
    if (port === null) return cb(new Error('На этом сервере кончились свободные места'));

    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(String(pass), salt, 32, (e, buf) => {
      if (e) return cb(e);
      accounts[id] = {
        nick: String(nick).trim(), salt, hash: buf.toString('hex'), port, created: Date.now(),
      };
      try {
        store.save();
      } catch (err) {
        delete accounts[id];         // не сохранилось — значит учётки и нет
        return cb(new Error(`Не удалось сохранить учётку: ${err.message}`));
      }
      log(`заведён ник ${accounts[id].nick}, порт ${port}`);
      cb(null, accounts[id]);
    });
  }

  /**
   * Что из присланной сборки согласны хранить.
   * Пришло от чужой программы, поэтому берём только знакомые поля и с оглядкой
   * на размер: раздувать файл учёток чужим списком модов мы не подписывались.
   * null — «сборкой больше не делюсь», undefined — «оставить как было».
   */
  function keepPack(raw) {
    if (raw === null) return null;
    if (!raw || typeof raw !== 'object') return undefined;
    const pack = {
      format: String(raw.format || ''),
      formatVersion: Number(raw.formatVersion) || 1,
      name: String(raw.name || '').slice(0, 60),
      mc: String(raw.mc || '').slice(0, 20),
      loader: String(raw.loader || 'vanilla').slice(0, 20),
      loaderVersion: raw.loaderVersion ? String(raw.loaderVersion).slice(0, 40) : null,
      mods: Array.isArray(raw.mods) ? raw.mods.slice(0, 400) : [],
      bundled: [],                   // файлы модов по этой дороге не ездят
      shared: Date.now(),
    };
    if (!pack.mc) return undefined;
    return JSON.stringify(pack).length > PACK_MAX ? undefined : pack;
  }

  function verify(nick, pass, cb) {
    const acc = accounts[idOf(nick)];
    if (!acc) return cb(new Error('Такого ника нет'));
    crypto.scrypt(String(pass || ''), acc.salt, 32, (e, buf) => {
      if (e) return cb(e);
      const known = Buffer.from(acc.hash, 'hex');
      // сравнение за постоянное время: по скорости отказа нельзя подбирать пароль
      const ok = known.length === buf.length && crypto.timingSafeEqual(known, buf);
      cb(ok ? null : new Error('Неверный пароль'), acc);
    });
  }

  // ---------------- труба ----------------

  /** Убирает хозяина и всё, что к нему привязано */
  function dropHost(host) {
    if (hosts.get(host.port) !== host) return;
    hosts.delete(host.port);
    clearInterval(host.ping);
    try { host.gate.close(); } catch { /* уже закрыт */ }
    for (const [id, friend] of waiting) {
      if (friend.host !== host) continue;
      clearTimeout(friend.timer);
      friend.sock.destroy();
      waiting.delete(id);
    }
    host.control.destroy();
    log(`${host.nick} ушёл, порт ${host.port} свободен`);
  }

  /** Открывает закреплённый за ником порт и начинает пускать к нему друзей */
  function openHost(control, acc, done) {
    const old = hosts.get(acc.port);
    if (old) dropHost(old);          // тот же ник зашёл заново: прошлое соединение мертво

    // world === null значит «лаунчер про мир ничего не сказал». Так ведут себя
    // сборки, вышедшие до появления этой строки: их считаем доступными, пока
    // они на связи — иначе у них кнопка «играть» не загорится никогда.
    const host = { port: acc.port, nick: acc.nick, control, gate: null, ping: null, world: null };

    const gate = net.createServer((friend) => {
      const id = `${(counter += 1).toString(36)}${crypto.randomBytes(4).toString('hex')}`;
      friend.pause();                // до пары данные копятся в буфере ядра
      const timer = setTimeout(() => {
        // хозяин не отозвался — держать друга бессмысленно
        waiting.delete(id);
        friend.destroy();
      }, PAIR_MS);
      waiting.set(id, { sock: friend, timer, host });

      friend.on('close', () => {
        // друг передумал ждать
        const w = waiting.get(id);
        if (!w) return;
        clearTimeout(w.timer);
        waiting.delete(id);
      });

      try {
        control.write(line({ t: 'conn', id }));
      } catch {
        clearTimeout(timer);
        waiting.delete(id);
        friend.destroy();
      }
    });

    gate.on('error', (e) => {
      dropHost(host);
      done(e);
    });

    gate.listen(acc.port, '0.0.0.0', () => {
      host.gate = gate;
      hosts.set(acc.port, host);

      /*
       * Дальше хозяин сообщает только одно: открыт ли сейчас мир.
       *
       * Соединение висит всё время, пока лаунчер запущен, а мир открывают
       * отдельно, уже в игре. Если считать «в сети» по одному соединению,
       * друзья будут видеть человека доступным, когда заходить ещё некуда.
       */
      control.resume();
      let rest = Buffer.alloc(0);
      control.on('data', (chunk) => {
        rest = Buffer.concat([rest, chunk]).subarray(-LINE_MAX);
        for (;;) {
          const nl = rest.indexOf(0x0a);
          if (nl < 0) return;
          const raw = rest.subarray(0, nl).toString('utf8');
          rest = rest.subarray(nl + 1);
          try {
            const m = JSON.parse(raw);
            if (m.t === 'world') host.world = Boolean(m.open);
          } catch { /* мусор в управляющем канале рвать связь не должен */ }
        }
      });
      control.setKeepAlive(true, 15000);
      control.on('error', () => dropHost(host));
      control.on('close', () => dropHost(host));

      host.ping = setInterval(() => {
        try { control.write(line({ t: 'ping' })); } catch { dropHost(host); }
      }, PING_MS);

      log(`${acc.nick} вышел на связь, порт ${acc.port}`);
      done(null, acc.port);
    });
  }

  /** Вторая половина трубы: хозяин пришёл на зов */
  function attach(sock, id, rest) {
    const friend = waiting.get(id);
    if (!friend) return sock.destroy();     // опоздал, друг уже не ждёт
    clearTimeout(friend.timer);
    waiting.delete(id);
    friend.sock.removeAllListeners('close');

    if (rest && rest.length) friend.sock.write(rest);
    join(friend.sock, sock);
    friend.sock.resume();
    sock.resume();
  }

  // ---------------- приём ----------------

  const server = net.createServer((sock) => {
    sock.setNoDelay(true);
    readHello(sock, (err, msg, rest) => {
      if (err || !msg) return sock.destroy();
      const reply = (obj) => sock.end(line(obj));
      const fail = (e) => reply({ t: 'err', error: e.message || String(e) });

      // соединения для данных приходят по случайному номеру — ключ им не нужен
      if (msg.t === 'data') return attach(sock, String(msg.id || ''), rest);

      if (key && msg.key !== key) return reply({ t: 'err', error: 'Неверный ключ сервера' });

      if (msg.t === 'register') return register(msg.nick, msg.pass, (e, acc) => (e ? fail(e) : reply({ t: 'ok', nick: acc.nick, port: acc.port })));

      if (msg.t === 'lookup') {
        const acc = accounts[idOf(msg.nick)];
        if (!acc) return reply({ t: 'err', error: 'Такого ника нет на этом сервере' });
        const host = hosts.get(acc.port);
        return reply({
          t: 'found',
          nick: acc.nick,
          port: acc.port,
          // «в сети» значит «заходи прямо сейчас», а не «лаунчер запущен».
          // Старые сборки про мир молчат — им верим на слово, что доступны.
          online: host ? host.world !== false : false,
          connected: Boolean(host),
          pack: acc.pack ? { name: acc.pack.name, mc: acc.pack.mc, loader: acc.pack.loader, mods: (acc.pack.mods || []).length } : null,
        });
      }

      // вход без открытия мира: проверить, что ник с паролем наши
      if (msg.t === 'auth') {
        return verify(msg.nick, msg.pass, (e, acc) => (e ? fail(e) : reply({ t: 'ok', nick: acc.nick, port: acc.port })));
      }

      if (msg.t === 'pack') {
        const acc = accounts[idOf(msg.nick)];
        if (!acc?.pack) return reply({ t: 'err', error: 'Друг не поделился сборкой' });
        return reply({ t: 'pack', pack: acc.pack });
      }

      if (msg.t === 'hello') {
        return verify(msg.nick, msg.pass, (e, acc) => {
          if (e) return fail(e);
          // вместе с приветствием приезжает сборка, на которой хозяин играет,
          // чтобы друг мог поставить себе такую же, не спрашивая
          if (msg.pack !== undefined) {
            const pack = keepPack(msg.pack);
            if (pack !== undefined && JSON.stringify(pack) !== JSON.stringify(acc.pack)) {
              acc.pack = pack;
              try { store.save(); } catch { /* не сохранилось — не повод рвать связь */ }
            }
          }
          openHost(sock, acc, (e2, port) => (e2 ? fail(e2) : sock.write(line({ t: 'ok', nick: acc.nick, port }))));
        });
      }

      sock.destroy();
    });
  });

  /*
   * Без этого обработчика занятый порт валит весь процесс необъяснимым
   * стеком: при перезапуске службы старый сокет ещё держится секунду-другую,
   * и релей просто не поднимался, унося с собой всех, кто был в мире.
   */
  server.on('error', (e) => {
    log(e.code === 'EADDRINUSE'
      ? `порт ${controlPort} занят — похоже, релей уже запущен`
      : `сеть отказала: ${e.message}`);
    if (typeof opts.onError === 'function') opts.onError(e);
    else if (require.main === module) process.exit(1);
  });

  server.listen(controlPort, '0.0.0.0', () => {
    log(`релей слушает ${controlPort}, порты для миров ${from}–${to}, учёток ${Object.keys(accounts).length}`);
  });

  return {
    port: controlPort,
    server,
    accounts,
    close() {
      for (const host of [...hosts.values()]) dropHost(host);
      server.close();
    },
  };
}

if (require.main === module) start();

module.exports = { start };
