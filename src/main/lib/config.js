'use strict';
const fs = require('fs');
const os = require('os');
const { configFile, ensureDirs } = require('./paths');
const secret = require('./secret');

// Ключ CurseForge, вшитый в сборку. Файл не хранится в git — при публикации
// исходников ключ не утечёт, а пользователи вписывают свой в настройках.
let embeddedKey = () => '';
try { embeddedKey = require('./embedded-key'); } catch { /* сборка без вшитого ключа */ }

const DEFAULTS = {
  // Память в МБ
  minRam: 1024,
  maxRam: Math.min(6144, Math.max(2048, Math.floor(os.totalmem() / 1024 / 1024 / 2))),
  javaPath: '',            // пусто = автопоиск
  jvmArgs: '-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions -XX:G1NewSizePercent=20 -XX:MaxGCPauseMillis=50',
  width: 1280,
  height: 720,
  fullscreen: false,
  closeOnLaunch: false,     // сворачивать лаунчер при старте игры
  showSnapshots: true,
  showOld: true,
  // Ключ CurseForge API хранится зашифрованным в curseforgeKeyEnc — открытым текстом его тут нет
  curseforgeKeyEnc: '',
  checkUpdatesOnStart: true,
  // Язык интерфейса (ru, en, uk) и тема оформления (dark, light, system)
  lang: 'ru',
  theme: 'dark',
  // Копировать миры перед запуском игры и сколько копий каждого мира хранить
  backupBeforePlay: false,
  backupKeep: 5,
  // Зеркала для файлов игры: auto — официальный сервер, зеркало как запасной;
  // mirror — сразу через зеркало; off — только официальные серверы.
  mirrors: 'auto',
  // Разбор вылетов через DeepSeek: лог отправляется на сервис, поэтому это отключаемо
  aiCrashHelp: true,
  // Discord Rich Presence. Application ID, ключ картинки, адрес репозитория обновлений
  // и client id Microsoft лежат в app-config.js — это настройки разработчика.
  discordEnabled: true,
  discordShowInstance: true,
  accounts: [],
  activeAccount: null,
  instances: [],
  lastInstance: null,
};

let cache = null;

function load() {
  if (cache) return cache;
  ensureDirs();
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch = {}) {
  const cfg = { ...load(), ...patch };
  delete cfg.curseforgeKey;                    // открытым текстом ключ не пишем никогда
  cache = cfg;
  fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

// Настройки, которые сборка может переопределить. Пусто или null — берём общее
// значение из настроек лаунчера, чтобы менять память сразу везде было по-прежнему просто.
const PER_INSTANCE = ['minRam', 'maxRam', 'javaPath', 'jvmArgs'];

/**
 * Настройки для запуска конкретной сборки: общие, поверх них — свои.
 * Тяжёлому модпаку нужно 8 ГБ и Java 21, а сборке на 1.7.10 — 2 ГБ и Java 8,
 * одним общим значением это не обслужить.
 */
function effectiveFor(instance = {}) {
  const cfg = load();
  const out = { ...cfg };
  for (const key of PER_INSTANCE) {
    const v = instance[key];
    if (v === null || v === undefined || v === '') continue;
    out[key] = v;
  }
  return out;
}

/** Какие настройки у сборки заданы свои — для подписи в интерфейсе */
const overridesOf = (instance = {}) =>
  PER_INSTANCE.filter((k) => instance[k] !== null && instance[k] !== undefined && instance[k] !== '');

// ---------- ключ CurseForge ----------

/** Ключ для запросов: свой из настроек, иначе вшитый в сборку */
function curseforgeKey() {
  const cfg = load();
  const own = secret.decrypt(cfg.curseforgeKeyEnc);
  return own || embeddedKey() || '';
}

function setCurseforgeKey(value) {
  return save({ curseforgeKeyEnc: value ? secret.encrypt(value) : '' });
}

/** Свой ли ключ задан (не вшитый) */
const hasOwnCurseforgeKey = () => Boolean(secret.decrypt(load().curseforgeKeyEnc));

/**
 * Переводит старые конфиги на шифрование: ключ мог лежать открытым текстом
 * (или зашифроваться до готовности системного хранилища).
 */
/** Настройки, переехавшие в app-config.js: чистим, чтобы не путали в config.json */
const MOVED_TO_CODE = ['discordAppId', 'discordImage', 'updateRepo', 'msClientId'];

function dropMovedKeys() {
  const cfg = load();
  const found = MOVED_TO_CODE.filter((k) => k in cfg);
  if (!found.length) return false;
  for (const k of found) delete cache[k];
  save();
  return true;
}

function migrateSecrets() {
  const cfg = load();
  const plain = cfg.curseforgeKey || (secret.isPlain(cfg.curseforgeKeyEnc) ? secret.decrypt(cfg.curseforgeKeyEnc) : '');
  if (!plain) return false;
  save({ curseforgeKeyEnc: secret.encrypt(plain) });
  return true;
}

module.exports = {
  load, save, DEFAULTS, curseforgeKey, setCurseforgeKey, hasOwnCurseforgeKey,
  migrateSecrets, dropMovedKeys, effectiveFor, overridesOf, PER_INSTANCE,
};
