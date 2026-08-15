'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { execFile } = require('child_process');

const { dirs, ensureDirs, gameDir, folderName, legacyInstanceDir, legacyInstances } = require('./lib/paths');
const config = require('./lib/config');
const net = require('./lib/net');
const versions = require('./lib/versions');
const loaders = require('./lib/loaders');
const javaLib = require('./lib/java');
const auth = require('./lib/auth');
const ely = require('./lib/ely');
const mods = require('./lib/mods');
const modUpdates = require('./lib/mod-updates');
const backups = require('./lib/backups');
const skins = require('./lib/skins');
const storage = require('./lib/storage');
const updater = require('./lib/updater');
const discord = require('./lib/discord');
const ai = require('./lib/ai');
const mirrors = require('./lib/mirrors');
const connectivity = require('./lib/connectivity');
const appConfig = require('./lib/app-config');
const { launch } = require('./lib/launch');

let win = null;
let gameProcess = null;
let cancelLogin = false;

ensureDirs();

/**
 * Имя игровой папки для сборки: по умолчанию — версия игры (1.21.4).
 * Если такая папка уже занята другой сборкой, добавляем загрузчик (1.21.4-fabric),
 * а если и это занято — порядковый номер. Так моды разных версий никогда не смешиваются.
 */
function pickFolder(mc, loader, instances) {
  const taken = new Set(instances.map((i) => String(i.folder || '').toLowerCase()));
  const base = folderName(mc);
  if (!taken.has(base.toLowerCase())) return base;
  if (loader && loader !== 'vanilla') {
    const withLoader = folderName(`${mc}-${loader}`);
    if (!taken.has(withLoader.toLowerCase())) return withLoader;
  }
  for (let n = 2; ; n++) {
    const candidate = folderName(`${mc}-${n}`);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Убирает пустой каталог instances, оставшийся от старой схемы */
function dropLegacyDir() {
  try {
    if (fs.existsSync(legacyInstances) && !fs.readdirSync(legacyInstances).length) fs.rmSync(legacyInstances, { recursive: true, force: true });
  } catch { /* занят системой — уберём при следующем запуске */ }
}

/** Переезд со старой схемы instances/<id> на папку версии */
function migrateInstances() {
  const cfg = config.load();
  if (!cfg.instances.some((i) => !i.folder)) return;
  const instances = [];
  for (const inst of cfg.instances) {
    if (inst.folder) { instances.push(inst); continue; }
    const folder = pickFolder(inst.mc || inst.versionId, inst.loader, instances);
    const from = legacyInstanceDir(inst.id);
    const to = gameDir(folder);
    try {
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        fs.renameSync(from, to);
        console.log(`[migrate] ${from} -> ${to}`);
      }
    } catch (e) {
      console.warn('[migrate]', e.message);
    }
    instances.push({ ...inst, folder });
  }
  config.save({ instances });
}
migrateInstances();
dropLegacyDir();

// перешифровка старых конфигов — только когда системное хранилище готово
app.whenReady().then(() => {
  if (config.migrateSecrets()) console.log('[secret] ключ CurseForge переведён в зашифрованный вид');
  if (config.dropMovedKeys()) console.log('[config] убраны настройки, переехавшие в app-config.js');
});

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 740,
    minWidth: 940,
    minHeight: 620,
    frame: false,
    backgroundColor: '#0d0f18',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
    win.webContents.on('console-message', (_e, level, message, line, source) =>
      console.log(`[renderer:${level}] ${message} (${String(source).split('/').pop()}:${line})`));
  }
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

/**
 * Кладём путь к данным в реестр: деинсталлятор по нему находит папку с версиями,
 * чтобы предложить удалить их вместе с лаунчером.
 */
function rememberDataDir() {
  if (process.platform !== 'win32') return;
  execFile('reg', ['add', 'HKCU\\Software\\Plus Launcher', '/v', 'DataDir', '/t', 'REG_SZ', '/d', dirs.root, '/f'],
    (e) => { if (e) console.warn('[reg]', e.message); });
}

app.whenReady().then(() => {
  createWindow();
  applyDiscord();
  rememberDataDir();
});
app.on('before-quit', () => discord.disable());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }
const progress = (taskId) => (p) => send('progress', { taskId, ...p });

