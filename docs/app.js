'use strict';

// Репозиторий с релизами лаунчера — тот же, что в src/main/lib/app-config.js
const REPO = 'funnyazsupport-ship-it/Plus-launcher';

const RELEASES = `https://github.com/${REPO}/releases`;
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

/*
 * Папка на своём хостинге, куда можно положить установщик рядом с сайтом.
 * Если файл с таким же именем, как в релизе, там лежит — качаем со своего домена,
 * иначе с GitHub. Ничего настраивать не надо: положили файл — заработало,
 * не положили — сайт продолжает работать как раньше.
 */
const LOCAL_DIR = 'downloads/';

const $ = (s) => document.querySelector(s);

for (const el of [$('#nav-repo'), $('#foot-repo')]) el.href = `https://github.com/${REPO}`;

// Пока не ответил GitHub, кнопка ведёт на страницу релизов — чтобы клик до загрузки
// данных всё равно приводил к файлу, а не в пустоту. Ниже адрес заменится на прямой.
$('#download').href = RELEASES;
$('#download').removeAttribute('target');

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
      { title: 'Скачайте архив', text: `Кнопка выше скачивает ${name}${size} напрямую.` },
      { title: 'Распакуйте его', text: 'Правой кнопкой по архиву → «Извлечь всё». Если Windows не открывает файл сама, поставьте 7-Zip или WinRAR — внутри лежит обычный установщик <code class="mono">.exe</code>.' },
      { title: 'Запустите установщик', text: SMARTSCREEN },
      { title: 'Выберите папку для игры', text: PICK_FOLDER },
    ];
  }
  return [
    { title: 'Скачайте установщик', text: `Кнопка выше скачивает ${name}${size} напрямую.` },
    { title: 'Запустите его', text: SMARTSCREEN },
    { title: 'Выберите папку для игры', text: PICK_FOLDER },
  ];
}

/**
 * Лежит ли такой же файл рядом с сайтом. Проверяем HEAD-запросом и смотрим тип:
 * многие хостинги на несуществующий файл отвечают страницей ошибки с кодом 200.
 */
async function localCopy(name) {
  try {
    const r = await fetch(LOCAL_DIR + encodeURIComponent(name), { method: 'HEAD' });
    if (!r.ok) return null;
    if (/text\/html/i.test(r.headers.get('content-type') || '')) return null;
    return LOCAL_DIR + encodeURIComponent(name);
  } catch { return null; }               // открыли файл локально или хостинг не ответил
}

/**
 * Ставит на кнопку прямую ссылку на файл свежего релиза, заполняет версию,
 * размер и дату, а шаги установки подгоняет под то, что реально скачается.
 */
async function loadRelease() {
  const meta = $('#release-meta');
  const button = $('#download');
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rel = await res.json();

    const asset = pickAsset(rel.assets);
    if (asset?.browser_download_url) {
      // Свой домен предпочтительнее: короче ссылка и не зависит от доступности GitHub.
      // Нет своей копии — ведём прямо на файл релиза, страница GitHub всё равно не открывается.
      button.href = (await localCopy(asset.name)) || asset.browser_download_url;
      button.setAttribute('download', asset.name);
    }

    const version = String(rel.tag_name || '').replace(/^v/, '');
    const parts = [];
    if (version) parts.push(`<b>версия ${version}</b>`);
    if (asset) parts.push(fmtSize(asset.size));
    if (rel.published_at) parts.push(fmtDate(rel.published_at));
    meta.innerHTML = parts.join(' · ') || 'все версии на GitHub';

    renderSteps(stepsFor(asset));
  } catch {
    // GitHub не ответил — кнопка остаётся на странице релизов, шаги берутся из разметки
    meta.textContent = 'все версии на GitHub';
  }
}

loadRelease();
