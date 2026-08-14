'use strict';

// Репозиторий с релизами лаунчера — тот же, что в src/main/lib/app-config.js
const REPO = 'funnyazsupport-ship-it/Plus-launcher';

const RELEASES = `https://github.com/${REPO}/releases`;
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

const $ = (s) => document.querySelector(s);

for (const el of [$('#nav-repo'), $('#foot-repo')]) el.href = `https://github.com/${REPO}`;

// Кнопка ведёт на страницу релизов, а не на прямой .exe: там видны все версии
// с описанием изменений, и ссылка не ломается, если в релизе переименован файл.
$('#download').href = RELEASES;
$('#download').target = '_blank';

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

/** Показывает версию, размер и дату последнего релиза под кнопкой */
async function loadRelease() {
  const meta = $('#release-meta');
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rel = await res.json();

    const exe = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
    const version = String(rel.tag_name || '').replace(/^v/, '');
    const parts = [];
    if (version) parts.push(`<b>версия ${version}</b>`);
    if (exe) parts.push(fmtSize(exe.size));
    if (rel.published_at) parts.push(fmtDate(rel.published_at));
    meta.innerHTML = parts.join(' · ') || 'все версии на GitHub';
  } catch {
    // нет релизов или GitHub не ответил — кнопка всё равно рабочая
    meta.textContent = 'все версии на GitHub';
  }
}

loadRelease();