function handle(name, fn) {
  ipcMain.handle(name, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      console.error(`[ipc ${name}]`, e);
      return { ok: false, error: e.message || String(e) };
    }
  });
}

// ---------- окно ----------
/** Обработчик, которому нужно знать, из какого окна пришёл запрос */
function handleEvent(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    try {
      return { ok: true, data: await fn(event, ...args) };
    } catch (e) {
      console.error(`[ipc ${name}]`, e);
      return { ok: false, error: e.message || String(e) };
    }
  });
}

// кнопки управления работают со своим окном: у помощника оно отдельное
const senderWin = (event) => BrowserWindow.fromWebContents(event.sender) || win;

handleEvent('win:minimize', (e) => senderWin(e).minimize());
handleEvent('win:maximize', (e) => {
  const w = senderWin(e);
  return w.isMaximized() ? w.unmaximize() : w.maximize();
});
handleEvent('win:close', (e) => senderWin(e).close());
handle('shell:open', (url) => shell.openExternal(url));
handle('shell:openPath', (p) => shell.openPath(p));

// ---------- конфиг ----------
/** Наружу отдаём конфиг без секретов: ключ CurseForge в renderer не уходит вообще */
function publicConfig() {
  const { curseforgeKeyEnc, curseforgeKey, ...rest } = config.load();
  return { ...rest, hasOwnCurseforgeKey: config.hasOwnCurseforgeKey() };
}

handle('config:get', () => publicConfig());
handle('config:set', (patch) => {
  const { curseforgeKey, curseforgeKeyEnc, ...safe } = patch || {};
  config.save(safe);
  return publicConfig();
});

// ключ CurseForge живёт только в main-процессе и в интерфейс не выводится
handle('paths:get', () => dirs);

// ---------- Discord Rich Presence ----------

// что показываем в Discord: выбранная сборка и запущена ли игра
const presence = { instance: null, playing: false, since: Date.now(), gameSince: null };

function buildActivity() {
  const cfg = config.load();
  const inst = presence.instance;
  const showName = cfg.discordShowInstance !== false;
  const activity = {
    timestamps: { start: presence.playing ? (presence.gameSince || Date.now()) : presence.since },
  };
  // картинку добавляем только если ключ реально загружен в приложение Discord
  if (appConfig.discordImage) {
    activity.assets = { large_image: appConfig.discordImage, large_text: 'Plus Launcher' };
  }

  if (presence.playing && inst) {
    activity.details = `Играет в Minecraft ${inst.mc}`;
    activity.state = showName
      ? `${inst.name}${inst.loader && inst.loader !== 'vanilla' ? ` · ${inst.loader}` : ''}`
      : (inst.loader && inst.loader !== 'vanilla' ? inst.loader : 'ванильная версия');
  } else {
    activity.details = 'В лаунчере';
    activity.state = inst && showName ? `Выбрана сборка ${inst.name}` : 'Выбирает сборку';
  }
  return activity;
}

function refreshPresence() {
  if (!config.load().discordEnabled) return;
  discord.setActivity(buildActivity());
}

async function applyDiscord() {
  const cfg = config.load();
  if (!cfg.discordEnabled || !appConfig.discordAppId) {
    discord.disable();
    return discord.status();
  }
  try {
    await discord.enable(appConfig.discordAppId, () => send('discord:status', discord.status()));
    refreshPresence();
  } catch (e) {
    console.warn('[discord]', e.message);
  }
  return discord.status();
}

handle('discord:status', () => discord.status());
handle('discord:apply', () => applyDiscord());
handle('discord:select', (inst) => { presence.instance = inst; refreshPresence(); return true; });

// ---------- соединение и зеркала ----------
handle('net:check', () => connectivity.check());
handle('net:mirrors', () => mirrors.stats());
// смена режима зеркал сбрасывает память о том, что работало
handle('net:setMode', (mode) => {
  config.save({ mirrors: ['auto', 'mirror', 'off'].includes(mode) ? mode : 'auto' });
  mirrors.reset();
  return config.load().mirrors;
});

// ---------- обновления лаунчера ----------
handle('update:check', () => updater.check());
handle('update:download', ({ taskId }) => updater.download((p) =>
  send('progress', { taskId, stage: `Загрузка обновления ${p.percent}%`, percent: p.percent, detail: `${Math.round(p.transferred / 1048576)} из ${Math.round(p.total / 1048576)} МБ` })));
