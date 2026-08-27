'use strict';
const net = require('net');

/*
 * Сторона хозяина мира.
 *
 * Домашний роутер не пускает внутрь никого, зато наружу выпускает всё. На этом
 * и построено: лаунчер сам звонит на релей и держит соединение открытым. Когда
 * к релею приходит друг, тот говорит «на тебя идёт соединение N» — и лаунчер
 * открывает вторую половину трубы навстречу.
 *
 * Сам мир этот файл не трогает: он доводит трафик до перенаправителя (share.js),
 * а тот уже знает, на каком порту сейчас открыт мир.
 *
 * Связь рвётся: ноутбук уснул, вайфай моргнул, релей перезапустился. Поэтому
 * после обрыва соединение поднимается заново, с нарастающей паузой — чтобы не
 * долбить упавший сервер каждую секунду.
 */

const RETRY_MIN = 2000;
const RETRY_MAX = 60000;
const HELLO_MS = 15000;
const LINE_MAX = 1024;

let control = null;
let retry = null;
let attempt = 0;
let stopped = true;
let opts = {};
let onEvent = () => {};
let status = { running: false, address: null, error: null };

let world = false;                   // открыт ли сейчас мир в игре

const state = () => ({ ...status, world });

function emit() {
  onEvent(state());
}

const line = (obj) => `${JSON.stringify(obj)}\n`;

/**
 * Разбирает поток на строки JSON.
 * Возвращает функцию, которой скармливаются куски.
 */
function lineReader(onLine, onBad) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const nl = buf.indexOf(0x0a);
      if (nl < 0) {
        if (buf.length > LINE_MAX) onBad(new Error('релей прислал мусор'));
        return;
      }
      const raw = buf.subarray(0, nl).toString('utf8');
      buf = buf.subarray(nl + 1);
      try {
        onLine(JSON.parse(raw));
      } catch {
        onBad(new Error('релей прислал мусор'));
        return;
      }
    }
  };
}

/**
 * Вторая половина трубы: идём на релей за конкретным соединением
 * и сводим его с перенаправителем.
 */
function openData(id) {
  const up = net.connect(opts.port, opts.host);
  const down = net.connect(opts.local, '127.0.0.1');
  let named = false;                 // представились ли релею
  let lost = false;                  // мир не отвечает
  let ready = 0;

  const drop = () => { up.destroy(); down.destroy(); };

  for (const s of [up, down]) {
    s.setNoDelay(true);
    s.setTimeout(0);                 // игровое соединение живёт долго
  }

  up.on('error', drop);
  up.on('close', drop);

  // Мир может не открыться вовсе. Просто оборвать соединение к релею нельзя:
  // пока мы не назвали номер, релей не знает, чьего друга отпускать, и держит
  // его в очереди — для друга это выглядит как вечное «Connecting…».
  // Поэтому сначала представляемся и только потом прощаемся.
  const worldGone = () => {
    lost = true;
    if (named) up.end();
  };
  down.on('error', worldGone);
  down.on('close', worldGone);

  up.on('connect', () => {
    named = true;
    up.write(line({ t: 'data', id }));
    if (lost) return up.end();
    join();
  });
  down.on('connect', join);

  function join() {
    if ((ready += 1) < 2) return;
    up.pipe(down);
    down.pipe(up);
  }
}

function scheduleRetry() {
  if (stopped) return;
  attempt += 1;
  const wait = Math.min(RETRY_MIN * 2 ** (attempt - 1), RETRY_MAX);
  retry = setTimeout(connect, wait);
}

function connect() {
  retry = null;
  const sock = net.connect(opts.port, opts.host);
  control = sock;
  sock.setNoDelay(true);

  let greeted = false;
  const timer = setTimeout(() => {
    if (!greeted) sock.destroy();
  }, HELLO_MS);

  const fail = (msg) => {
    status = { running: false, address: null, error: msg };
    emit();
  };

  sock.on('connect', () => {
    sock.write(line({
      t: 'hello', key: opts.key || '', nick: opts.nick, pass: opts.pass, pack: opts.pack,
    }));
  });

  const feed = lineReader((msg) => {
    if (msg.t === 'ok') {
      greeted = true;
      clearTimeout(timer);
      attempt = 0;
      sock.setKeepAlive(true, 15000);
      status = { running: true, address: `${opts.host}:${msg.port}`, error: null };
      /*
       * Состояние мира сообщаем всегда, даже когда он закрыт.
       *
       * Во-первых, после обрыва связь поднимается заново, а сервер про
       * открытый мир ничего не помнит. Во-вторых, по самому факту этой строки
       * сервер отличает свежий лаунчер от старого: старый её не шлёт вовсе,
       * и его приходится считать доступным на глазок.
       */
      sock.write(line({ t: 'world', open: world }));
      emit();
      return;
    }
    if (msg.t === 'err') {
      clearTimeout(timer);
      // ник или пароль не подошли — повторять бессмысленно, ждём правок человека
      stopped = true;
      fail(msg.error || 'релей отказал');
      sock.destroy();
      return;
    }
    if (msg.t === 'conn' && msg.id) openData(String(msg.id));
    // ping отвечать не нужно: он нужен релею, чтобы заметить обрыв
  }, () => sock.destroy());

  sock.on('data', feed);

  sock.on('error', (e) => {
    if (!status.error) fail(`нет связи с релеем: ${e.code || e.message}`);
  });

  sock.on('close', () => {
    clearTimeout(timer);
    if (control === sock) control = null;
    if (stopped) return;
    if (status.running) fail('связь с релеем оборвалась, восстанавливаем');
    scheduleRetry();
  });
}

