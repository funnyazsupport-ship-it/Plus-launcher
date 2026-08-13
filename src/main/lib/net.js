'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const UA = 'PlusLauncher/1.0 (+https://github.com/plus-launcher)';

async function getJSON(url, headers = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
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
async function download(url, dest, { sha1 = null, size = null, tries = 3, headers = {} } = {}) {
  if (await exists(dest)) {
    try {
      const st = await fsp.stat(dest);
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
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      if (sha1) {
        const got = await sha1File(tmp);
        if (got !== sha1) throw new Error(`sha1 mismatch для ${path.basename(dest)}: ${got} != ${sha1}`);
      }
      await fsp.rename(tmp, dest);
      const st = await fsp.stat(dest);
      return st.size;
    } catch (e) {
      lastErr = e;
      try { await fsp.unlink(tmp); } catch {}
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
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
