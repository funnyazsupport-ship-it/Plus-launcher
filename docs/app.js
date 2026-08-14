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

/**
 * Что скачивает человек с последнего релиза.
 * Установщик предпочтительнее, но релиз может состоять и из архива —
 * тогда шаги установки должны это учитывать, иначе люди не поймут,
 * почему у них вместо программы лежит непонятный файл.
 */
function pickAsset(assets = []) {
  const exe = assets.find((a) => /\.exe$/i.test(a.name));
  if (exe) return { ...exe, kind: 'exe' };
  const archive = assets.find((a) => /\.(rar|zip|7z)$/i.test(a.name));
  if (archive) return { ...archive, kind: 'archive' };
  return null;
}

const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
};

/** Собирает нумерованный список шагов */
function renderSteps(steps) {
  const box = $('#steps');
  if (!box) return;
  box.innerHTML = '';
  steps.forEach((s, i) => {
    const li = el('li');
    li.appendChild(el('span', 'num mono', String(i + 1)));
    const body = el('div');
    body.appendChild(el('h3', null, s.title));
    body.appendChild(el('p', null, s.text));
    li.appendChild(body);
    box.appendChild(li);
  });
}

const SMARTSCREEN = 'Windows покажет синее окно SmartScreen: «Подробнее» → «Выполнить в любом случае». '
  + 'Так бывает у любых программ без платной подписи разработчика.';
const PICK_FOLDER = 'При первом запуске лаунчер спросит, где хранить файлы игры. '
  + 'Можно оставить папку по умолчанию или указать другой диск.';

function stepsFor(asset) {
  const name = asset ? `<code class="mono">${asset.name}</code>` : '<code class="mono">PlusLauncher-Setup-….exe</code>';
  const size = asset ? `, ${fmtSize(asset.size)}` : '';

  if (asset && asset.kind === 'archive') {
    return [
      { title: 'Скачайте архив', text: `Кнопка выше открывает страницу релизов — берите самый верхний и качайте ${name}${size}.` },
      { title: 'Распакуйте его', text: 'Правой кнопкой по архиву → «Извлечь всё». Если Windows не открывает файл сама, поставьте 7-Zip или WinRAR — внутри лежит обычный установщик <code class="mono">.exe</code>.' },
      { title: 'Запустите установщик', text: SMARTSCREEN },
      { title: 'Выберите папку для игры', text: PICK_FOLDER },
    ];
  }
  return [
    { title: 'Скачайте установщик', text: `Кнопка выше открывает страницу релизов — берите самый верхний и качайте ${name}${size}.` },
    { title: 'Запустите его', text: SMARTSCREEN },
    { title: 'Выберите папку для игры', text: PICK_FOLDER },
  ];
}

/** Версия, размер и дата под кнопкой + шаги установки под нужный файл */
async function loadRelease() {
  const meta = $('#release-meta');
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rel = await res.json();

    const asset = pickAsset(rel.assets);
    const version = String(rel.tag_name || '').replace(/^v/, '');
    const parts = [];
    if (version) parts.push(`<b>версия ${version}</b>`);
    if (asset) parts.push(fmtSize(asset.size));
    if (rel.published_at) parts.push(fmtDate(rel.published_at));
    meta.innerHTML = parts.join(' · ') || 'все версии на GitHub';

    renderSteps(stepsFor(asset));
  } catch {
    // нет релизов или GitHub не ответил — кнопка и шаги из разметки остаются рабочими
    meta.textContent = 'все версии на GitHub';
  }
}

loadRelease();
