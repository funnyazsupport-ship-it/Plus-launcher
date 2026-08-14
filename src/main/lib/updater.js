'use strict';
const { app } = require('electron');
const config = require('./config');
const appConfig = require('./app-config');
const { getJSON } = require('./net');

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* работаем без автоустановки */ }

/*
 * У каждой системы свой файл с описанием обновления и свой установщик.
 * electron-updater кладёт их в релиз рядом: latest.yml, latest-mac.yml, latest-linux.yml.
 * Без нужного файла автоустановка невозможна — остаётся ссылка на страницу релиза.
 */
const PLATFORM = {
  win32: { feed: 'latest.yml', installer: /\.exe$/i, label: 'Windows' },
  darwin: { feed: 'latest-mac.yml', installer: /\.(dmg|pkg)$/i, label: 'macOS' },
  linux: { feed: 'latest-linux.yml', installer: /\.(AppImage|deb|rpm|tar\.gz)$/i, label: 'Linux' },
};

const forPlatform = () => PLATFORM[process.platform] || PLATFORM.linux;

/** "owner/repo", "github.com/owner/repo", полный URL — всё приводим к {owner, repo} */
function parseRepo(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const m = s.match(/(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m || m[1] === 'github.com') return null;
  return { owner: m[1], repo: m[2] };
}

/** Сравнение версий 1.2.10 и 1.2.9; предрелизы (1.2.0-beta.1) считаются старше релиза */
function cmpVersion(a, b) {
  const split = (v) => {
    const [core, pre] = String(v).replace(/^v/, '').split('-');
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre: pre || '' };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;         // релиз новее своего предрелиза
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

/**
 * Версия лаунчера. Берём из своего package.json: app.getVersion() возвращает версию Electron,
 * когда лаунчер запущен не как приложение (например, отдельным скриптом).
 */
function current() {
  try { return require('../../../package.json').version; } catch { /* ниже */ }
  return app?.getVersion ? app.getVersion() : '0.0.0';
}

/** Последний релиз репозитория через публичный API GitHub */
async function latestRelease({ owner, repo }) {
  const r = await getJSON(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  });
  return {
    version: String(r.tag_name || '').replace(/^v/, ''),
    name: r.name || r.tag_name,
    notes: r.body || '',
    url: r.html_url,
    published: r.published_at,
    assets: (r.assets || []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })),
  };
}

/**
 * Проверка обновления. Работает и без electron-updater: тогда просто скажет,
 * что вышла новая версия, и даст ссылку на страницу релиза.
 */
async function check() {
  const repo = parseRepo(appConfig.updateRepo);
  if (!repo) throw new Error('В сборке не указан репозиторий обновлений (app-config.js)');

  const release = await latestRelease(repo).catch((e) => {
    // GitHub отвечает 404 и на чужой/несуществующий репозиторий, и на репозиторий без релизов
    if (/HTTP 404/.test(e.message)) {
      throw new Error(`Репозиторий ${repo.owner}/${repo.repo} не найден или в нём ещё нет релизов`);
    }
    throw e;
  });

  const now = current();
  const hasUpdate = cmpVersion(release.version, now) > 0;
  const plat = forPlatform();
  // автоустановка возможна, только если в релизе есть файл описания для этой системы
  const canAutoInstall = Boolean(autoUpdater) && app.isPackaged
    && release.assets.some((a) => a.name === plat.feed);

  return {
    current: now,
    latest: release.version,
    hasUpdate,
    canAutoInstall,
    notes: release.notes.slice(0, 1200),
    url: release.url,
    published: release.published,
    repo: `${repo.owner}/${repo.repo}`,
    platform: plat.label,
    setup: release.assets.find((a) => plat.installer.test(a.name)) || null,
  };
}

/**
 * Скачивает обновление через electron-updater.
 * @param onProgress ({percent, transferred, total})
 */
async function download(onProgress = () => {}) {
  if (!autoUpdater) throw new Error('electron-updater недоступен');
  if (!app.isPackaged) throw new Error('Автообновление работает только в собранном лаунчере');
  const repo = parseRepo(appConfig.updateRepo);
  if (!repo) throw new Error('В сборке не указан репозиторий обновлений');

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({ provider: 'github', owner: repo.owner, repo: repo.repo });

  return new Promise((resolve, reject) => {
    const off = () => {
      autoUpdater.removeAllListeners('download-progress');
      autoUpdater.removeAllListeners('update-downloaded');
      autoUpdater.removeAllListeners('error');
    };
    autoUpdater.on('download-progress', (p) => onProgress({
      percent: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total,
      speed: p.bytesPerSecond,
    }));
    autoUpdater.on('update-downloaded', (info) => { off(); resolve({ version: info.version }); });
    autoUpdater.on('error', (e) => { off(); reject(e); });

    autoUpdater.checkForUpdates()
      .then((r) => {
        if (!r || !r.updateInfo) { off(); reject(new Error('Обновление не найдено')); return; }
        return autoUpdater.downloadUpdate();
      })
      .catch((e) => { off(); reject(e); });
  });
}

/** Закрывает лаунчер и ставит скачанное обновление */
function install() {
  if (!autoUpdater) throw new Error('electron-updater недоступен');
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}

module.exports = { check, download, install, parseRepo, cmpVersion, latestRelease };