/**
 * Одиночный вопрос релею: завести ник, узнать чужой адрес.
 * Соединение живёт ровно один ответ — держать его незачем.
 */
function ask(o, msg) {
  const host = String(o.host || '').trim();
  if (!host) return Promise.reject(new Error('Не указан адрес сервера'));

  return new Promise((resolve, reject) => {
    const sock = net.connect(Number(o.port) || 7000, host);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('Сервер не отвечает'));
    }, HELLO_MS);

    const done = (err, data) => {
      clearTimeout(timer);
      sock.destroy();
      if (err) reject(err); else resolve(data);
    };

    sock.on('connect', () => sock.write(line({ ...msg, key: o.key || '' })));
    sock.on('data', lineReader(
      (r) => done(r.t === 'err' ? new Error(r.error || 'Сервер отказал') : null, r),
      () => done(new Error('Сервер прислал мусор')),
    ));
    sock.on('error', (e) => done(new Error(`Нет связи с сервером: ${e.code || e.message}`)));
    sock.on('close', () => done(new Error('Сервер закрыл соединение без ответа')));
  });
}

/** Заводит ник на релее. Порт закрепляется за ником навсегда. */
const register = (o) => ask(o, { t: 'register', nick: o.nick, pass: o.pass });

/** Проверяет ник с паролем, не открывая мир */
const auth = (o) => ask(o, { t: 'auth', nick: o.nick, pass: o.pass });

/** Узнаёт адрес мира по нику друга и на чём он играет */
const lookup = (o) => ask(o, { t: 'lookup', nick: o.nick })
  .then((r) => ({
    nick: r.nick,
    address: `${String(o.host).trim()}:${r.port}`,
    online: Boolean(r.online),        // мир открыт, можно заходить
    connected: Boolean(r.connected),  // лаунчер на связи, но мир может быть закрыт
    pack: r.pack || null,
  }));

/** Забирает описание сборки друга целиком */
const pack = (o) => ask(o, { t: 'pack', nick: o.nick }).then((r) => r.pack);

/**
 * Включает трубу до релея.
 * @param {object} o host, port — где стоит релей; key — ключ сервера;
 *   nick, pass — учётка; local — порт перенаправителя
 */
function start(o = {}, events = () => {}) {
  stop();
  onEvent = events;
  opts = {
    host: String(o.host || '').trim(),
    port: Number(o.port) || 7000,
    key: o.key || '',
    nick: String(o.nick || '').trim(),
    pass: String(o.pass || ''),
    local: Number(o.local) || 25565,
    pack: o.pack,                    // undefined — не трогать то, что уже лежит на сервере
  };
  if (!opts.host) throw new Error('Не указан адрес сервера');
  if (!opts.nick || !opts.pass) throw new Error('Сначала заведите ник в окне друзей');

  stopped = false;
  attempt = 0;
  status = { running: false, address: null, error: null };
  connect();
  return state();
}

/**
 * Сообщает серверу, можно ли к нам заходить.
 * Пока мир не открыт в игре, друзья должны видеть «не в сети»: иначе они
 * будут стучаться туда, где их некому встретить.
 */
function setWorld(open) {
  world = Boolean(open);
  if (control && status.running) {
    try { control.write(line({ t: 'world', open: world })); } catch { /* оборвётся — переподключимся */ }
  }
  emit();
  return state();
}

function stop() {
  stopped = true;
  world = false;
  if (retry) clearTimeout(retry);
  retry = null;
  if (control) { try { control.destroy(); } catch { /* уже закрыт */ } }
  control = null;
  status = { running: false, address: null, error: null };
  emit();
  return true;
}

module.exports = { start, stop, state, setWorld, register, auth, lookup, pack };
