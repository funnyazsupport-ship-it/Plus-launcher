'use strict';
const net = require('net');
const friends = require('./friends');

/*
 * Игра с другом без модов и Radmin.
 *
 * Minecraft умеет открывать мир «для сети», но выбирает случайный порт и пускает
 * только тех, кто в той же домашней сети. Наружу его пускает туннель (playit.gg),
 * но туннель настраивается на один постоянный адрес, а порт мира каждый раз новый.
 *
 * Мостом служит этот перенаправитель: он слушает постоянный порт и переливает
 * всё, что придёт, на текущий порт мира. Тогда туннель настраивается один раз
 * и работает дальше сам, сколько бы раз игру ни перезапускали.
 *
 * Своего протокола тут нет: байты переносятся как есть, в обе стороны.
 */

const DEFAULT_PORT = 25565;          // привычный порт Minecraft
const IDLE_MS = 20000;               // столько ждём отклика игры на новом соединении

// «Local game hosted on port 54321» — так игра сообщает, что мир открыт для сети.
// Формулировка менялась между версиями, поэтому ловим оба варианта.
const LAN_LINE = /(?:Local game hosted on port|Started serving on)\s+(\d{2,5})/i;

/** Достаёт порт открытого мира из строки журнала игры, иначе null */
function lanPortFrom(line) {
  const m = String(line || '').match(LAN_LINE);
  if (!m) return null;
  const port = Number(m[1]);
  return port > 0 && port < 65536 ? port : null;
}

let server = null;
let target = null;                   // текущий порт мира
let listenPort = DEFAULT_PORT;
const sockets = new Set();
let onEvent = () => {};

const state = () => ({
  running: Boolean(server),
  port: server ? listenPort : null,
  target,
  players: sockets.size / 2 | 0,     // на каждого игрока два соединения: к нам и к игре
});

/** Переливает данные между двумя соединениями и следит, чтобы оба закрылись вместе */
function pipeBoth(from, to) {
  sockets.add(from);
  sockets.add(to);
  const done = () => {
    sockets.delete(from);
    sockets.delete(to);
    from.destroy();
    to.destroy();
    onEvent('players', state());
  };
  from.pipe(to);
  to.pipe(from);
  for (const s of [from, to]) {
    s.on('error', done);
    s.on('close', done);
    s.setTimeout(0);                 // игровое соединение живёт долго, таймаут не нужен
  }
  onEvent('players', state());
}

/**
 * Поднимает перенаправитель.
 * @param {number} port постоянный порт, который указывается в туннеле
 */
function start(port = DEFAULT_PORT, events = () => {}) {
  onEvent = events;
  if (server) stop();
  // 0 значит «любой свободный»: при работе через сервер друзей номер порта
  // никому снаружи не нужен, и держаться за 25565 незачем — он часто занят
  listenPort = Number(port) === 0 ? 0 : (Number(port) || DEFAULT_PORT);

  return new Promise((resolve, reject) => {
    const srv = net.createServer((incoming) => {
      if (!friends.incomingAllowed()) {
        // в настройках закрыли доступ — не пускаем никого
        incoming.destroy();
        return;
      }
      if (!target) {
        // мир ещё не открыт — вежливо закрываем, иначе друг будет ждать впустую
        incoming.destroy();
        return;
      }
      const out = net.connect(target, '127.0.0.1');
      out.setTimeout(IDLE_MS, () => out.destroy());
      out.on('connect', () => { out.setTimeout(0); pipeBoth(incoming, out); });
      out.on('error', () => incoming.destroy());
    });

    srv.on('error', (e) => {
      server = null;
      if (e.code === 'EADDRINUSE') return reject(new Error(`Порт ${listenPort} уже занят другой программой`));
      // на Windows так отвечает и порт, занятый чужой службой, и попавший
      // в зарезервированный системой промежуток — сообщение одинаково бесполезное
      if (e.code === 'EACCES') return reject(new Error(`Порт ${listenPort} занят системой или другой программой`));
      reject(e);
    });

    srv.listen(listenPort, '0.0.0.0', () => {
      server = srv;
      // при порте 0 его выбирает система — запоминаем, какой достался
      listenPort = srv.address().port;
      onEvent('state', state());
      resolve(state());
    });
  });
}

function stop() {
  for (const s of sockets) { try { s.destroy(); } catch { /* уже закрыт */ } }
  sockets.clear();
  if (server) { try { server.close(); } catch { /* уже закрыт */ } }
  server = null;
  target = null;
  onEvent('state', state());
  return true;
}

/** Куда пересылать: порт мира, который игра только что открыла */
function setTarget(port) {
  target = Number(port) || null;
  onEvent('state', state());
  return state();
}

module.exports = { start, stop, setTarget, state, lanPortFrom, DEFAULT_PORT };
