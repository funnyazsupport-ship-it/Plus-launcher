'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const { dirs } = require('./paths');
const java = require('./java');
const versions = require('./versions');

/*
 * OptiFine.
 *
 * У него нет ни каталога с описанием версий, ни прямых ссылок: список лежит
 * обычной страницей, а файл выдаётся по одноразовой ссылке с промежуточной
 * страницы. Поэтому здесь разбор разметки — другого способа нет. Разметка у
 * них меняется редко, но если поменяется, сломается именно этот файл, а не
 * весь лаунчер: список просто окажется пустым.
 *
 * Ставится он тоже своеобразно: собственный установщик умеет класть версию
 * только в стандартную папку .minecraft и не принимает путь. Обойти это можно,
 * подменив ему представление о домашней папке — см. runInstaller.
 */

const SITE = 'https://optifine.net';
const LIST_TTL = 60 * 60 * 1000;          // список версий меняется в лучшем случае раз в недели
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

// OptiFine_1.21.11_HD_U_J9.jar, preview_OptiFine_26.1.2_HD_U_K1_pre2.jar
const FILE = /^(preview_)?OptiFine_(.+?)_(HD_U_[A-Z]+\d*(?:_pre\d+)?)\.jar$/;

/** Простой запрос: у нас нет зависимостей для http, а нужно немного */
function fetchPage(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': UA, ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchPage(new URL(res.headers.location, url).href, headers));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ code: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

let cache = null;
let cachedAt = 0;

/**
 * Все сборки OptiFine, разложенные по версиям игры.
 * @returns {Promise<Object<string, Array<{file: string, edition: string, preview: boolean}>>>}
 */
async function list(force = false) {
  if (cache && !force && Date.now() - cachedAt < LIST_TTL) return cache;

  const { code, body } = await fetchPage(`${SITE}/downloads`);
  if (code !== 200) throw new Error(`OptiFine ответил ошибкой ${code}`);

  const html = body.toString();
  const files = [...new Set([...html.matchAll(/adloadx\?f=((?:preview_)?OptiFine_[^"'&]+\.jar)/g)].map((m) => m[1]))];

  const out = {};
  for (const file of files) {
    const m = file.match(FILE);
    if (!m) continue;                     // незнакомое имя — пропускаем, а не гадаем
    (out[m[2]] = out[m[2]] || []).push({ file, edition: m[3], preview: Boolean(m[1]) });
  }
  if (!Object.keys(out).length) throw new Error('OptiFine не отдал список версий');

  cache = out;
  cachedAt = Date.now();
  return out;
}

/** Сборки для одной версии игры: сначала обычные, предварительные ниже */
async function forVersion(mc) {
  const all = await list();
  return (all[String(mc)] || []).slice().sort((a, b) => Number(a.preview) - Number(b.preview));
}

/**
 * Забирает jar.
 * Прямой ссылки нет: сначала промежуточная страница, на ней одноразовый ключ.
 */
async function downloadJar(file, dest, onProgress = () => {}) {
  onProgress({ stage: 'Ищу файл OptiFine', percent: 10 });
  const page = `${SITE}/adloadx?f=${encodeURIComponent(file)}`;
  const { body } = await fetchPage(page);
  const m = body.toString().match(/downloadx\?f=([^"'&]+)&x=([a-f0-9]+)/i);
  if (!m) throw new Error('OptiFine не дал ссылку на файл — возможно, у них изменилась страница');

  onProgress({ stage: 'Скачиваю OptiFine', percent: 30 });
  const jar = await fetchPage(`${SITE}/downloadx?f=${m[1]}&x=${m[2]}`, { referer: page });
  // сервер отвечает 200 и на «файла нет», поэтому проверяем сам файл
  if (jar.body.length < 100000 || jar.body.slice(0, 2).toString() !== 'PK') {
    throw new Error(`OptiFine не отдал файл: ${jar.body.slice(0, 120).toString().trim()}`);
  }

  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, jar.body);
  return dest;
}

/**
 * Готовит подставную домашнюю папку.
 *
 * Установщик OptiFine кладёт версию только туда, где по его мнению лежит
 * .minecraft, и своего пути не принимает. Поэтому даём ему отдельную домашнюю
 * папку, внутри которой .minecraft — ссылка на нашу. Ссылка на папку в Windows
 * прав администратора не требует.
 */
async function fakeHome() {
  const home = path.join(dirs.cache, 'optifine-home');
  const link = path.join(home, '.minecraft');
  await fsp.mkdir(home, { recursive: true });

  try {
    const st = await fsp.lstat(link);
    if (st.isSymbolicLink() || st.isDirectory()) return home;
  } catch { /* ссылки ещё нет */ }

  await fsp.symlink(dirs.root, link, process.platform === 'win32' ? 'junction' : 'dir');
  return home;
}

/** Запускает установщик OptiFine, подсунув ему нашу папку вместо .minecraft */
function runInstaller(javaPath, jar, home, onProgress) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (process.platform === 'win32') env.APPDATA = home;
    else env.HOME = home;

    const p = spawn(javaPath, ['-cp', jar, 'optifine.Installer'], { env, windowsHide: true });
    let log = '';
    const watch = (d) => {
      log += d;
      const line = String(d).trim().split('\n').pop();
      if (line) onProgress({ stage: 'Устанавливаю OptiFine', percent: 70, detail: line.slice(0, 90) });
    };
    p.stdout.on('data', watch);
    p.stderr.on('data', watch);
    p.on('error', reject);
    p.on('close', (code) => (code === 0
      ? resolve(log)
      : reject(new Error(`Установщик OptiFine вышел с кодом ${code}\n${log.slice(-500)}`))));
  });
}

/**
 * Ставит OptiFine и возвращает id версии для запуска.
 * @param {string} mc версия игры
 * @param {string} file имя файла из списка
 */
async function install(mc, file, onProgress = () => {}) {
  const m = String(file).match(FILE);
  if (!m) throw new Error('Непонятное имя файла OptiFine');
  const expected = `${m[2]}-OptiFine_${m[3]}`;

  // OptiFine правит ванильную версию, поэтому она должна быть на месте
  onProgress({ stage: `Проверяю Minecraft ${mc}`, percent: 5 });
  await versions.install(mc, (p) => onProgress({ ...p, percent: 5 + Math.round((p.percent || 0) * 0.2) }));

  const jar = path.join(dirs.cache, 'optifine', file);
  if (!fs.existsSync(jar)) await downloadJar(file, jar, onProgress);

  // установщику нужен этот файл, иначе он отказывается работать
  const profiles = path.join(dirs.root, 'launcher_profiles.json');
  if (!fs.existsSync(profiles)) {
    await fsp.writeFile(profiles, JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2));
  }

  onProgress({ stage: 'Проверка Java', percent: 55 });
  const javaPath = await java.ensure(java.requiredMajor({ id: mc }), '', (p) => onProgress(p));

  const home = await fakeHome();
  await runInstaller(javaPath, jar, home, onProgress);

  if (!fs.existsSync(path.join(dirs.versions, expected, `${expected}.json`))) {
    throw new Error('Установщик OptiFine не создал версию — попробуйте другую сборку');
  }
  onProgress({ stage: 'Готово', percent: 100 });
  return expected;
}

module.exports = { list, forVersion, downloadJar, install, FILE };
