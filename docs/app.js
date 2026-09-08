'use strict';

// Репозиторий с релизами лаунчера — тот же, что в src/main/lib/app-config.js
const REPO = 'funnyazsupport-ship-it/Plus-launcher';

const RELEASES = `https://github.com/${REPO}/releases`;
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

/*
 * Файл установщика, лежащий рядом с сайтом на своём хостинге.
 * Кнопка ведёт сюда, а не на GitHub. При выпуске новой версии меняется
 * одна эта строка (и файл кладётся в public_html/downloads).
 *
 * Если файла там не окажется, сайт молча возьмёт файл из релиза GitHub —
 * кнопка не должна вести в никуда из-за опечатки в имени.
 */
const LOCAL_FILE = 'downloads/PlusLauncher-Setup-1.11.0.rar';

// сюда же складываются файлы, если имя совпадает с именем файла в релизе
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

/*
 * Системы и что для каждой качать.
 *
 * main — файл под кнопку, alt — прочие сборки той же системы мелкой строкой.
 * Под macOS их две: браузер не отличает Apple Silicon от Intel (Safari и Chrome
 * на M-процессорах всё равно представляются как Intel), поэтому кнопка ведёт на
 * arm64 — такие маки продаются с 2020 года, — а на Intel рядом стоит ссылка.
 */
const SYSTEMS = [
  {
    id: 'win',
    label: 'Windows',
    main: [/-Windows\.zip$/i, /Setup-[\d.]+\.zip$/i, /\.exe$/i],
    alt: [{ title: 'установщик .exe без архива', match: /\.exe$/i }],
  },
  {
    id: 'mac',
    label: 'macOS',
    main: [/-macOS\.zip$/i, /arm64\.dmg$/i, /\.dmg$/i],
    alt: [
      { title: 'Apple Silicon — .dmg', match: /arm64\.dmg$/i },
      { title: 'Intel — .dmg', match: /x64\.dmg$/i },
    ],
  },
  {
    id: 'linux',
    label: 'Linux',
    main: [/-Linux\.zip$/i, /\.AppImage$/i, /\.tar\.gz$/i],
    alt: [
      { title: 'AppImage — без установки', match: /\.AppImage$/i },
      { title: 'Ubuntu, Debian — .deb', match: /\.deb$/i },
      { title: 'Fedora — .rpm', match: /\.rpm$/i },
      { title: 'Arch — .pacman', match: /\.pacman$/i },
    ],
  },
];

const byId = (id) => SYSTEMS.find((s) => s.id === id) || SYSTEMS[0];

/** Система гостя. Телефоны сюда не попадают: Android представляется как Linux */
function detectSystem() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return 'win';
  const p = navigator.userAgentData?.platform || navigator.platform || '';
  if (/Mac/i.test(p) || /Mac OS X/i.test(ua)) return 'mac';
  if (/Linux|X11|CrOS/i.test(p) || /Linux|X11|CrOS/i.test(ua)) return 'linux';
  return 'win';
}

/** Первый файл релиза, подходящий под один из образцов; порядок задаёт предпочтение */
const firstMatch = (assets, patterns) => {
  for (const re of patterns) {
    const hit = assets.find((a) => re.test(a.name));
    if (hit) return hit;
  }
  return null;
};

/**
 * Что скачивает человек с последнего релиза для своей системы.
 * Установщик предпочтительнее, но релиз может состоять и из архива —
 * тогда шаги установки должны это учитывать, иначе люди не поймут,
 * почему у них вместо программы лежит непонятный файл.
 */
function pickAsset(assets = [], system = 'win') {
  const hit = firstMatch(assets, byId(system).main);
  if (!hit) return null;
  return { ...hit, kind: /\.(zip|rar|7z|tar\.gz)$/i.test(hit.name) ? 'archive' : 'installer' };
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
const GATEKEEPER = 'Откройте скачанный <code class="mono">.dmg</code> и перетащите лаунчер в «Программы». '
  + 'Первый раз запускайте правой кнопкой → «Открыть»: macOS предупредит о программе без подписи Apple, '
  + 'в этом окне появится кнопка «Открыть». Дальше запускается как обычно.';
const APPIMAGE = 'Файл <code class="mono">.AppImage</code> ставить не нужно — он уже готовая программа. '
  + 'Разрешите ему запуск: правой кнопкой → «Свойства» → «Права» → «Разрешить выполнение файла», '
  + 'либо в терминале <code class="mono">chmod +x</code> и запустите двойным щелчком.';
const PICK_FOLDER = 'При первом запуске лаунчер спросит, где хранить файлы игры. '
  + 'Можно оставить папку по умолчанию или указать другой диск.';

const UNPACK = 'Правой кнопкой по архиву → «Извлечь всё». Если система не открывает файл сама, '
  + 'поставьте 7-Zip или WinRAR — внутри лежит обычный установщик.';

/** Как поставить скачанное — у каждой системы свой второй шаг */
const RUN_STEP = {
  win: { title: 'Запустите его', text: SMARTSCREEN },
  mac: { title: 'Перетащите в «Программы»', text: GATEKEEPER },
  linux: { title: 'Разрешите запуск', text: APPIMAGE },
};

function stepsFor(asset, system = 'win') {
  const name = asset ? `<code class="mono">${asset.name}</code>` : 'файл свежей версии';
  const size = asset ? `, ${fmtSize(asset.size)}` : '';
  const first = { title: 'Скачайте файл', text: `Кнопка выше скачивает ${name}${size} напрямую.` };
  const last = { title: 'Выберите папку для игры', text: PICK_FOLDER };

  if (asset && asset.kind === 'archive') {
    return [first, { title: 'Распакуйте его', text: UNPACK }, RUN_STEP.win, last];
  }
  return [first, RUN_STEP[system] || RUN_STEP.win, last];
}

/**
 * Лежит ли такой же файл рядом с сайтом. Проверяем HEAD-запросом и смотрим тип:
 * многие хостинги на несуществующий файл отвечают страницей ошибки с кодом 200.
 */
async function exists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (!r.ok) return false;
    // многие хостинги на несуществующий файл отдают страницу ошибки с кодом 200
    return !/text\/html/i.test(r.headers.get('content-type') || '');
  } catch { return false; }              // открыли файл локально или хостинг не ответил
}

