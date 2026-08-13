'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

function appData() {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  return path.join(os.homedir(), '.local', 'share');
}

// Указатель на папку с данными. Лежит в фиксированном месте, потому что сама папка настраивается.
const pointerDir = path.join(appData(), 'PlusLauncher');
const pointerFile = path.join(pointerDir, 'location.json');
const defaultRoot = path.join(appData(), '.plslauncher');

function readPointer() {
  try {
    const p = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
    return typeof p.root === 'string' && p.root.trim() ? path.resolve(p.root) : null;
  } catch { return null; }
}

/** Куда сохранять данные: переменная окружения -> указатель -> папка по умолчанию */
function resolveRoot() {
  if (process.env.PLUS_LAUNCHER_ROOT) return path.resolve(process.env.PLUS_LAUNCHER_ROOT);
  return readPointer() || defaultRoot;
}

/** Запоминает новую папку. Применяется после перезапуска лаунчера. */
function writePointer(newRoot) {
  fs.mkdirSync(pointerDir, { recursive: true });
  fs.writeFileSync(pointerFile, JSON.stringify({ root: path.resolve(newRoot) }, null, 2), 'utf8');
  return path.resolve(newRoot);
}

const root = resolveRoot();

const dirs = {
  root,
  versions: path.join(root, 'versions'),
  libraries: path.join(root, 'libraries'),
  assets: path.join(root, 'assets'),
  assetIndexes: path.join(root, 'assets', 'indexes'),
  assetObjects: path.join(root, 'assets', 'objects'),
  natives: path.join(root, 'natives'),
  runtime: path.join(root, 'runtime'),
  cache: path.join(root, 'cache'),
  logs: path.join(root, 'logs'),
  skins: path.join(root, 'skins'),
};

// Старое расположение игровых папок (до версии с папкой на каждую версию)
const legacyInstances = path.join(root, 'instances');

// Служебные каталоги — игровая папка версии не может называться так же
const RESERVED = new Set(['versions', 'libraries', 'assets', 'natives', 'runtime', 'cache', 'logs', 'instances', 'skins', 'build']);

function ensureDirs() {
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
}

/** Имя версии -> безопасное имя папки: 1.21.4 остаётся 1.21.4 */
function folderName(name) {
  const clean = String(name || '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^[.-]+/, '') || 'game';
  return RESERVED.has(clean.toLowerCase()) ? `mc-${clean}` : clean;
}

/** Игровая папка версии: <корень лаунчера>\1.21.4 — со своими mods, saves, config */
function gameDir(name) {
  return path.join(root, folderName(name));
}

function legacyInstanceDir(id) {
  return path.join(legacyInstances, String(id).replace(/[^a-zA-Z0-9._-]/g, '_'));
}

function osName() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'osx';
  return 'linux';
}

function osArch() {
  return process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : 'x64';
}

// каталоги создаём сразу при импорте — любой модуль может писать в них
ensureDirs();

module.exports = {
  dirs, ensureDirs, gameDir, folderName, legacyInstances, legacyInstanceDir,
  osName, osArch, configFile: path.join(root, 'config.json'),
  defaultRoot, pointerFile, readPointer, writePointer, resolveRoot,
};