handle('update:install', () => updater.install());
handle('app:version', () => require('../../package.json').version);

// ---------- папка лаунчера ----------
handle('storage:info', () => storage.info());

handle('storage:choose', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Куда складывать файлы игры',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Выбрать',
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const target = r.filePaths[0];
  const check = await storage.validateTarget(target);
  const [size, free] = await Promise.all([storage.dirSize(dirs.root), storage.freeSpace(target)]);
  return { ...check, currentSize: size, free };
});

/**
 * Применяет новую папку: при необходимости переносит файлы, запоминает путь
 * и перезапускает лаунчер — модули считывают путь один раз при старте.
 */
handle('storage:apply', async ({ taskId, newRoot, move }) => {
  if (gameProcess) throw new Error('Сначала закройте игру');
  // выбрали ту же папку — просто фиксируем её и живём дальше без перезапуска
  if (path.resolve(newRoot) === path.resolve(dirs.root)) {
    storage.writePointer(dirs.root);
    return { root: dirs.root, restarted: false };
  }
  const { target } = await storage.validateTarget(newRoot);
  if (move) await storage.moveData(dirs.root, target, progress(taskId));
  storage.writePointer(target);
  if (process.platform === 'win32') {
    execFile('reg', ['add', 'HKCU\\Software\\Plus Launcher', '/v', 'DataDir', '/t', 'REG_SZ', '/d', target, '/f'], () => {});
  }
  send('progress', { taskId, stage: 'Перезапуск лаунчера', percent: 100 });
  setTimeout(() => { app.relaunch(); app.exit(0); }, 700);
  return { root: target, moved: Boolean(move), restarted: true };
});

// ---------- версии ----------
handle('versions:all', async () => {
  const mf = await versions.manifest();
  return { latest: mf.latest, versions: mf.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })) };
});
handle('versions:installed', () => versions.installed());
handle('loaders:list', (loader, mc) => loaders.list(loader, mc));

handle('install:version', async ({ taskId, mc, loader, loaderVersion }) => {
  const id = await loaders.install(loader || 'vanilla', mc, loaderVersion, progress(taskId));
  return { versionId: id };
});

