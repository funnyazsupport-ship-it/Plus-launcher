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
  // Отмечаться в счётчике игроков на сайте, пока идёт игра.
  // Уходит только случайный номер установки, без ника и аккаунта.
  shareStats: true,
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

/*
 * Токены аккаунтов на диске держим зашифрованными.
 * Украденный config.json — это чужой вход в игру и доступ к скинам, поэтому
 * шифруем тем же системным хранилищем, что и ключ CurseForge (на Windows — DPAPI):
 * файл, унесённый на другой компьютер, ничего не даст.
 * В памяти токены лежат расшифрованными — так остальному коду ничего менять не нужно.
 */
const TOKEN_FIELDS = ['accessToken', 'refreshToken', 'clientToken'];

// оффлайн-профилю шифровать нечего: там вместо токена постоянная строка «0»
const isReal = (a) => a && a.type !== 'offline';

/*
 * Исходные значения с диска. Конфиг может быть прочитан до готовности приложения —
 * тогда системное хранилище ещё не работает и расшифровать нечем. Такие значения
 * запоминаются здесь и при сохранении возвращаются на диск нетронутыми:
 * записать пустоту поверх живого токена значит разлогинить человека.
 * Symbol не попадает в JSON, поэтому в файле его не видно.
 */
const RAW = Symbol('token-blobs');

function decryptAccount(a) {
  if (!isReal(a)) return a;
  const out = { ...a };
  const unread = {};
  for (const f of TOKEN_FIELDS) {
    if (!a[f]) continue;
    const value = secret.decrypt(a[f]);
    if (!value) unread[f] = a[f];              // расшифровать не вышло
    out[f] = value;
  }
  if (Object.keys(unread).length) out[RAW] = unread;
  return out;
}

function encryptAccount(a) {
  if (!isReal(a)) return a;
  const unread = a[RAW];
  const out = { ...a };
  for (const f of TOKEN_FIELDS) {
    if (unread && unread[f] !== undefined) out[f] = unread[f];   // возвращаем как было
    else if (out[f]) out[f] = secret.encrypt(out[f]);
  }
  return out;
}

let cache = null;
let cacheEncrypted = false;                    // было ли шифрование доступно при чтении

function load() {
  // Конфиг могли прочитать до готовности приложения — тогда системное хранилище
  // ещё не работало и токены расшифровать не удалось. Перечитываем, когда сможем.
  if (cache && (cacheEncrypted || !secret.available())) return cache;
  ensureDirs();
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  cacheEncrypted = secret.available();
  cache.accounts = (cache.accounts || []).map(decryptAccount);
  return cache;
}

function save(patch = {}) {
  const cfg = { ...load(), ...patch };
  delete cfg.curseforgeKey;                    // открытым текстом ключ не пишем никогда
  cache = cfg;

  const onDisk = { ...cfg, accounts: (cfg.accounts || []).map(encryptAccount) };
  fs.writeFileSync(configFile, JSON.stringify(onDisk, null, 2), 'utf8');
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
