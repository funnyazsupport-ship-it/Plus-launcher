'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const UA = 'PlusLauncher/1.0 (+https://github.com/plus-launcher)';

// Без таймаутов зависшее соединение висит вечно: загрузка замирает на «N из M»
// и ничего не происходит. Поэтому ограничиваем и ожидание ответа, и паузы в потоке данных.
const CONNECT_MS = 25000;   // сервер не ответил
const IDLE_MS = 30000;      // ответил, но данные перестали идти
const host = (url) => { try { return new URL(url).host; } catch { return url; } };

/** Понятная ошибка вместо «AbortError» */
function netError(url, e, aborted) {
  if (aborted) return new Error(`${host(url)} не отвечает (таймаут)`);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(e.message)) {
    return new Error(`нет связи с ${host(url)}`);
  }
  return e;
}

async function getJSON(url, headers = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), CONNECT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = netError(url, e, ac.signal.aborted);
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
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
  let lastErr;

  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    // сначала ждём ответа сервера, дальше следим, чтобы данные не замолкали
    let timer = setTimeout(() => ac.abort(), CONNECT_MS);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);

      const body = Readable.fromWeb(res.body);
      const bump = () => {
        clearTimeout(timer);
        timer = setTimeout(() => ac.abort(), IDLE_MS);
      };
      bump();
      body.on('data', bump);

      await pipeline(body, fs.createWriteStream(tmp));
      clearTimeout(timer);

      if (sha1) {
        const got = await sha1File(tmp);
        if (got !== sha1) throw new Error(`файл ${path.basename(dest)} скачался повреждённым`);
      }
      await fsp.rename(tmp, dest);
      return (await fsp.stat(dest)).size;
    } catch (e) {
      clearTimeout(timer);
      lastErr = netError(url, e, ac.signal.aborted);
      try { await fsp.unlink(tmp); } catch {}
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
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

module.exports = { getJSON, postJSON, download, sha1File, pool, exists, UA };