// ---------- java ----------
handle('java:list', (force) => javaLib.findAll(Boolean(force)));
handle('java:install', ({ taskId, major }) => javaLib.install(major, progress(taskId)));
handle('java:browse', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Выберите java.exe',
    properties: ['openFile'],
    filters: [{ name: 'Java', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return javaLib.probe(r.filePaths[0]);
});

// ---------- аккаунты ----------
handle('auth:login', async ({ taskId }) => {
  cancelLogin = false;
  const cfg = config.load();
  const account = await auth.loginMicrosoft(
    appConfig.msClientId,
    (dc) => send('auth:code', { taskId, ...dc }),
    () => cancelLogin,
  );
  const accounts = config.load().accounts.filter((a) => a.uuid !== account.uuid);
  accounts.push(account);
  config.save({ accounts, activeAccount: account.uuid });
  return account;
});
handle('auth:cancel', () => { cancelLogin = true; });

handle('auth:offline', (name) => {
  const account = auth.offlineAccount(name);
  const accounts = config.load().accounts.filter((a) => a.uuid !== account.uuid);
  accounts.push(account);
  config.save({ accounts, activeAccount: account.uuid });
  return account;
});

/** Вход Ely.by. Пароль живёт только внутри этого вызова и никуда не сохраняется. */
handle('auth:ely', async ({ login, password, totp }) => {
  const account = await ely.login(login, password, totp);
  const accounts = config.load().accounts.filter((a) => a.uuid !== account.uuid);
  accounts.push(account);
  config.save({ accounts, activeAccount: account.uuid });
  // агент качаем сразу, чтобы первый запуск игры не ждал загрузки
  ely.ensureInjector().catch((e) => console.warn('[ely]', e.message));
  return account;
});

handle('auth:select', (uuid) => config.save({ activeAccount: uuid }));
handle('auth:remove', async (uuid) => {
  const cfg = config.load();
  const gone = cfg.accounts.find((a) => a.uuid === uuid);
  // токен Ely.by гасим на сервисе, иначе он останется рабочим до истечения срока
  if (gone?.type === 'ely') await ely.logout(gone).catch(() => {});
  const accounts = cfg.accounts.filter((a) => a.uuid !== uuid);
  return config.save({ accounts, activeAccount: cfg.activeAccount === uuid ? accounts[0]?.uuid || null : cfg.activeAccount });
});

async function activeAccount() {
  const cfg = config.load();
  let acc = cfg.accounts.find((a) => a.uuid === cfg.activeAccount) || cfg.accounts[0];
  if (!acc) throw new Error('Сначала добавьте аккаунт во вкладке «Аккаунт»');

  const stale = acc.expiresAt && Date.now() > acc.expiresAt - 60000;
  const remember = (fresh) => {
    config.save({ accounts: cfg.accounts.map((a) => (a.uuid === fresh.uuid ? fresh : a)) });
    return fresh;
  };

  if (acc.type === 'microsoft' && stale) {
    if (!acc.refreshToken) throw new Error('Сессия Microsoft истекла — войдите заново');
    acc = remember(await auth.refresh(appConfig.msClientId, acc.refreshToken));
  } else if (acc.type === 'ely' && stale) {
    try {
      acc = remember(await ely.refresh(acc));
    } catch (e) {
      if (e.needLogin) throw new Error('Сессия Ely.by истекла — войдите заново во вкладке «Аккаунт»');
      throw e;
    }
  }
  return acc;
}

// ---------- сборки (инстансы) ----------
handle('instances:list', () => config.load().instances);

handle('instances:create', async (data) => {
  const cfg = config.load();
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const folder = pickFolder(data.mc, data.loader, cfg.instances);
  const inst = {
    id,
    name: data.name || `${data.mc} ${data.loader || ''}`.trim(),
    mc: data.mc,
    loader: data.loader || 'vanilla',
    loaderVersion: data.loaderVersion || null,
    versionId: data.versionId,
    folder,
    color: data.color || '#74c045',
    created: Date.now(),
    lastPlayed: null,
  };
  // Своя папка версии со всей игровой структурой внутри
  for (const sub of ['mods', 'saves', 'config', 'resourcepacks', 'shaderpacks']) {
    await fsp.mkdir(path.join(gameDir(folder), sub), { recursive: true });
  }
  config.save({ instances: [...cfg.instances, inst], lastInstance: id });
  return inst;
});

handle('instances:update', (id, patch) => {
  const cfg = config.load();
  const instances = cfg.instances.map((i) => (i.id === id ? { ...i, ...patch } : i));
  config.save({ instances });
  return instances.find((i) => i.id === id);
});

handle('instances:delete', async (id, withFiles) => {
  const cfg = config.load();
  const inst = cfg.instances.find((i) => i.id === id);
  if (withFiles && inst) await fsp.rm(gameDir(inst.folder || inst.mc || id), { recursive: true, force: true });
  config.save({ instances: cfg.instances.filter((i) => i.id !== id) });
  return true;
});

// ---------- резервные копии миров ----------
handle('backups:worlds', (id) => backups.worlds(id));
handle('backups:list', (id) => backups.list(id));
handle('backups:create', ({ taskId, id, world, keep }) => backups.create(id, world, { keep }, progress(taskId)));
handle('backups:all', ({ taskId, id, keep }) => backups.backupAll(id, { keep }, progress(taskId)));
handle('backups:restore', ({ taskId, id, file }) => backups.restore(id, file, progress(taskId)));
handle('backups:remove', (id, file) => backups.remove(id, file));
handle('backups:folder', (id) => {
  const dir = backups.folder(id);
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

handle('instances:folder', (id) => {
  const inst = config.load().instances.find((i) => i.id === id);
  if (!inst) return null;
  const dir = gameDir(inst.folder || inst.mc || id);
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

// ---------- моды ----------
handle('mods:search', (opts) => mods.search(opts));
handle('mods:versions', (source, projectId, mc, loader) => mods.versionsFor(source, projectId, mc, loader));
handle('mods:info', (source, projectId) => mods.projectInfo(source, projectId));
handle('mods:install', ({ taskId, ...opts }) => mods.install(opts, progress(taskId)));
handle('mods:installed', (instance, kind) => mods.listInstalled(instance, kind));
handle('mods:toggle', (instance, file, kind) => mods.toggle(instance, file, kind));
handle('mods:remove', (instance, file, kind) => mods.remove(instance, file, kind));
handle('mods:folder', (instance, kind) => shell.openPath(mods.targetFolder(instance, kind)));
handle('mods:updates', ({ taskId, instance, kind, unstable }) =>
  modUpdates.check(instance, kind, progress(taskId), { unstable: Boolean(unstable) }));
handle('mods:applyUpdates', ({ taskId, instance, kind, items }) => modUpdates.apply(instance, items, kind, progress(taskId)));
handle('mods:checkApi', (instanceId) => mods.missingLoaderApi(instanceId));
handle('mods:installApi', ({ taskId, instanceId }) => mods.installLoaderApi(instanceId, progress(taskId)));

// ---------- скины ----------
handle('skins:list', () => skins.list());

handle('skins:add', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Выберите файл скина',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Скины Minecraft (PNG)', extensions: ['png'] }],
  });
  if (r.canceled || !r.filePaths.length) return [];
  const added = [];
  for (const f of r.filePaths) added.push(await skins.add(f));
  return added;
});

