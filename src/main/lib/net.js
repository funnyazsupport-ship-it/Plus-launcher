'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const mirrors = require('./mirrors');

const UA = 'PlusLauncher/1.0 (+https://github.com/plus-launcher)';

// Без таймаутов зависшее соединение висит вечно: загрузка замирает на «N из M»
// и ничего не происходит. Поэтому ограничиваем и ожидание ответа, и паузы в потоке данных.
const CONNECT_MS = 25000;   // сервер не ответил
const IDLE_MS = 30000;      // ответил, но данные перестали идти
const host = (url) => { try { return new URL(url).host; } catch { return url; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Расписание попыток: сначала по одному заходу на каждый источник,
 * потом повторы по кругу. Так недоступный Mojang стоит одного таймаута,
 * а не всех попыток подряд.
 */
function plan(url, tries) {
  const list = mirrors.candidates(url);
  const out = [...list];
  for (let i = list.length; i < tries; i++) out.push(list[i % list.length]);
  return out;
}

/** Отвечать 403/404 будет и дальше — повторять по этому адресу смысла нет */
const deadEnd = (e) => /HTTP (40[0-46]|41[0-5])/.test(String(e && e.message));

/** Выбрасывает из очереди оставшиеся попытки по тому же адресу */
function dropAll(queue, target) {
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i] === target) queue.splice(i, 1);
}

/** Понятная ошибка вместо «AbortError» */
function netError(url, e, aborted) {
  if (aborted) return new Error(`${host(url)} не отвечает (таймаут)`);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(e.message)) {
    return new Error(`нет связи с ${host(url)}`);
  }
  return e;
}

async function getJSON(url, headers = {}, tries = 3) {
  const queue = plan(url, tries);
  let lastErr;
  let attempt = 0;
  while (queue.length) {
    const target = queue.shift();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), CONNECT_MS);
    try {
      const res = await fetch(target, {
        headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${target}`);
      const data = await res.json();
      mirrors.worked(url, target);
      return data;
    } catch (e) {
      lastErr = netError(target, e, ac.signal.aborted);
      // 404 на зеркале — этого файла там нет и не появится, повторы выкидываем
      if (deadEnd(e)) dropAll(queue, target);
      else if (queue.length) await sleep(400 * (attempt + 1));
      attempt += 1;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function postJSON(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} — ${url} — ${text.slice(0, 300)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

/**
 * Скачивает файл. Пропускает, если файл уже есть и sha1/размер совпадают.
 * @returns {Promise<number>} количество скачанных байт (0 = уже был)
 */
async function download(url, dest, { sha1 = null, size = null, tries = 4, headers = {}, trustSize = false } = {}) {
  if (await exists(dest)) {
    try {
      const st = await fsp.stat(dest);
      // trustSize — для ресурсов игры: их тысячи, и считать sha1 каждого при каждой проверке
      // слишком долго. Свежескачанное всё равно сверяется по sha1 ниже.
      if (trustSize && size && st.size === size) return 0;
      if (sha1) {
        if ((await sha1File(dest)) === sha1) return 0;
      } else if (size ? st.size === size : st.size > 0) {
        return 0;
      }
    } catch { /* перекачаем */ }
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const queue = plan(url, tries);
  let lastErr;
  let attempt = 0;

  while (queue.length) {
    const target = queue.shift();
    const ac = new AbortController();
    // сначала ждём ответа сервера, дальше следим, чтобы данные не замолкали
    let timer = setTimeout(() => ac.abort(), CONNECT_MS);
    try {
      const res = await fetch(target, { headers: { 'User-Agent': UA, ...headers }, signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${target}`);

      const body = Readable.fromWeb(res.body);
      const bump = () => {
        clearTimeout(timer);
        timer = setTimeout(() => ac.abort(), IDLE_MS);
      };
      bump();
      body.on('data', bump);

      await pipeline(body, fs.createWriteStream(tmp));
      clearTimeout(timer);

      // sha1 из манифеста Mojang — заодно и защита от подменённого файла на зеркале
      if (sha1) {
        const got = await sha1File(tmp);
        if (got !== sha1) throw new Error(`файл ${path.basename(dest)} скачался повреждённым`);
      }
      await fsp.rename(tmp, dest);
      mirrors.worked(url, target);
      return (await fsp.stat(dest)).size;
    } catch (e) {
      clearTimeout(timer);
      lastErr = netError(target, e, ac.signal.aborted);
      try { await fsp.unlink(tmp); } catch {}
      if (deadEnd(e)) dropAll(queue, target);
      else if (queue.length) await sleep(600 * (attempt + 1));
      attempt += 1;
    }
  }
  throw lastErr;
}

/** Параллельный запуск задач с ограничением конкурентности */
async function pool(items, limit, worker) {
  const queue = [...items];
  const results = [];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      results.push(await worker(item));
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Одиночная проверка «отвечает ли сервис». Любой HTTP-ответ считается успехом:
 * 401 или 404 значат, что сервер доступен, а сеть до него доходит.
 * Зеркала здесь не подставляются — проверяем именно указанный адрес.
 */
async function ping(url, { headers = {}, timeout = 8000 } = {}) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ac.signal });
    return { ok: true, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: ac.signal.aborted ? 'нет ответа (таймаут)' : netError(url, e, false).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getJSON, postJSON, download, sha1File, pool, exists, ping, UA };
