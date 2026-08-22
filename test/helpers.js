'use strict';
/*
 * Общая обвязка для тестов.
 *
 * Два модуля лаунчера (secret.js и updater.js) требуют electron, которого в обычном
 * node нет. Подменяем его заглушкой до первого require. Плюс уводим папку данных
 * во временную: тесты не должны трогать настоящий config.json пользователя.
 */
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Управляемое состояние системного хранилища — им проверяется поведение при сбое шифрования */
const storage = {
  available: true,
  ready: true,
};

// Шифрование понарошку: важно не как оно устроено, а что расшифровать можно
// только то, что зашифровали мы, и что при недоступности всё падает предсказуемо.
const MARK = 'FAKE-ENC:';

const electronStub = {
  app: {
    isReady: () => storage.ready,
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    on() {},
  },
  safeStorage: {
    isEncryptionAvailable: () => storage.available,
    encryptString(text) {
      if (!storage.available) throw new Error('storage unavailable');
      return Buffer.from(MARK + text, 'utf8');
    },
    decryptString(buf) {
      if (!storage.available) throw new Error('storage unavailable');
      const s = buf.toString('utf8');
      if (!s.startsWith(MARK)) throw new Error('not ours');
      return s.slice(MARK.length);
    },
  },
  ipcMain: { handle() {} },
  BrowserWindow: class {},
  shell: {},
  dialog: {},
  nativeImage: {},
};

const origLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return origLoad.call(this, request, parent, isMain);
};

/** Отдельная папка данных на каждый прогон, чтобы тесты не мешали друг другу */
function useTempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plus-test-'));
  process.env.PLUS_LAUNCHER_ROOT = dir;
  return dir;
}

/** Загружает модуль заново, сбрасывая его кеш и кеш его зависимостей */
function freshRequire(id) {
  const full = require.resolve(id);
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}src${path.sep}main${path.sep}lib${path.sep}`)) delete require.cache[key];
  }
  delete require.cache[full];
  return require(full);
}

/** Загружает файл рендерера, которому нужен window */
function loadRenderer(file) {
  const win = {};
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', file), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'localStorage', 'MutationObserver', code)(
    win,
    { body: {}, documentElement: { setAttribute() {} }, querySelectorAll: () => [] },
    { getItem: () => null, setItem() {} },
    class { observe() {} },
  );
  return win;
}

module.exports = { storage, useTempRoot, freshRequire, loadRenderer, MARK };