handle('skins:remove', (file) => skins.remove(file));

// скачивание чужого скина по нику и своего с аккаунта
handle('skins:fetch', (nick) => skins.downloadByName(nick));
handle('skins:fetchOwn', async () => skins.downloadOwn(await activeAccount()));

handle('skins:upload', async ({ file, variant }) => {
  const account = await activeAccount();
  const res = await skins.uploadMojang(account, file, variant);
  // обновляем сохранённый профиль, чтобы аватар в лаунчере поменялся
  const fresh = await skins.fetchProfile(account).catch(() => null);
  if (fresh) {
    const cfg = config.load();
    config.save({ accounts: cfg.accounts.map((a) => (a.uuid === account.uuid ? { ...a, skinUrl: fresh.skinUrl } : a)) });
  }
  return res;
});

handle('skins:reset', async () => {
  const account = await activeAccount();
  return skins.resetMojang(account);
});

handle('skins:profile', async () => {
  const account = await activeAccount();
  if (account.type !== 'microsoft') return { offline: true, name: account.name };
  return skins.fetchProfile(account);
});

handle('skins:cape', async (capeId) => {
  const account = await activeAccount();
  return skins.setCape(account, capeId);
});

handle('skins:applyLocal', async ({ instanceId, file, variant }) => {
  const account = await activeAccount();
  return skins.applyLocal({ instanceId, playerName: account.name, file, variant });
});

handle('skins:installMod', ({ taskId, instanceId }) => skins.installLoaderMod(instanceId, progress(taskId)));

// ---------- разбор вылетов ----------

const LOG_LINES = 600;
const gameLog = [];
let lastRun = null;          // сборка и папка последнего запуска — нужны для разбора

async function enabledMods(instanceId) {
  const list = await mods.listInstalled(instanceId, 'mod').catch(() => []);
  return list.filter((m) => m.enabled).map((m) => m.file);
}

/**
 * Игра закрылась с ошибкой: собираем лог и просим DeepSeek объяснить причину.
 * Отправку можно выключить галочкой в настройках.
 */
async function explainLastCrash(exitCode) {
  if (config.load().aiCrashHelp === false || !ai.available() || !lastRun) return;

  send('game:crash', { code: exitCode, analyzing: true });
  try {
    const r = await ai.explainCrash({
      log: gameLog.join(''),
      gameDir: lastRun.dir,
      instance: lastRun.inst,
      exitCode,
      mods: await enabledMods(lastRun.inst.id),
    });
    send('game:crash', { code: exitCode, analyzing: false, text: r.text, source: r.source });
  } catch (e) {
    send('game:crash', { code: exitCode, analyzing: false, error: e.message });
  }
}

handle('ai:available', () => ai.available());
handle('ai:chat', ({ messages, context }) => ai.chat(messages, { context }));

