'use strict';

// Репозиторий с релизами лаунчера — тот же, что в src/main/lib/app-config.js
const REPO = 'funnyazsupport-ship-it/Plus-launcher';

const RELEASES = `https://github.com/${REPO}/releases`;
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

const $ = (s) => document.querySelector(s);

for (const el of [$('#nav-repo'), $('#foot-repo')]) el.href = `https://github.com/${REPO}`;
$('#download').href = `${RELEASES}/latest`;

const fmtSize = (bytes) => {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} ГБ` : `${Math.round(mb)} МБ`;
};

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return ''; }
};

/** Подставляет прямую ссылку на .exe, версию, размер и дату последнего релиза */
async function loadRelease() {
  const meta = $('#release-meta');
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rel = await res.json();

    const exe = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
    if (exe) $('#download').href = exe.browser_download_url;

    const version = String(rel.tag_name || '').replace(/^v/, '');
    const parts = [];
    if (version) parts.push(`<b>версия ${version}</b>`);
    if (exe) parts.push(fmtSize(exe.size));
    if (rel.published_at) parts.push(fmtDate(rel.published_at));
    meta.innerHTML = parts.join(' · ') || 'последняя версия';
  } catch {
    // приватный репозиторий или нет релизов — оставляем ссылку на страницу релизов
    meta.innerHTML = `<a href="${RELEASES}">все версии на GitHub</a>`;
  }
}

loadRelease();
