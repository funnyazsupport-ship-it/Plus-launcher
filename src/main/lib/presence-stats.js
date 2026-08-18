'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dirs } = require('./paths');
const config = require('./config');
const appConfig = require('./app-config');

/**
 * Счётчик игроков для сайта.
 *
 * Пока идёт игра, лаунчер раз в минуту отмечается на сервере. Уходит только
 * случайный идентификатор этой установки — ни ника, ни аккаунта, ни версии игры,
 * ни адреса сервера, на котором играют. По этим данным нельзя понять, кто играет:
 * они годятся ровно на то, чтобы посчитать, сколько человек сейчас в игре.
 *
 * Выключается галочкой в настройках, и тогда никаких запросов не уходит вовсе.
 */
const EVERY_MS = 60 * 1000;
const TIMEOUT_MS = 8000;

let timer = null;

/** Постоянный случайный номер этой установки. К аккаунту и компьютеру не привязан. */
function installId() {
  const file = path.join(dirs.cache, 'install-id');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{32}$/.test(saved)) return saved;
  } catch { /* создадим ниже */ }

  const id = crypto.randomBytes(16).toString('hex');
  try { fs.writeFileSync(file, id, 'utf8'); } catch { /* переживём и без файла */ }
  return id;
}

const endpoint = () => String(appConfig.statsUrl || '').replace(/\/+$/, '');

/** Одна отметка. Ошибки глушим: счётчик на сайте не повод мешать игре. */
async function ping() {
  const url = endpoint();
  if (!url || config.load().shareStats === false) return false;

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/ping.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: installId() }),
      signal: ac.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Начинает отмечаться: сразу и потом раз в минуту, пока идёт игра */
function start() {
  stop();
  if (!endpoint() || config.load().shareStats === false) return;
  ping();
  timer = setInterval(ping, EVERY_MS);
  if (timer.unref) timer.unref();            // таймер не должен держать процесс при выходе
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

const enabled = () => Boolean(endpoint()) && config.load().shareStats !== false;

module.exports = { start, stop, ping, enabled, installId };