// помощник живёт в отдельном окне, чтобы не мешать игре и лаунчеру
let agentWin = null;
handle('ai:openAgent', () => {
  if (agentWin && !agentWin.isDestroyed()) { agentWin.focus(); return true; }
  agentWin = new BrowserWindow({
    width: 720,
    height: 640,
    minWidth: 460,
    minHeight: 420,
    frame: false,
    backgroundColor: '#0d0e11',
    title: 'Помощник — Plus Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  agentWin.loadFile(path.join(__dirname, '..', 'renderer', 'agent.html'));
  agentWin.on('closed', () => { agentWin = null; });
  return true;
});
handle('ai:explain', async () => {
  if (!lastRun) throw new Error('Нет данных о последнем запуске игры');
  return ai.explainCrash({
    log: gameLog.join(''),
    gameDir: lastRun.dir,
    instance: lastRun.inst,
    exitCode: 1,
    mods: await enabledMods(lastRun.inst.id),
  });
});

// ---------- запуск ----------
handle('game:launch', async ({ taskId, instanceId }) => {
  if (gameProcess) throw new Error('Игра уже запущена');
  const cfg = config.load();
  const inst = cfg.instances.find((i) => i.id === instanceId);
  if (!inst) throw new Error('Сборка не найдена');
  const account = await activeAccount();

  const p = progress(taskId);

  // Копия миров до запуска: если игра или мод испортят сохранение, будет откуда вернуть.
  if (cfg.backupBeforePlay) {
    const r = await backups.backupAll(inst.id, { keep: cfg.backupKeep || 5 },
      (x) => p({ ...x, percent: Math.round(x.percent * 0.05) })).catch((e) => {
      console.warn('[backup]', e.message);
      return null;
    });
    if (r?.done) send('game:log', `[launcher] сделаны копии миров: ${r.done} из ${r.total}\n`);
  }

  p({ stage: 'Проверка файлов игры', percent: 5 });
  await versions.install(inst.versionId, (x) => p({ ...x, percent: Math.round(x.percent * 0.28) }));

  const dir = gameDir(inst.folder || inst.mc || inst.id);
  gameLog.length = 0;
  lastRun = { inst, dir, killedByUser: false };

  // память, Java и JVM-аргументы у сборки могут быть свои — они перекрывают общие
  gameProcess = await launch({
    versionId: inst.versionId, account, config: config.effectiveFor(inst), gameDir: dir,
  }, (type, payload) => {
    if (type === 'log') {
      const line = String(payload);
      gameLog.push(line);
      if (gameLog.length > LOG_LINES) gameLog.splice(0, gameLog.length - LOG_LINES);
      send('game:log', line);
    } else if (type === 'progress') p(payload);
    else if (type === 'exit') {
      gameProcess = null;
      send('game:exit', payload);
      presence.playing = false;
      presence.gameSince = null;
      refreshPresence();
      if (win && !win.isDestroyed()) win.show();
      // код 0 — игру закрыли обычным способом; ненулевой означает вылет
      if (payload.code && !lastRun?.killedByUser) explainLastCrash(payload.code);
    }
  });

  presence.instance = { name: inst.name, mc: inst.mc, loader: inst.loader };
  presence.playing = true;
  presence.gameSince = Date.now();
  refreshPresence();

  config.save({
    lastInstance: inst.id,
    instances: cfg.instances.map((i) => (i.id === inst.id ? { ...i, lastPlayed: Date.now() } : i)),
  });
  if (cfg.closeOnLaunch) win.minimize();
  return { pid: gameProcess.pid };
});

handle('game:kill', async () => {
  if (!gameProcess) return false;
  const child = gameProcess;
  const pid = child.pid;
  if (lastRun) lastRun.killedByUser = true;      // остановку из лаунчера разбирать не нужно

  // Игра запускает второй java-процесс, поэтому снимаем всё дерево целиком:
  // убить только своего потомка мало — игра останется висеть в памяти.
  if (process.platform === 'win32') {
    await new Promise((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve()));
  } else {
    // на Unix игра запущена в своей группе (detached), отрицательный pid бьёт по всей группе
    try { process.kill(-pid, 'SIGKILL'); } catch { /* группы уже нет */ }
  }
  try { child.kill('SIGKILL'); } catch { /* уже мёртв */ }

  // gameProcess обнулит обработчик exit, когда процесс действительно завершится
  return true;
});
handle('game:running', () => Boolean(gameProcess));
