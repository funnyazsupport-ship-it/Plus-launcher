'use strict';
const net = require('net');
const crypto = require('crypto');

/**
 * Rich Presence для Discord по его локальному IPC — без сторонних библиотек.
 * Формат кадра: opcode (int32 LE) + длина (int32 LE) + JSON.
 */
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

// PLUS_DISCORD_PIPE — явный канал (используется в тестах вместо перебора 0..9)
const pipePath = (i) => process.env.PLUS_DISCORD_PIPE || (process.platform === 'win32'
  ? `\\\\?\\pipe\\discord-ipc-${i}`
  : `${process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp'}/discord-ipc-${i}`);

const lastPipeIndex = () => (process.env.PLUS_DISCORD_PIPE ? 0 : 9);

let socket = null;
let connected = false;
let clientId = null;
let enabled = false;
let lastError = null;
let lastActivity = null;
let reconnectTimer = null;
let onChange = () => {};

function encode(op, payload) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(data.length, 4);
  return Buffer.concat([head, data]);
}

/** Разбирает поток кадров: буферизуем, пока не наберётся целый кадр */
function makeReader(onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const op = buf.readInt32LE(0);
      const len = buf.readInt32LE(4);
      if (buf.length < 8 + len) return;
      const body = buf.subarray(8, 8 + len).toString('utf8');
      buf = buf.subarray(8 + len);
      let json = null;
      try { json = JSON.parse(body); } catch { /* мусор — пропускаем */ }
      if (json) onFrame(op, json);
    }
  };
}

function cleanup() {
  if (socket) {
    socket.removeAllListeners();
    socket.destroy();
    socket = null;
  }
  connected = false;
}

function scheduleReconnect(delay = 30000) {
  if (reconnectTimer || !enabled || !clientId) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(clientId).catch(() => {});
  }, delay);
}

/** Перебирает каналы discord-ipc-0..9, пока какой-нибудь не ответит READY */
function connect(id, index = 0) {
  clientId = id;
  return new Promise((resolve, reject) => {
    if (index > lastPipeIndex()) {
      lastError = 'Discord не запущен';
      onChange();
      scheduleReconnect();
      reject(new Error(lastError));
      return;
    }
    const sock = net.createConnection(pipePath(index));
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      sock.removeAllListeners();
      sock.destroy();
      // канал занят/недоступен — пробуем следующий
      connect(id, index + 1).then(resolve, reject);
    };

    sock.on('error', fail);
    sock.on('connect', () => sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: String(id) })));
    sock.on('data', makeReader((op, frame) => {
      if (op === OP.CLOSE) {
        // Discord ответил отказом — чаще всего неверный Application ID
        if (!settled) {
          settled = true;
          lastError = frame.message || 'Discord отклонил подключение';
          cleanup();
          onChange();
          reject(new Error(lastError));
        }
        return;
      }
      if (frame.evt === 'READY') {
        settled = true;
        socket = sock;
        connected = true;
        lastError = null;
        sock.removeListener('error', fail);
        sock.on('error', () => { cleanup(); onChange(); scheduleReconnect(); });
        sock.on('close', () => { cleanup(); onChange(); scheduleReconnect(); });
        onChange();
        if (lastActivity) setActivity(lastActivity);
        resolve({ user: frame.data?.user?.username || null });
      }
    }));
  });
}

/** Отправляет присутствие. activity = null убирает статус. */
function setActivity(activity) {
  lastActivity = activity;
  if (!connected || !socket) return false;
  try {
    socket.write(encode(OP.FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: activity || undefined },
      nonce: crypto.randomUUID(),
    }));
    return true;
  } catch {
    cleanup();
    onChange();
    scheduleReconnect();
    return false;
  }
}

/** Включает интеграцию (или переподключает с новым Application ID) */
async function enable(id, notify = () => {}) {
  onChange = notify;
  enabled = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (connected && clientId === String(id)) return { connected: true };
  cleanup();
  const r = await connect(String(id));
  return { connected: true, ...r };
}

function disable() {
  enabled = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  setActivity(null);
  lastActivity = null;
  cleanup();
  lastError = null;
  onChange();
}

const status = () => ({ enabled, connected, error: lastError, clientId });

module.exports = { enable, disable, setActivity, status, encode, pipePath };