/** Ссылка на свой файл: сначала указанный вручную, потом одноимённый с релизом */
async function localCopy(name) {
  if (LOCAL_FILE && await exists(LOCAL_FILE)) return LOCAL_FILE;
  const guess = LOCAL_DIR + encodeURIComponent(name || '');
  if (name && await exists(guess)) return guess;
  return null;
}

/**
 * Ставит на кнопку прямую ссылку на файл свежего релиза, заполняет версию,
 * размер и дату, а шаги установки подгоняет под то, что реально скачается.
 */
/** Вешает на ссылку прямую загрузку файла; своя копия рядом с сайтом важнее */
async function linkTo(node, asset) {
  node.href = (await localCopy(asset.name)) || asset.browser_download_url;
  node.setAttribute('download', asset.name);
  node.removeAttribute('target');
}

/** Кнопки для двух остальных систем — рядом с основной */
async function fillOther(assets, mine) {
  const nodes = [$('#download-alt-1'), $('#download-alt-2')];
  const others = SYSTEMS.filter((s) => s.id !== mine);

  for (const [i, sys] of others.entries()) {
    const node = nodes[i];
    if (!node) continue;
    // подпись ставим всегда: гость с мака не должен видеть на кнопке «для Windows»
    node.querySelector('span').textContent = `Скачать для ${sys.label}`;

    // файла для этой системы в релизе нет — оставляем ссылку на страницу релизов
    const asset = pickAsset(assets, sys.id);
    if (asset) await linkTo(node, asset);
  }
}

/** Прочие сборки своей системы: отдельные установщики, мак на Intel, deb и rpm */
async function fillAlt(assets, mine, chosen) {
  const box = $('#cta-alt');
  if (!box) return;
  box.innerHTML = '';

  for (const variant of byId(mine).alt) {
    const asset = assets.find((a) => variant.match.test(a.name));
    // то же самое, что уже качает кнопка, второй строкой не повторяем
    if (!asset || asset.name === chosen?.name) continue;
    const link = el('a', null, variant.title);
    await linkTo(link, asset);
    box.appendChild(link);
  }
  box.hidden = !box.children.length;
}

async function loadRelease() {
  const meta = $('#release-meta');
  const button = $('#download');
  const system = detectSystem();
  const label = $('#download-label');

  if (label) label.textContent = `Скачать для ${byId(system).label}`;

  // Свой файл ставим первым делом и не ждём GitHub: если его API молчит или
  // заблокирован у человека, кнопка всё равно должна качать файл с нашего домена.
  // Он собран под Windows, поэтому гостям с мака и Linux не подходит.
  const own = system === 'win' ? await localCopy(null) : null;
  if (own) {
    button.href = own;
    button.setAttribute('download', own.split('/').pop());
  }

  try {
    // no-store: браузер охотно отдаёт старый ответ, и кнопка после смены файлов
    // в релизе начинает вести на файл, которого там уже нет
    const res = await fetch(API, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rel = await res.json();
    const assets = rel.assets || [];

    const asset = pickAsset(assets, system);
    // своей копии нет — ведём прямо на файл релиза, страница GitHub не открывается
    if (asset?.browser_download_url && !own) await linkTo(button, asset);

    await fillOther(assets, system);
    await fillAlt(assets, system, asset);

    const version = String(rel.tag_name || '').replace(/^v/, '');
    const parts = [];
    if (version) parts.push(`<b>версия ${version}</b>`);
    if (asset) parts.push(fmtSize(asset.size));
    if (rel.published_at) parts.push(fmtDate(rel.published_at));
    meta.innerHTML = parts.join(' · ') || 'все версии на GitHub';

    renderSteps(stepsFor(asset, system));
  } catch {
    // GitHub не ответил — кнопка остаётся на странице релизов, но шаги всё равно
    // показываем под систему гостя: они не зависят от того, ответил ли API
    meta.textContent = 'все версии на GitHub';
    renderSteps(stepsFor(null, system));
  }
}

loadRelease();

/* ---------- сколько человек играет прямо сейчас ---------- */

const STATS_URL = 'api/stats.php';
const REFRESH_MS = 60 * 1000;

/** «1 игрок», «2 игрока», «5 игроков» */
function playersWord(n) {
  const ten = n % 100;
  if (ten >= 11 && ten <= 14) return 'игроков';
  const one = n % 10;
  if (one === 1) return 'игрок';
  if (one >= 2 && one <= 4) return 'игрока';
  return 'игроков';
}

async function loadOnline() {
  const box = $('#online');
  if (!box) return;
  try {
    const res = await fetch(STATS_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const s = await res.json();
    const n = Number(s.online) || 0;

    // Пока никто не играет, показывать «0 игроков» невесело и бессмысленно —
    // прячем счётчик до первого живого игрока.
    if (!n) { box.hidden = true; return; }
    $('#online-count').textContent = n;
    $('#online-label').textContent = `${playersWord(n)} сейчас в игре`;
    box.hidden = false;
  } catch {
    box.hidden = true;                 // счётчик не поднят или сломан — просто не показываем
  }
}

loadOnline();
setInterval(loadOnline, REFRESH_MS);
