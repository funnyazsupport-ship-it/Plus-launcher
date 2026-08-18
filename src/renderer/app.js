'use strict';
const app = window.api;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const COLORS = ['#74c045', '#4a9bd8', '#8f7ae0', '#e08a3a', '#d05555', '#8a909c'];
/**
 * Аватар профиля. У Ely.by свой сервис скинов, и Mojang про их ник не знает,
 * поэтому для таких профилей просим отрисовать голову по нику, а не по UUID.
 */
function AVATAR(acc) {
  if (!acc) return 'https://mc-heads.net/avatar/MHF_Steve/64';
  const key = acc.type === 'microsoft' ? acc.uuid : acc.name;
  return `https://mc-heads.net/avatar/${encodeURIComponent(key || 'MHF_Steve')}/64`;
}

const state = {
  cfg: null,
  manifest: { latest: {}, versions: [] },
  instances: [],
  selected: null,
  color: COLORS[0],
  icons: {},                    // id сборки -> картинка в виде data-URL
  mods: { offset: 0, busy: false, end: false },
  skins: { list: [], current: null, variant: 'classic', profile: null },
  busy: false,
};

// ---------------- утилиты ----------------

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4600);
}

/** Разворачивает {ok,data|error} из main-процесса */
async function call(promise, silent = false) {
  const r = await promise;
  if (!r || r.ok) return r ? r.data : null;
  if (!silent) toast(r.error, 'err');
  throw new Error(r.error);
}

const newTask = () => `t${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
const icon = (name) => `<svg><use href="#i-${name}"/></svg>`;

function setProgress(percent, stage) {
  $('#pb-bar').style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
  $('#pb-stage').textContent = stage || '';
}
const clearProgress = () => setTimeout(() => setProgress(0, ''), 1200);

function timeAgo(ts) {
  if (!ts) return 'не запускали';
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return 'только что';
  if (d < 3600) return `${Math.floor(d / 60)} мин назад`;
  if (d < 86400) return `${Math.floor(d / 3600)} ч назад`;
  return `${Math.floor(d / 86400)} дн назад`;
}

function compact(n) {
  if (!n) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function fmtSize(bytes) {
  if (bytes == null) return '—';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 1 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}

/**
 * Модальный вопрос с произвольными кнопками.
 * actions: [{ label, value, kind }] — value возвращается в промисе, null = отмена.
 */
function ask({ title, text, actions }) {
  return new Promise((resolve) => {
    // Переводим до разбиения на <b>: иначе строка распадётся на куски,
    // и обходчик разметки уже не узнает её целиком.
    $('#ask-title').textContent = i18n.t(title);
    $('#ask-text').innerHTML = i18n.t(String(text))
      .replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
      .replace(/\{([^}]*)\}/g, '<b>$1</b>');
    const box = $('#ask-actions');
    box.innerHTML = '';
    const close = (v) => { $('#ask').hidden = true; resolve(v); };
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = `btn${a.kind ? ` ${a.kind}` : ''}`;
      b.textContent = a.label;
      b.addEventListener('click', () => close(a.value));
      box.appendChild(b);
    }
    $('#ask').hidden = false;
  });
}

function activeAccount() {
  return state.cfg.accounts.find((a) => a.uuid === state.cfg.activeAccount) || state.cfg.accounts[0] || null;
}

// ---------------- навигация ----------------

function go(page) {
  $$('.rail-item[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  if (page === 'mods') { syncInstanceSelects(); if (!$('#mods-list').children.length) searchMods(true); }
  if (page === 'settings') loadJavaList();
  if (page === 'skins') { syncInstanceSelects(); loadSkins(); loadSkinProfile(); }
}
$$('.rail-item').forEach((b) => {
  if (!b.dataset.page) return;                 // «Помощник» открывает отдельное окно
  b.addEventListener('click', () => go(b.dataset.page));
});
$('#open-agent').addEventListener('click', () => app.ai.openAgent());
$('#go-create').addEventListener('click', () => go('versions'));
$('#go-create-2').addEventListener('click', () => go('versions'));

$('#btn-min').addEventListener('click', () => app.win.minimize());
$('#btn-max').addEventListener('click', () => app.win.maximize());
$('#btn-close').addEventListener('click', () => app.win.close());

// ---------------- сборки ----------------

function renderInstances() {
  const box = $('#instances');
  box.innerHTML = '';
  $('#instances-empty').hidden = state.instances.length > 0;

  for (const inst of state.instances) {
    const el = document.createElement('div');
    el.className = `card${state.selected === inst.id ? ' on' : ''}`;
    el.style.setProperty('--c', inst.color || COLORS[0]);
    const own = OWN_KEYS.filter((k) => inst[k]);
    el.innerHTML = `
      <div class="card-acts">
        <button class="cfg" title="Настройки сборки">${icon('sliders')}</button>
        <button class="dup" title="Дублировать сборку">${icon('copy')}</button>
        <button class="fld" title="Папка версии">${icon('folder')}</button>
        <button class="del" title="Удалить">${icon('trash')}</button>
      </div>
      <div class="card-mark">${state.icons[inst.id] ? '<img alt="" />' : icon('cube')}</div>
      <div class="card-body">
        <div class="card-name"></div>
        <div class="card-meta">
          <span>${inst.mc}</span>
          ${inst.loader && inst.loader !== 'vanilla' ? `<span class="ld">${inst.loader}</span>` : ''}
          <span>${timeAgo(inst.lastPlayed)}</span>
        </div>
        <div class="card-meta">
          <span>${inst.folder || inst.mc}\\</span>
          ${own.length ? `<span class="ld">${inst.maxRam ? `${Math.round(inst.maxRam / 1024)} ГБ` : 'свои настройки'}</span>` : ''}
        </div>
      </div>`;
    el.querySelector('.card-name').textContent = inst.name;
    const img = el.querySelector('.card-mark img');
    if (img) img.src = state.icons[inst.id];
    el.addEventListener('click', () => selectInstance(inst.id));
    // двойной клик по карточке сразу запускает сборку
    el.addEventListener('dblclick', async () => {
      selectInstance(inst.id);
      // остановку по двойному клику не делаем: слишком легко закрыть игру случайно
      if (await call(app.game.running())) return toast('Игра уже запущена', 'err');
      launchInstance(inst);
    });
    // клики по значкам на карточке не должны считаться выбором или запуском
    el.querySelector('.card-acts').addEventListener('dblclick', (e) => e.stopPropagation());
    el.querySelector('.cfg').addEventListener('click', (e) => { e.stopPropagation(); openInstanceConfig(inst); });
    el.querySelector('.dup').addEventListener('click', (e) => { e.stopPropagation(); duplicateInstance(inst); });
    el.querySelector('.fld').addEventListener('click', (e) => { e.stopPropagation(); app.instances.folder(inst.id); });
    el.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation();
      // системное окно не проходит через перевод разметки — переводим строку сами
      if (!confirm(i18n.t(`Удалить сборку «${inst.name}»?\n\nПапка ${inst.folder || inst.mc} со всеми модами и мирами будет удалена.`))) return;
      await call(app.instances.remove(inst.id, true));
      state.instances = await call(app.instances.list());
      if (state.selected === inst.id) state.selected = state.instances[0]?.id || null;
      renderInstances(); updateDock(); syncInstanceSelects();
      toast('Сборка удалена');
    });
    box.appendChild(el);
  }
}

/** Копия сборки. Миры спрашиваем отдельно — они весят больше всего остального. */
async function duplicateInstance(inst) {
  const worlds = await call(app.backups.worlds(inst.id), true).catch(() => []);
  const heavy = worlds.reduce((s, w) => s + w.size, 0);

  const choice = await ask({
    title: 'Дублировать сборку',
    text: `Появится копия {${inst.name}} с теми же модами, конфигами и настройками.`
      + (worlds.length
        ? `\n\nМиров в сборке: ${worlds.length} (${fmtSize(heavy)}). Копировать их тоже?`
        : '\n\nМиров в этой сборке нет.'),
    actions: worlds.length
      ? [
        { label: 'Скопировать с мирами', value: 'worlds', kind: 'accent' },
        { label: 'Только моды и настройки', value: 'mods' },
        { label: 'Отмена', value: null },
      ]
      : [
        { label: 'Дублировать', value: 'mods', kind: 'accent' },
        { label: 'Отмена', value: null },
      ],
  });
  if (!choice) return;

  try {
    const copy = await call(app.instances.duplicate({
      taskId: newTask(), id: inst.id, withWorlds: choice === 'worlds',
    }));
    state.instances = await call(app.instances.list());
    selectInstance(copy.id);
    await refreshIcons();                 // копия наследует иконку оригинала
    toast(`Создана копия: ${copy.name}`);
  } catch { /* тост уже показан */ } finally { clearProgress(); }
}

// ---------------- настройки отдельной сборки ----------------

// Пустое значение здесь означает «брать из общих настроек лаунчера»
const OWN_KEYS = ['minRam', 'maxRam', 'javaPath', 'jvmArgs'];

let editing = null;          // сборка, открытая в модалке
let editColor = COLORS[0];

function paintOwnMode(own) {
  $('#ic-own').hidden = !own;
  $('#ic-mode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.mode === 'own') === own));
  $('#ic-state').textContent = own ? 'свои настройки' : 'как в лаунчере';
}

function openInstanceConfig(inst) {
  editing = inst;
  editColor = inst.color || COLORS[0];

  $('#ic-name').value = inst.name;
  $('#ic-about').textContent = `Minecraft ${inst.mc} · ${inst.loader === 'vanilla' ? 'без модов' : inst.loader} · папка ${inst.folder || inst.mc}\\`;

  // цвета — тот же набор, что и при создании сборки
  const colors = $('#ic-colors');
  colors.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.style.background = c;
    b.className = c === editColor ? 'on' : '';
    b.title = c;
    b.addEventListener('click', () => {
      editColor = c;
      colors.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
    colors.appendChild(b);
  }

  const own = OWN_KEYS.some((k) => inst[k]);
  const cfg = state.cfg;
  $('#ic-maxram').value = inst.maxRam || cfg.maxRam;
  $('#ic-ram-label').textContent = `${inst.maxRam || cfg.maxRam} МБ`;
  $('#ic-minram').value = inst.minRam || cfg.minRam;
  $('#ic-java').value = inst.javaPath || '';
  $('#ic-jvm').value = inst.jvmArgs || '';
  paintOwnMode(own);

  paintIconPreview(inst.id);
  $('#inst-cfg').hidden = false;
  renderBackups(inst.id);
}

/** Кружок с иконкой в настройках сборки: либо картинка, либо стандартный кубик */
function paintIconPreview(id) {
  const box = $('#ic-icon');
  const pic = state.icons[id];
  box.innerHTML = pic ? '<img alt="" />' : '<svg><use href="#i-cube"/></svg>';
  if (pic) box.querySelector('img').src = pic;
  $('#ic-icon-clear').disabled = !pic;
}

/** Перечитывает иконки из main-процесса и перерисовывает всё, где они видны */
async function refreshIcons() {
  state.icons = await call(app.instances.icons(), true).catch(() => ({}));
  renderInstances();
  updateDock();
}

$('#ic-icon-set').addEventListener('click', async () => {
  if (!editing) return;
  const r = await call(app.instances.setIcon(editing.id));
  if (!r) return;                       // окно выбора закрыли
  state.icons[editing.id] = r.dataUrl;
  paintIconPreview(editing.id);
  renderInstances(); updateDock();
  toast('Иконка сборки обновлена');
});

$('#ic-icon-clear').addEventListener('click', async () => {
  if (!editing) return;
  await call(app.instances.clearIcon(editing.id));
  delete state.icons[editing.id];
  paintIconPreview(editing.id);
  renderInstances(); updateDock();
});

// ---------------- резервные копии миров ----------------

/** Рисует оба списка: миры сборки и уже сделанные копии */
async function renderBackups(instanceId) {
  const wBox = $('#ic-worlds');
  const bBox = $('#ic-backups');
  wBox.innerHTML = '<span class="dim"><span class="spin"></span></span>';
  bBox.innerHTML = '';

  const [worlds, list] = await Promise.all([
    call(app.backups.worlds(instanceId), true).catch(() => []),
    call(app.backups.list(instanceId), true).catch(() => []),
  ]);

  wBox.innerHTML = worlds.length ? '' : '<span class="dim">миров пока нет</span>';
  for (const w of worlds) {
    const el = document.createElement('div');
    el.className = 'side-item';
    el.innerHTML = '<span></span><button class="ico-btn b" title="Сделать копию"></button>';
    el.querySelector('span').textContent = `${w.name} · ${fmtSize(w.size)}`;
    el.querySelector('span').title = w.name;
    el.querySelector('.b').innerHTML = icon('download');
    el.querySelector('.b').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        const r = await call(app.backups.create({
          taskId: newTask(), id: instanceId, world: w.name, keep: state.cfg.backupKeep || 5,
        }));
        toast(`Копия готова: ${fmtSize(r.size)}`);
        renderBackups(instanceId);
      } catch { /* тост уже показан */ } finally { clearProgress(); }
    });
    wBox.appendChild(el);
  }

  bBox.innerHTML = list.length ? '' : '<span class="dim">копий пока нет</span>';
  for (const b of list) {
    const el = document.createElement('div');
    el.className = 'side-item';
    el.innerHTML = `<span></span>
      <button class="ico-btn r" title="Восстановить">${icon('refresh')}</button>
      <button class="ico-btn d" title="Удалить">${icon('trash')}</button>`;
    // дата в языке интерфейса: при английском «15 авг.» выглядело бы чужеродно
    const when = new Date(b.at).toLocaleString(i18n.getLang(), {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    el.querySelector('span').textContent = `${b.world} · ${when} · ${fmtSize(b.size)}`;
    el.querySelector('span').title = b.file;

    el.querySelector('.r').addEventListener('click', async () => {
      const ok = await ask({
        title: 'Восстановить мир?',
        text: `Мир {${b.world}} вернётся к состоянию на ${when}.\n\nТекущая версия мира не удалится — она останется рядом с пометкой «до-восстановления».`,
        actions: [
          { label: 'Восстановить', value: true, kind: 'accent' },
          { label: 'Отмена', value: null },
        ],
      });
      if (!ok) return;
      try {
        const r = await call(app.backups.restore({ taskId: newTask(), id: instanceId, file: b.file }));
        toast(r.kept ? `Мир восстановлен, прежний сохранён как ${r.kept}` : 'Мир восстановлен');
        renderBackups(instanceId);
      } catch { /* тост уже показан */ } finally { clearProgress(); }
    });

    el.querySelector('.d').addEventListener('click', async () => {
      if (!confirm(i18n.t(`Удалить копию ${b.file}?`))) return;
      await call(app.backups.remove(instanceId, b.file));
      renderBackups(instanceId);
    });
    bBox.appendChild(el);
  }
}

$('#ic-bk-folder').addEventListener('click', () => { if (editing) app.backups.folder(editing.id); });

$('#ic-mode').querySelectorAll('button').forEach((b) =>
  b.addEventListener('click', () => paintOwnMode(b.dataset.mode === 'own')));
$('#ic-maxram').addEventListener('input', (e) => { $('#ic-ram-label').textContent = `${e.target.value} МБ`; });

$('#ic-java-browse').addEventListener('click', async () => {
  const j = await call(app.java.browse());
  if (j) $('#ic-java').value = j.path;
});

const closeInstanceConfig = () => { $('#inst-cfg').hidden = true; editing = null; };
$('#ic-close').addEventListener('click', closeInstanceConfig);
$('#ic-cancel').addEventListener('click', closeInstanceConfig);
$('#inst-cfg').addEventListener('click', (e) => { if (e.target.id === 'inst-cfg') closeInstanceConfig(); });

$('#ic-save').addEventListener('click', async () => {
  if (!editing) return;
  const own = !$('#ic-own').hidden;
  // null стирает своё значение — при запуске снова возьмётся общее
  const patch = {
    name: $('#ic-name').value.trim() || editing.name,
    color: editColor,
    minRam: own ? +$('#ic-minram').value || null : null,
    maxRam: own ? +$('#ic-maxram').value || null : null,
    javaPath: own ? $('#ic-java').value.trim() || null : null,
    jvmArgs: own ? $('#ic-jvm').value.trim() || null : null,
  };
  await call(app.instances.update(editing.id, patch));
  state.instances = await call(app.instances.list());
  closeInstanceConfig();
  renderInstances(); updateDock(); syncInstanceSelects();
  toast('Настройки сборки сохранены');
});

function selectInstance(id) {
  state.selected = id;
  renderInstances();
  updateDock();
  syncInstanceSelects();
  app.discord.select(instanceForDiscord());
}

const currentInstance = () => state.instances.find((i) => i.id === state.selected) || null;

function updateDock() {
  const inst = currentInstance();
  const dock = $('.dock-mark');
  dock.style.setProperty('--c', inst?.color || COLORS[0]);

  // в доке показываем ту же иконку, что и на карточке
  const pic = inst && state.icons[inst.id];
  dock.innerHTML = pic ? '<img alt="" />' : `<svg><use href="#i-cube"/></svg>`;
  if (pic) dock.querySelector('img').src = pic;

  $('#pb-name').textContent = inst ? inst.name : 'сборка не выбрана';
  $('#pb-sub').textContent = inst
    ? `${inst.mc} · ${inst.loader === 'vanilla' ? 'vanilla' : inst.loader} · ${inst.folder || inst.mc}\\`
    : '—';
  $('#btn-play').disabled = !inst || state.busy;
}

// ---------------- новая сборка ----------------

function renderSwatches() {
  const box = $('#ni-colors');
  box.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.style.background = c;
    b.className = c === state.color ? 'on' : '';
    b.title = c;
    b.addEventListener('click', () => { state.color = c; renderSwatches(); });
    box.appendChild(b);
  }
}

/** Показывает, какая папка получится — та же логика, что в main-процессе */
function predictFolder() {
  const mc = $('#ni-mc').value;
  const loader = $('#ni-loader').value;
  if (!mc) return '';
  const taken = new Set(state.instances.map((i) => String(i.folder || '').toLowerCase()));
  if (!taken.has(mc.toLowerCase())) return mc;
  if (loader !== 'vanilla' && !taken.has(`${mc}-${loader}`.toLowerCase())) return `${mc}-${loader}`;
  for (let n = 2; ; n++) if (!taken.has(`${mc}-${n}`.toLowerCase())) return `${mc}-${n}`;
}

function updateFolderHint() {
  const f = predictFolder();
  $('#ni-folder-hint').textContent = f ? `папка: ${f}\\` : '';
}

function fillVersionSelect() {
  const type = $('#ni-type').value;
  const sel = $('#ni-mc');
  const list = state.manifest.versions.filter((v) => type === 'all' || v.type === type);
  sel.innerHTML = list.length
    ? list.map((v) => `<option value="${v.id}">${v.id}${v.id === state.manifest.latest.release ? '  — последняя' : ''}</option>`).join('')
    : '<option value="">нет версий</option>';
  loadLoaderVersions();
}

async function loadLoaderVersions() {
  const loader = $('#ni-loader').value;
  const mc = $('#ni-mc').value;
  const wrap = $('#ni-loader-ver-wrap');
  const sel = $('#ni-loader-ver');
  updateFolderHint();
  if (loader === 'vanilla' || !mc) { wrap.hidden = true; return; }
  wrap.hidden = false;
  sel.innerHTML = '<option>загрузка…</option>';
  const list = await call(app.versions.loaders(loader, mc), true).catch(() => []);
  sel.innerHTML = (list && list.length)
    ? list.map((l) => `<option value="${l.version}">${l.version}${l.stable ? '' : ' (beta)'}</option>`).join('')
    : '<option value="">нет сборок для этой версии</option>';
}

$('#ni-type').addEventListener('change', fillVersionSelect);
$('#ni-mc').addEventListener('change', loadLoaderVersions);
$('#ni-loader').addEventListener('change', loadLoaderVersions);

$('#ni-create').addEventListener('click', async () => {
  const mc = $('#ni-mc').value;
  const loader = $('#ni-loader').value;
  const loaderVersion = $('#ni-loader-ver').value;
  if (!mc) return toast('Выберите версию Minecraft', 'err');
  if (loader !== 'vanilla' && !loaderVersion) return toast('Для этой версии нет сборок загрузчика', 'err');

  const btn = $('#ni-create');
  btn.disabled = true; state.busy = true; updateDock();
  try {
    toast(`Устанавливаю ${mc}${loader !== 'vanilla' ? ` + ${loader}` : ''}`);
    const { versionId } = await call(app.versions.install({ taskId: newTask(), mc, loader, loaderVersion }));
    const inst = await call(app.instances.create({
      name: $('#ni-name').value.trim() || `${mc}${loader !== 'vanilla' ? ` ${loader}` : ''}`,
      color: state.color, mc, loader, loaderVersion, versionId,
    }));
    state.instances = await call(app.instances.list());
    selectInstance(inst.id);
    $('#ni-name').value = '';
    await refreshInstalledVersions();
    updateFolderHint();
    toast(`Готово — папка ${inst.folder}`);
    go('play');
  } catch {
    setProgress(0, '');
  } finally {
    btn.disabled = false; state.busy = false; updateDock(); clearProgress();
  }
});

async function refreshInstalledVersions() {
  const list = await call(app.versions.installed(), true).catch(() => []);
  $('#installed-versions').innerHTML = list.length
    ? list.map((v) => `<div class="chip"><b>${v.id}</b><span>${v.type}</span></div>`).join('')
    : '<span class="dim">пусто</span>';
}

// ---------------- выпадающие списки сборок ----------------

/**
 * Списки сборок на страницах модов и скинов всегда показывают выбранную сборку —
 * иначе моды уезжают в папку не той версии, которая стоит на запуск.
 */
function syncInstanceSelects() {
  for (const sel of [$('#m-instance'), $('#skin-instance')]) {
    sel.innerHTML = '';
    if (!state.instances.length) {
      sel.innerHTML = '<option value="">нет сборок</option>';
      continue;
    }
    for (const i of state.instances) {
      const o = document.createElement('option');
      o.value = i.id;
      o.textContent = `${i.name} — ${i.folder || i.mc}`;
      sel.appendChild(o);
    }
    if (state.selected) sel.value = state.selected;
  }
  renderInstalledMods();
}

// смена сборки в этих списках меняет и активную сборку целиком
$('#m-instance').addEventListener('change', (e) => selectInstance(e.target.value));
$('#skin-instance').addEventListener('change', (e) => selectInstance(e.target.value));

// ---------------- моды ----------------

function modCtx() {
  const id = $('#m-instance').value;
  const inst = state.instances.find((i) => i.id === id);
  return {
    instance: id || null,
    mc: inst?.mc || '',
    loader: inst && inst.loader !== 'vanilla' ? inst.loader : '',
    kind: $('#m-kind').value,
    inst,
  };
}

let searchTimer = null;
$('#m-query').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchMods(true), 350);
});
['#m-kind', '#m-source', '#m-sort', '#m-instance'].forEach((s) =>
  $(s).addEventListener('change', () => { paintKindHint(); renderInstalledMods(); searchMods(true); }));

/** Модпак ставится в новую сборку, поэтому выбор сборки для него не нужен */
function paintKindHint() {
  const pack = $('#m-kind').value === 'modpack';
  $('#m-instance').disabled = pack;
  $('#modpack-hint').hidden = !pack;
}
$('#skin-instance').addEventListener('change', () => { $('#skin-note').className = 'note'; loadSkinProfile(); });
$('#mods-more').addEventListener('click', () => searchMods(false));
$('#mods-open-folder').addEventListener('click', () => {
  const c = modCtx();
  if (!c.instance) return toast('Сначала создайте сборку', 'err');
  app.mods.folder(c.instance, c.kind);
});

async function searchMods(reset) {
  if (state.mods.busy) return;
  const ctx = modCtx();
  const list = $('#mods-list');
  if (reset) { state.mods.offset = 0; list.innerHTML = '<div class="note-center"><span class="spin"></span> поиск…</div>'; }
  state.mods.busy = true;
  try {
    const res = await call(app.mods.search({
      query: $('#m-query').value.trim(),
      kind: ctx.kind, mc: ctx.mc, loader: ctx.loader,
      source: $('#m-source').value, sort: $('#m-sort').value,
      limit: 20, offset: state.mods.offset,
    }));
    if (reset) list.innerHTML = '';
    (res.errors || []).forEach((e) => toast(`Источник недоступен: ${e}`, 'warn'));
    if (!res.hits.length && reset) list.innerHTML = '<div class="note-center">ничего не найдено</div>';
    for (const hit of res.hits) list.appendChild(modRow(hit, ctx));
    state.mods.offset += 20;
    $('#mods-more').hidden = res.hits.length < 10;
  } catch { /* тост уже показан */ } finally { state.mods.busy = false; }
}

function modRow(hit, ctx) {
  const el = document.createElement('div');
  el.className = 'row-item';
  el.innerHTML = `
    <img loading="lazy" alt="" />
    <div class="row-main">
      <div class="row-title"><b></b><span class="src ${hit.source}">${hit.source === 'modrinth' ? 'MODRINTH' : 'CURSEFORGE'}</span></div>
      <div class="row-desc"></div>
      <div class="row-stats"><span class="dl"></span><span class="au"></span><span class="ct"></span></div>
    </div>
    <div class="row-acts">
      <button class="btn accent inst">${icon('download')}${ctx.kind === 'modpack' ? 'Установить сборку' : 'Установить'}</button>
      <button class="btn vers">Версии</button>
    </div>`;
  const img = el.querySelector('img');
  if (hit.icon) { img.src = hit.icon; img.onerror = () => { img.style.visibility = 'hidden'; }; }
  else img.style.visibility = 'hidden';
  el.querySelector('b').textContent = hit.name;
  el.querySelector('.row-desc').textContent = hit.summary || '';
  el.querySelector('.dl').textContent = `↓ ${compact(hit.downloads)}`;
  el.querySelector('.au').textContent = hit.author || '';
  el.querySelector('.ct').textContent = (hit.categories || []).slice(0, 3).join(' · ');
  el.querySelector('.inst').addEventListener('click', (e) => installMod(hit, null, e.currentTarget));
  el.querySelector('.vers').addEventListener('click', () => openVersions(hit, ctx));
  return el;
}

/**
 * Модпак ставится не в существующую сборку, а создаёт свою: внутри своя версия
 * игры, свой загрузчик и свой набор модов, мешать его с чужими нельзя.
 */
async function installModpack(hit, versionId, btn) {
  const ok = await ask({
    title: hit.name,
    text: 'Появится {новая сборка} со своей версией игры, загрузчиком, модами и настройками автора.'
      + '\n\nВаши существующие сборки не изменятся. Загрузка может занять несколько минут — модпаки весят сотни мегабайт.',
    actions: [
      { label: 'Установить модпак', value: true, kind: 'accent' },
      { label: 'Отмена', value: null },
    ],
  });
  if (!ok) return;

  const old = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
  try {
    const r = await call(app.mods.installPack({
      taskId: newTask(), source: hit.source, projectId: hit.id, versionId,
    }));
    state.instances = await call(app.instances.list());
    selectInstance(r.instance.id);
    renderInstances(); syncInstanceSelects();

    toast(`Модпак установлен: ${r.instance.name} (${r.installed} из ${r.total} модов)`);
    if (r.loaderSwapped) {
      toast(`Версии загрузчика ${r.loaderSwapped.want} больше нет, поставлена ${r.loaderSwapped.used}`, 'warn');
    }
    if (r.blocked.length) {
      toast(`${r.blocked.length} модов автор запретил скачивать вне сайта — доставьте их вручную`, 'warn');
    }
    if (r.skipped.length) toast(`Не скачалось модов: ${r.skipped.length}`, 'warn');
    go('play');
  } catch { /* тост уже показан */ } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = old; }
    clearProgress();
  }
}

async function installMod(hit, versionId, btn) {
  const ctx = modCtx();
  if (ctx.kind === 'modpack') return installModpack(hit, versionId, btn);
  if (!ctx.instance) return toast('Сначала выберите сборку', 'err');
  const old = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
  try {
    const r = await call(app.mods.install({
      taskId: newTask(), source: hit.source, projectId: hit.id, versionId,
      mc: ctx.mc, loader: ctx.loader, kind: ctx.kind, instance: ctx.instance, withDeps: true,
    }));
    toast(`${hit.name}${r.files.length > 1 ? ` + ${r.files.length - 1} зависимостей` : ''} → ${ctx.inst.folder}\\`);
    renderInstalledMods();
    if (btn) btn.innerHTML = 'Готово';
  } catch {
    if (btn) btn.innerHTML = old;
  } finally {
    if (btn) btn.disabled = false;
    setTimeout(() => { if (btn && btn.innerHTML === 'Готово') btn.innerHTML = old; }, 2200);
  }
}

async function openVersions(hit, ctx) {
  $('#modal').hidden = false;
  $('#modal-title').textContent = hit.name;
  const body = $('#modal-body');
  body.innerHTML = '<div class="note-center"><span class="spin"></span> загрузка версий…</div>';
  try {
    const list = await call(app.mods.versions(hit.source, hit.id, ctx.mc, ctx.loader));
    if (!list.length) { body.innerHTML = '<div class="note-center">нет совместимых версий</div>'; return; }
    body.innerHTML = '';
    for (const v of list.slice(0, 60)) {
      const row = document.createElement('div');
      row.className = 'ver-row';
      row.innerHTML = '<div class="grow"><b></b><small></small></div><button class="btn accent">Установить</button>';
      row.querySelector('b').textContent = v.name || v.versionNumber;
      row.querySelector('small').textContent =
        `${v.channel} · ${(v.gameVersions || []).slice(0, 4).join(', ')} · ${(v.loaders || []).join(', ') || '—'}`;
      row.querySelector('button').addEventListener('click', (e) => installMod(hit, v.id, e.currentTarget));
      body.appendChild(row);
    }
  } catch {
    body.innerHTML = '<div class="note-center">не удалось получить версии</div>';
  }
}
$('#modal-close').addEventListener('click', () => ($('#modal').hidden = true));
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });

// ---------------- обновления модов ----------------

let updFound = [];           // что нашли в последней проверке

function renderUpdates() {
  const box = $('#upd-list');
  box.innerHTML = '';
  if (!updFound.length) {
    box.innerHTML = '<div class="note-center">все моды свежие</div>';
    $('#upd-apply').disabled = true;
    return;
  }
  $('#upd-apply').disabled = false;

  for (const it of updFound) {
    const row = document.createElement('div');
    row.className = 'row-item upd-row';
    row.innerHTML = `
      <label class="check"><input type="checkbox" checked /></label>
      <div class="row-main">
        <div class="row-title"><b></b><span class="src ${it.source}">${it.source === 'modrinth' ? 'MODRINTH' : 'CURSEFORGE'}</span></div>
        <div class="row-desc mono"></div>
        <div class="row-stats"><span class="ct"></span></div>
      </div>`;
    row.querySelector('b').textContent = it.name;
    row.querySelector('.row-desc').textContent = `→ ${it.newFile.name}`;
    row.querySelector('.ct').textContent = [
      it.channel,
      it.newFile.size ? fmtSize(it.newFile.size) : '',
      it.enabled ? '' : 'выключен',
    ].filter(Boolean).join(' · ');
    row.querySelector('input').addEventListener('change', (e) => { it.picked = e.target.checked; });
    it.picked = true;
    box.appendChild(row);
  }
}

async function checkModUpdates() {
  const ctx = modCtx();
  if (!ctx.instance) return toast('Сначала выберите сборку', 'err');
  const btn = $('#mods-check-upd');
  btn.disabled = true;
  $('#upd').hidden = false;
  $('#upd-list').innerHTML = '<div class="note-center"><span class="spin"></span> проверяю моды…</div>';
  $('#upd-sum').textContent = '';
  $('#upd-unknown').hidden = true;
  $('#upd-apply').disabled = true;

  try {
    const r = await call(app.mods.updates({
      taskId: newTask(), instance: ctx.instance, kind: ctx.kind,
      unstable: $('#upd-unstable').checked,
    }));
    updFound = r.items;
    $('#upd-sum').textContent = `Проверено модов: ${r.checked}. Обновлений: ${r.items.length}.`;
    if (r.unknown.length) {
      $('#upd-unknown').hidden = false;
      $('#upd-unknown').textContent = `Не нашлись в каталогах (${r.unknown.length}): ${r.unknown.slice(0, 6).join(', ')}`
        + `${r.unknown.length > 6 ? ' и другие' : ''}. Такие моды проверить нельзя — обновляйте их вручную.`;
    }
    renderUpdates();
  } catch {
    $('#upd-list').innerHTML = '<div class="note-center">не удалось проверить обновления</div>';
  } finally {
    btn.disabled = false;
    clearProgress();
  }
}

$('#mods-filter').addEventListener('input', (e) => { installedFilter = e.target.value; renderInstalledMods(); });
$('#mods-check-upd').addEventListener('click', checkModUpdates);
$('#upd-unstable').addEventListener('change', checkModUpdates);
$('#upd-close').addEventListener('click', () => { $('#upd').hidden = true; });
$('#upd').addEventListener('click', (e) => { if (e.target.id === 'upd') $('#upd').hidden = true; });
$('#upd-all').addEventListener('change', (e) => {
  $('#upd-list').querySelectorAll('input[type=checkbox]').forEach((c, i) => {
    c.checked = e.target.checked;
    if (updFound[i]) updFound[i].picked = e.target.checked;
  });
});

$('#upd-apply').addEventListener('click', async (e) => {
  const ctx = modCtx();
  const items = updFound.filter((i) => i.picked);
  if (!items.length) return toast('Ничего не выбрано', 'err');
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const r = await call(app.mods.applyUpdates({
      taskId: newTask(), instance: ctx.instance, kind: ctx.kind, items,
    }));
    $('#upd').hidden = true;
    toast(`Обновлено модов: ${r.done.length}`);
    for (const f of r.failed) toast(`${f.name}: ${f.reason}`, 'err');
    renderInstalledMods();
  } catch { /* тост уже показан */ } finally {
    btn.disabled = false;
    clearProgress();
  }
});

// то, что набрали в строке фильтра над списком установленного
let installedFilter = '';

async function renderInstalledMods() {
  const ctx = modCtx();
  const box = $('#installed-mods');
  const folders = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', modpack: 'modpacks', datapack: 'datapacks' };
  $('#mods-path').textContent = ctx.inst ? `${ctx.inst.folder || ctx.inst.mc}\\${folders[ctx.kind] || 'mods'}\\` : '—';
  if (!ctx.instance) { box.innerHTML = '<span class="dim">нет сборки</span>'; $('#inst-count').textContent = '0'; return; }
  const all = await call(app.mods.installed(ctx.instance, ctx.kind), true).catch(() => []);

  const q = installedFilter.trim().toLowerCase();
  const list = q ? all.filter((m) => m.file.toLowerCase().includes(q)) : all;

  // в счётчике держим общее число, а при поиске показываем, сколько нашлось
  const on = all.filter((m) => m.enabled).length;
  $('#inst-count').textContent = q ? `${list.length} из ${all.length}` : `${on} из ${all.length}`;
  $('#mods-filter-wrap').hidden = all.length < 8;      // при трёх модах фильтр только мешает

  box.innerHTML = list.length ? '' : `<span class="dim">${q ? 'ничего не найдено' : 'пусто'}</span>`;
  for (const m of list) {
    const el = document.createElement('div');
    el.className = `side-item${m.enabled ? '' : ' off'}`;
    el.innerHTML = `<span></span>
      <button class="ico-btn t" title="Включить/выключить">${icon(m.enabled ? 'eye' : 'eye-off')}</button>
      <button class="ico-btn d" title="Удалить">${icon('trash')}</button>`;
    el.querySelector('span').textContent = m.file.replace(/\.disabled$/, '');
    el.querySelector('span').title = m.file;
    el.querySelector('.t').addEventListener('click', async () => { await call(app.mods.toggle(ctx.instance, m.file, ctx.kind)); renderInstalledMods(); });
    el.querySelector('.d').addEventListener('click', async () => {
      if (!confirm(i18n.t(`Удалить ${m.file}?`))) return;
      await call(app.mods.remove(ctx.instance, m.file, ctx.kind)); renderInstalledMods();
    });
    box.appendChild(el);
  }
}

// ---------------- скины ----------------

/** Рисует скин спереди: голова, тело, руки, ноги + внешний слой */
function drawSkin(canvas, img, variant = 'classic', scale = 8) {
  const legacy = img.height === img.width / 2;      // старый формат 64x32
  const k = img.width / 64;                          // множитель для HD-скинов
  const armW = variant === 'slim' ? 3 : 4;
  const W = (armW * 2 + 8) * scale;
  const H = 32 * scale;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);

  const put = (sx, sy, sw, sh, dx, dy, flip = false) => {
    ctx.save();
    if (flip) { ctx.translate((dx + sw) * scale, 0); ctx.scale(-1, 1); ctx.translate(-dx * scale, 0); }
    ctx.drawImage(img, sx * k, sy * k, sw * k, sh * k, dx * scale, dy * scale, sw * scale, sh * scale);
    ctx.restore();
  };

  const bx = armW;               // тело начинается после руки
  // базовый слой
  put(8, 8, 8, 8, bx, 0);                        // голова
  put(20, 20, 8, 12, bx, 8);                     // тело
  put(44, 20, armW, 12, 0, 8);                   // правая рука
  put(4, 20, 4, 12, bx, 20);                     // правая нога
  if (legacy) {
    put(44, 20, armW, 12, bx + 8, 8, true);      // зеркалим — в 64x32 нет отдельных левых конечностей
    put(4, 20, 4, 12, bx + 4, 20, true);
  } else {
    put(36, 52, armW, 12, bx + 8, 8);            // левая рука
    put(20, 52, 4, 12, bx + 4, 20);              // левая нога
  }
  // внешний слой (шапка, куртка, штаны)
  put(40, 8, 8, 8, bx, 0);
  if (!legacy) {
    put(20, 36, 8, 12, bx, 8);
    put(44, 36, armW, 12, 0, 8);
    put(52, 52, armW, 12, bx + 8, 8);
    put(4, 36, 4, 12, bx, 20);
    put(4, 52, 4, 12, bx + 4, 20);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('не удалось прочитать PNG'));
    img.src = src;
  });
}

async function renderPreview() {
  const s = state.skins.current;
  const canvas = $('#skin-canvas');
  if (!s) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    $('#skin-meta').textContent = 'скин не выбран';
    return;
  }
  try {
    const img = await loadImage(s.dataUrl || s.url);
    drawSkin(canvas, img, state.skins.variant, 8);
    $('#skin-meta').textContent = `${s.name} · ${img.width}x${img.height} · ${state.skins.variant}`;
  } catch (e) {
    $('#skin-meta').textContent = e.message;
  }
}

async function loadSkins() {
  const list = await call(app.skins.list(), true).catch(() => []);
  state.skins.list = list || [];
  $('#skin-count').textContent = String(state.skins.list.length);
  const box = $('#skin-library');
  box.innerHTML = '';
  if (!state.skins.list.length) {
    box.innerHTML = '<span class="dim">Библиотека пуста — добавьте PNG 64x64</span>';
  }
  for (const s of state.skins.list) {
    const tile = document.createElement('div');
    tile.className = `skin-tile${state.skins.current?.file === s.file ? ' on' : ''}`;
    tile.innerHTML = '<canvas></canvas><span></span>';
    tile.querySelector('span').textContent = s.name;
    tile.title = s.name;
    loadImage(s.dataUrl).then((img) => drawSkin(tile.querySelector('canvas'), img, s.variant || 'classic', 3)).catch(() => {});
    tile.addEventListener('click', () => {
      state.skins.current = s;
      state.skins.variant = s.variant || state.skins.variant;
      $$('#skin-variant button').forEach((b) => b.classList.toggle('on', b.dataset.variant === state.skins.variant));
      loadSkins();
      renderPreview();
    });
    box.appendChild(tile);
  }
  renderPreview();
}

/** Текущий скин и плащи с сервера — только для лицензии */
async function loadSkinProfile() {
  const acc = activeAccount();
  const note = $('#skin-note');
  const capes = $('#capes');
  if (!acc) {
    note.className = 'note warn';
    note.textContent = 'Профиль не выбран — зайдите во вкладку «Аккаунт».';
    return;
  }
  if (acc.type !== 'microsoft') {
    note.className = 'note';
    note.textContent = `Профиль ${acc.name} — оффлайн. «Применить» положит скин в папку версии для CustomSkinLoader.`;
    capes.innerHTML = '<span class="dim">доступны только для лицензии</span>';
    return;
  }
  note.className = 'note';
  note.textContent = `Профиль ${acc.name} — лицензия. «Применить» загрузит скин на сервер Mojang.`;
  const p = await call(app.skins.profile(), true).catch(() => null);
  if (!p) return;
  state.skins.profile = p;
  capes.innerHTML = '';
  if (!p.capes?.length) { capes.innerHTML = '<span class="dim">плащей нет</span>'; return; }
  const none = document.createElement('button');
  none.className = `cape${p.capes.some((c) => c.active) ? '' : ' on'}`;
  none.textContent = 'без плаща';
  none.addEventListener('click', async () => { await call(app.skins.cape(null)); toast('Плащ спрятан'); loadSkinProfile(); });
  capes.appendChild(none);
  for (const c of p.capes) {
    const b = document.createElement('button');
    b.className = `cape${c.active ? ' on' : ''}`;
    b.textContent = c.alias || c.id.slice(0, 8);
    b.addEventListener('click', async () => { await call(app.skins.cape(c.id)); toast(`Плащ ${c.alias || ''} включён`); loadSkinProfile(); });
    capes.appendChild(b);
  }
}

$$('#skin-variant button').forEach((b) => b.addEventListener('click', () => {
  state.skins.variant = b.dataset.variant;
  $$('#skin-variant button').forEach((x) => x.classList.toggle('on', x === b));
  renderPreview();
}));

$('#skin-add').addEventListener('click', async () => {
  const added = await call(app.skins.add());
  if (!added || !added.length) return;
  state.skins.current = added[0];
  await loadSkins();
  toast(`Добавлено: ${added.map((a) => a.name).join(', ')}`);
});

// ---------------- скачивание скина по нику ----------------

/** Общий путь для «Найти» и «Мой скин»: скачали — сразу выбрали и показали */
async function fetchSkin(getter, btn) {
  const note = $('#skin-fetch-note');
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>';
  note.hidden = true;
  try {
    const s = await call(getter(), true);
    state.skins.current = s;
    state.skins.variant = s.variant || 'classic';
    $$('#skin-variant button').forEach((b) => b.classList.toggle('on', b.dataset.variant === state.skins.variant));
    await loadSkins();
    note.hidden = false;
    note.className = 'note ok';
    note.textContent = `${s.name}: скин ${s.width}x${s.height}, модель ${s.variant}`
      + `${s.hasCape ? '. У игрока есть плащ, но плащи так не скачиваются.' : ''}`;
    $('#skin-nick').value = '';
  } catch (e) {
    note.hidden = false;
    note.className = 'note err';
    note.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
}

$('#skin-fetch').addEventListener('click', (e) => {
  const nick = $('#skin-nick').value.trim();
  if (!nick) return toast('Введите ник игрока', 'err');
  fetchSkin(() => app.skins.fetch(nick), e.currentTarget);
});
$('#skin-nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#skin-fetch').click(); });
$('#skin-fetch-own').addEventListener('click', (e) => fetchSkin(() => app.skins.fetchOwn(), e.currentTarget));

$('#skin-delete').addEventListener('click', async () => {
  const s = state.skins.current;
  if (!s) return toast('Сначала выберите скин', 'err');
  if (!confirm(i18n.t(`Удалить ${s.name} из библиотеки?`))) return;
  await call(app.skins.remove(s.file));
  state.skins.current = null;
  await loadSkins();
  toast('Удалено');
});

/** Применить: лицензии — загрузка на сервер, оффлайну — в папку версии */
$('#skin-apply').addEventListener('click', async (e) => {
  const s = state.skins.current;
  if (!s) return toast('Сначала выберите скин', 'err');
  const acc = activeAccount();
  if (!acc) return toast('Нет профиля', 'err');
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    if (acc.type === 'microsoft') {
      await call(app.skins.upload({ file: s.file, variant: state.skins.variant }));
      toast('Скин загружен на аккаунт Mojang');
      loadSkinProfile();
    } else {
      await applyLocalSkin();
    }
  } catch { /* тост уже показан */ } finally { btn.disabled = false; }
});

$('#skin-local').addEventListener('click', () => applyLocalSkin());

async function applyLocalSkin() {
  const s = state.skins.current;
  if (!s) return toast('Сначала выберите скин', 'err');
  const instanceId = $('#skin-instance').value;
  if (!instanceId) return toast('Нет сборки — создайте её во вкладке «Версии»', 'err');
  const r = await call(app.skins.applyLocal({ instanceId, file: s.file, variant: state.skins.variant }));
  const note = $('#skin-note');
  if (r.vanilla) {
    note.className = 'note warn';
    note.textContent = 'Скин записан, но в сборке без загрузчика мод скинов не поставить — игра покажет стандартного Стива.';
  } else if (!r.modInstalled) {
    note.className = 'note warn';
    note.textContent = 'Скин записан. Осталось установить CustomSkinLoader — кнопка ниже.';
  } else {
    note.className = 'note ok';
    note.textContent = 'Скин записан, CustomSkinLoader на месте — в игре он уже будет виден.';
  }
  toast('Скин положен в папку версии');
}

$('#skin-mod').addEventListener('click', async (e) => {
  const instanceId = $('#skin-instance').value;
  if (!instanceId) return toast('Нет сборки', 'err');
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await call(app.skins.installMod({ taskId: newTask(), instanceId }));
    toast('CustomSkinLoader установлен');
    const note = $('#skin-note');
    note.className = 'note ok';
    note.textContent = 'CustomSkinLoader установлен — локальные скины заработают после запуска игры.';
    renderInstalledMods();
  } catch { /* тост уже показан */ } finally { btn.disabled = false; clearProgress(); }
});

$('#skin-reset').addEventListener('click', async () => {
  const acc = activeAccount();
  if (!acc || acc.type !== 'microsoft') return toast('Сброс работает только для лицензии Microsoft', 'err');
  if (!confirm(i18n.t('Вернуть стандартный скин на аккаунте Mojang?'))) return;
  await call(app.skins.reset());
  toast('Скин сброшен');
  loadSkinProfile();
});

// ---------------- аккаунты ----------------

/** Подпись под ником профиля */
const accKind = (type) => ({ microsoft: 'лицензия', ely: 'Ely.by', offline: 'оффлайн' }[type] || 'оффлайн');

function renderAccounts() {
  const box = $('#accounts');
  box.innerHTML = state.cfg.accounts.length ? '' : '<span class="dim">профилей нет</span>';
  for (const a of state.cfg.accounts) {
    const el = document.createElement('div');
    el.className = `acc${a.uuid === state.cfg.activeAccount ? ' on' : ''}`;
    el.innerHTML = `<img src="${AVATAR(a)}" alt="" />
      <div class="grow"><div class="acc-name"></div><div class="acc-kind">${accKind(a.type)}</div></div>
      <button class="ico-btn">${icon('trash')}</button>`;
    el.querySelector('.acc-name').textContent = a.name;
    el.addEventListener('click', async () => {
      state.cfg = await call(app.auth.select(a.uuid));
      renderAccounts(); renderWho();
    });
    el.querySelector('button').addEventListener('click', async (e) => {
      e.stopPropagation();
      state.cfg = await call(app.auth.remove(a.uuid));
      renderAccounts(); renderWho();
    });
    box.appendChild(el);
  }
}

function renderWho() {
  const a = activeAccount();
  $('#acc-name').textContent = a ? a.name : 'нет профиля';
  $('#acc-type').textContent = a ? accKind(a.type) : 'не выполнен вход';
  $('#acc-avatar').src = AVATAR(a);
}

/*
 * Вход через Microsoft временно убран из интерфейса — панель закомментирована
 * в index.html. Обработчики привязываются только если она есть в разметке,
 * поэтому при возврате панели ничего дописывать не придётся.
 * Сам вход в main-процессе работает: уже добавленные профили Microsoft
 * запускают игру и продлевают сессию как раньше.
 */
function bindMicrosoftLogin() {
  const start = $('#ms-login');
  if (!start) return;

  start.addEventListener('click', async () => {
    start.disabled = true;
    try {
      await call(app.auth.login({ taskId: newTask() }));
      state.cfg = await call(app.config.get());
      $('#ms-code-box').hidden = true;
      renderAccounts(); renderWho();
      toast('Вход выполнен');
    } catch {
      $('#ms-code-box').hidden = true;
    } finally { start.disabled = false; }
  });
  $('#ms-cancel').addEventListener('click', () => { app.auth.cancel(); $('#ms-code-box').hidden = true; });
  $('#ms-copy').addEventListener('click', () => { navigator.clipboard.writeText($('#ms-code').textContent.trim()); toast('Код скопирован'); });
  $('#ms-open').addEventListener('click', () => {
    const u = $('#ms-url').textContent.trim();
    app.shell.open(u.startsWith('http') ? u : `https://${u}`);
  });
}
bindMicrosoftLogin();

$('#off-add').addEventListener('click', async () => {
  const nick = $('#off-name').value.trim();
  if (!nick) return toast('Введите ник', 'err');
  await call(app.auth.offline(nick));
  state.cfg = await call(app.config.get());
  $('#off-name').value = '';
  renderAccounts(); renderWho();
  toast('Профиль добавлен');
});

// ---------------- Ely.by ----------------

$('#ely-signup').addEventListener('click', () => app.shell.open('https://account.ely.by/register'));

async function elyLogin() {
  const btn = $('#ely-login-btn');
  const note = $('#ely-note');
  const login = $('#ely-login').value.trim();
  const password = $('#ely-pass').value;
  const totp = $('#ely-totp').value.trim();
  if (!login || !password) { note.hidden = false; note.className = 'note err'; note.textContent = 'Введите почту и пароль'; return; }

  btn.disabled = true;
  const label = btn.textContent;
  btn.innerHTML = '<span class="spin"></span> вход…';
  note.hidden = true;
  try {
    const acc = await call(app.auth.ely({ login, password, totp }), true);
    // пароль в поле не держим ни секунды дольше, чем нужно
    $('#ely-pass').value = '';
    $('#ely-totp').value = '';
    $('#ely-totp-wrap').hidden = true;
    state.cfg = await call(app.config.get());
    renderAccounts(); renderWho();
    toast(`Вход выполнен: ${acc.name}`);
  } catch (e) {
    note.hidden = false;
    note.className = 'note err';
    // на аккаунте включена двухфакторка — показываем поле для кода
    if (/двухфактор/i.test(e.message)) {
      $('#ely-totp-wrap').hidden = false;
      note.className = 'note warn';
      note.textContent = 'Введите код из приложения-аутентификатора и нажмите вход ещё раз.';
      $('#ely-totp').focus();
    } else {
      note.textContent = e.message;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

$('#ely-login-btn').addEventListener('click', elyLogin);
['#ely-login', '#ely-pass', '#ely-totp'].forEach((s) =>
  $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') elyLogin(); }));

// ---------------- настройки ----------------

function bindSettings() {
  const cfg = state.cfg;
  $('#s-maxram').value = cfg.maxRam;
  $('#ram-label').textContent = `${cfg.maxRam} МБ`;
  $('#s-minram').value = cfg.minRam;
  $('#s-java').value = cfg.javaPath;
  $('#s-width').value = cfg.width;
  $('#s-height').value = cfg.height;
  $('#s-fullscreen').checked = cfg.fullscreen;
  $('#s-close').checked = cfg.closeOnLaunch;
  $('#s-jvm').value = cfg.jvmArgs;
  // ключ CurseForge сюда не приходит — только признак, задан ли свой

  const save = async (patch) => { state.cfg = await call(app.config.set(patch)); };
  $('#s-maxram').addEventListener('input', (e) => { $('#ram-label').textContent = `${e.target.value} МБ`; });
  $('#s-maxram').addEventListener('change', (e) => save({ maxRam: +e.target.value }));
  $('#s-minram').addEventListener('change', (e) => save({ minRam: +e.target.value }));
  $('#s-java').addEventListener('change', (e) => save({ javaPath: e.target.value.trim() }));
  $('#s-width').addEventListener('change', (e) => save({ width: +e.target.value }));
  $('#s-height').addEventListener('change', (e) => save({ height: +e.target.value }));
  $('#s-fullscreen').addEventListener('change', (e) => save({ fullscreen: e.target.checked }));
  $('#s-close').addEventListener('change', (e) => save({ closeOnLaunch: e.target.checked }));
  $('#s-jvm').addEventListener('change', (e) => save({ jvmArgs: e.target.value }));

  $('#s-backup').checked = cfg.backupBeforePlay === true;
  $('#s-backup-keep').value = cfg.backupKeep || 5;
  $('#s-backup').addEventListener('change', (e) => save({ backupBeforePlay: e.target.checked }));
  $('#s-backup-keep').addEventListener('change', (e) => save({ backupKeep: Math.max(1, Math.min(30, +e.target.value || 5)) }));

  $('#s-java-browse').addEventListener('click', async () => {
    const j = await call(app.java.browse());
    if (!j) return;
    $('#s-java').value = j.path;
    await save({ javaPath: j.path });
    toast(`Java ${j.major} выбрана`);
  });
  $('#java-refresh').addEventListener('click', () => loadJavaList(true));

  $$('[data-jinstall]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const p = await call(app.java.install({ taskId: newTask(), major: +b.dataset.jinstall }));
      toast(`Java установлена: ${p}`);
      loadJavaList();
    } finally { b.disabled = false; clearProgress(); }
  }));

  $('#s-open-root').addEventListener('click', () => app.shell.openPath($('#s-root').value));
  $('#s-change-root').addEventListener('click', changeRoot);

  // Application ID, ключ картинки и репозиторий обновлений задаются в коде (app-config.js)
  $('#s-discord').checked = cfg.discordEnabled !== false;
  $('#s-discord-name').checked = cfg.discordShowInstance !== false;
  $('#s-discord').addEventListener('change', async (e) => { await save({ discordEnabled: e.target.checked }); applyDiscord(); });
  $('#s-discord-name').addEventListener('change', async (e) => { await save({ discordShowInstance: e.target.checked }); app.discord.select(instanceForDiscord()); });

  $('#s-autocheck').checked = cfg.checkUpdatesOnStart !== false;
  $('#s-autocheck').addEventListener('change', (e) => save({ checkUpdatesOnStart: e.target.checked }));
  $('#s-ai').checked = cfg.aiCrashHelp !== false;
  $('#s-ai').addEventListener('change', (e) => save({ aiCrashHelp: e.target.checked }));
  $('#s-stats').checked = cfg.shareStats !== false;
  $('#s-stats').addEventListener('change', (e) => save({ shareStats: e.target.checked }));
  $('#s-check-update').addEventListener('click', () => checkUpdate(false));
  app.update.version().then((r) => { if (r.ok) $('#app-version').textContent = `v${r.data}`; });

  initMirrors(cfg.mirrors || 'auto');
  initLook(cfg);
  loadStorage();
}

// ---------------- язык и тема ----------------

/** Во что превращается выбор темы: «как в системе» спрашивает у Windows */
function resolveTheme(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(mode) {
  const real = resolveTheme(mode);
  document.documentElement.setAttribute('data-theme', real);
  // boot.js прочитает это при следующем запуске и покрасит окно ещё до отрисовки
  try { localStorage.setItem('theme', real); } catch { /* приватный режим */ }
}

function initLook(cfg) {
  // язык
  const sel = $('#s-lang');
  sel.innerHTML = '';
  for (const l of i18n.LANGS) {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.name;
    sel.appendChild(o);
  }
  sel.value = cfg.lang || i18n.getLang();
  i18n.setLang(sel.value);
  sel.addEventListener('change', async (e) => {
    i18n.setLang(e.target.value);
    state.cfg = await call(app.config.set({ lang: e.target.value }));
  });

  // тема
  const seg = $('#s-theme');
  const mode = cfg.theme || 'dark';
  const paint = (m) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.theme === m));
  paint(mode);
  applyTheme(mode);
  seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    paint(b.dataset.theme);
    applyTheme(b.dataset.theme);
    state.cfg = await call(app.config.set({ theme: b.dataset.theme }));
  }));

  // системная тема может смениться на ходу — следим, только если выбрано «как в системе»
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if ((state.cfg.theme || 'dark') === 'system') applyTheme('system');
  });
}

// ---------------- уборка места ----------------

let cleanGroups = [];

function paintCleanTotal() {
  const picked = cleanGroups.filter((g) => g.picked);
  const sum = picked.reduce((s, g) => s + g.size, 0);
  $('#clean-picked').textContent = picked.length ? `выбрано ${fmtSize(sum)}` : 'ничего не выбрано';
  $('#clean-run').disabled = !picked.length;
}

$('#s-cleanup').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  $('#clean').hidden = false;
  $('#clean-list').innerHTML = '<div class="note-center"><span class="spin"></span> считаю, что можно убрать…</div>';
  $('#clean-sum').textContent = '';
  $('#clean-warn').hidden = true;
  $('#clean-run').disabled = true;

  try {
    const r = await call(app.cleanup.scan({ taskId: newTask() }));
    cleanGroups = r.groups.map((g) => ({ ...g, picked: g.id !== 'cache' }));   // кэш по умолчанию не трогаем
    const total = r.groups.reduce((s, g) => s + g.size, 0);
    $('#clean-sum').textContent = r.groups.length
      ? `Можно освободить до ${fmtSize(total)}. Файлы нужных сборок не трогаются.`
      : 'Лишних файлов нет — всё, что скачано, используется сборками.';
    if (r.warning) { $('#clean-warn').hidden = false; $('#clean-warn').textContent = r.warning; }

    const box = $('#clean-list');
    box.innerHTML = '';
    for (const g of cleanGroups) {
      const row = document.createElement('div');
      row.className = 'row-item upd-row';
      row.innerHTML = `
        <label class="check"><input type="checkbox" ${g.picked ? 'checked' : ''} /></label>
        <div class="row-main">
          <div class="row-title"><b></b></div>
          <div class="row-desc"></div>
          <div class="row-stats"><span class="ct"></span></div>
        </div>`;
      row.querySelector('b').textContent = g.name;
      row.querySelector('.row-desc').textContent = g.note;
      row.querySelector('.ct').textContent = `${fmtSize(g.size)} · файлов: ${g.count}`;
      row.querySelector('input').addEventListener('change', (ev) => { g.picked = ev.target.checked; paintCleanTotal(); });
      box.appendChild(row);
    }
    paintCleanTotal();
  } catch {
    $('#clean-list').innerHTML = '<div class="note-center">не удалось посчитать</div>';
  } finally {
    btn.disabled = false;
    clearProgress();
  }
});

$('#clean-close').addEventListener('click', () => { $('#clean').hidden = true; });
$('#clean').addEventListener('click', (e) => { if (e.target.id === 'clean') $('#clean').hidden = true; });

$('#clean-run').addEventListener('click', async (e) => {
  const picked = cleanGroups.filter((g) => g.picked);
  if (!picked.length) return;
  const ok = await ask({
    title: 'Удалить выбранное?',
    text: `Будет освобождено около {${fmtSize(picked.reduce((s, g) => s + g.size, 0))}}.\n\n`
      + `Разделы: ${picked.map((g) => g.name).join(', ')}.\n\n`
      + 'Файлы, нужные вашим сборкам, не тронутся. Если что-то понадобится снова, лаунчер скачает это при следующем запуске.',
    actions: [
      { label: 'Удалить', value: true, kind: 'danger' },
      { label: 'Отмена', value: null },
    ],
  });
  if (!ok) return;

  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const r = await call(app.cleanup.run({ taskId: newTask(), ids: picked.map((g) => g.id) }));
    $('#clean').hidden = true;
    toast(`Освобождено ${fmtSize(r.freed)}`);
    loadStorage();
    refreshInstalledVersions();       // часть версий удалена — список во вкладке «Версии» устарел
  } catch { /* тост уже показан */ } finally {
    btn.disabled = false;
    clearProgress();
  }
});

// ---------------- соединение и зеркала ----------------

const MIRROR_HINT = {
  auto: 'Сначала пробуем Mojang, при сбое сразу переключаемся на зеркало. Подходит почти всем.',
  mirror: 'Все файлы игры качаются с зеркала. Ставьте, если Mojang у вашего провайдера не открывается совсем.',
  off: 'Только официальные серверы Mojang. Если они недоступны, установка версии не пройдёт.',
};

function initMirrors(mode) {
  const seg = $('#s-mirrors');
  const paint = (m) => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    $('#mirror-hint').textContent = MIRROR_HINT[m] || MIRROR_HINT.auto;
  };
  paint(mode);
  seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    const m = b.dataset.mode;
    paint(m);
    await call(app.net.setMode(m));
    state.cfg = await call(app.config.get());
    toast('Режим загрузки сохранён');
  }));
}

const NEED_LABEL = { game: 'нужно для игры', login: 'нужно для лицензии', extra: 'дополнительно' };

$('#net-check').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const list = $('#net-list');
  btn.disabled = true;
  $('#net-state').textContent = 'проверяю…';
  list.innerHTML = '<div class="note-center"><span class="spin"></span> проверяю доступность серверов…</div>';
  $('#net-advice').innerHTML = '';
  try {
    const r = await call(app.net.check());
    list.innerHTML = '';
    for (const s of r.items) {
      const row = document.createElement('div');
      // зелёный — открыт напрямую, жёлтый — работает через зеркало, красный — недоступен
      const kind = s.viaMirror ? 'warn' : (s.ok ? 'good' : 'bad');
      row.className = `net-row ${kind}`;
      row.innerHTML = `<span class="dot"></span><span class="nm"></span><span class="mono st"></span>`;
      row.querySelector('.nm').textContent = s.name;
      row.querySelector('.st').textContent = s.viaMirror
        ? `через зеркало · ${s.mirror.ms} мс`
        : (s.ok ? `${s.direct.ms} мс` : (s.direct.error || 'недоступен'));
      row.title = NEED_LABEL[s.need] || '';
      list.appendChild(row);
    }
    const box = $('#net-advice');
    box.innerHTML = '';
    for (const a of r.advice) {
      const p = document.createElement('p');
      p.className = `note ${r.verdict === 'bad' ? 'err' : r.verdict === 'warn' ? 'warn' : 'ok'}`;
      p.textContent = a;
      box.appendChild(p);
    }
    $('#net-state').textContent = { good: 'всё работает', warn: 'работает через зеркало', bad: 'есть проблемы' }[r.verdict];
  } catch {
    list.innerHTML = '<div class="note-center">не удалось выполнить проверку</div>';
    $('#net-state').textContent = 'ошибка';
  } finally {
    btn.disabled = false;
  }
});

// ---------------- разбор вылетов ----------------

function showCrash({ code, analyzing, text, error, source }) {
  const box = $('#crash');
  const body = $('#crash-text');
  $('#crash-title').textContent = `Игра закрылась с ошибкой (код ${code})`;
  $('#crash-retry').disabled = Boolean(analyzing);

  if (analyzing) {
    body.innerHTML = '<span class="spin"></span> Разбираю, что случилось…';
    $('#crash-src').textContent = '';
  } else if (text) {
    body.textContent = text;
    $('#crash-src').textContent = source ? `разбор по: ${source}` : '';
  } else {
    body.textContent = `Не удалось разобрать ошибку: ${error || 'нет ответа'}.\n\nОткройте консоль — там полный вывод игры.`;
    $('#crash-src').textContent = '';
  }
  box.hidden = false;
}

$('#crash-close').addEventListener('click', () => { $('#crash').hidden = true; });
$('#crash').addEventListener('click', (e) => { if (e.target.id === 'crash') $('#crash').hidden = true; });
$('#crash-log').addEventListener('click', () => { $('#crash').hidden = true; go('console'); });
$('#crash-copy').addEventListener('click', () => {
  navigator.clipboard.writeText($('#crash-text').textContent.trim());
  toast('Скопировано');
});
$('#crash-retry').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  showCrash({ code: '—', analyzing: true });
  try {
    const r = await call(app.ai.explain());
    showCrash({ code: '—', analyzing: false, text: r.text, source: r.source });
  } catch (err) {
    showCrash({ code: '—', analyzing: false, error: err.message });
  }
});

// ---------------- статус в Discord ----------------

function instanceForDiscord() {
  const i = currentInstance();
  return i ? { name: i.name, mc: i.mc, loader: i.loader } : null;
}

function discordNote(text, kind = '') {
  const note = $('#discord-note');
  note.hidden = false;
  note.className = `note${kind ? ` ${kind}` : ''}`;
  note.textContent = text;
}

function renderDiscord(st) {
  if (!st) return;
  $('#discord-state').textContent = st.connected ? 'подключено' : st.enabled ? 'нет связи' : 'выключено';
  if (!st.enabled) {
    if (!state.cfg.discordEnabled) { $('#discord-note').hidden = true; return; }
    discordNote('В сборке не указан Application ID Discord — он задаётся в app-config.js.', 'warn');
    return;
  }
  if (st.connected) {
    discordNote('Discord на связи — статус виден друзьям. Если его всё равно не видно, включите в Discord: Настройки → Игровая активность → «Отображать текущую активность».', 'ok');
  } else {
    discordNote(st.error === 'Discord не запущен'
      ? 'Discord не запущен. Статус появится сам, когда вы его откроете.'
      : `Discord не принял подключение: ${st.error || 'неизвестная причина'}`, 'warn');
  }
}

async function applyDiscord() {
  const st = await call(app.discord.apply(), true).catch(() => null);
  renderDiscord(st);
  if (st?.connected) app.discord.select(instanceForDiscord());
}

// ---------------- обновления лаунчера ----------------

function updateNote(text, kind = '') {
  const el = $('#update-note');
  el.hidden = false;
  el.className = `note${kind ? ` ${kind}` : ''}`;
  el.textContent = text;
}

/**
 * Проверка новой версии на GitHub.
 * silent = автопроверка при запуске: молчит, когда обновления нет или репозиторий не задан.
 */
async function checkUpdate(silent) {
  const btn = $('#s-check-update');
  if (!silent) { btn.disabled = true; updateNote('Проверяю…'); }
  try {
    const u = await call(app.update.check(), silent);
    if (!u.hasUpdate) {
      if (!silent) updateNote(`Установлена последняя версия — v${u.current}`, 'ok');
      return;
    }
    updateNote(`Доступна версия ${u.latest} (у вас ${u.current})`, 'warn');
    toast(`Вышла версия ${u.latest}`, 'warn');

    const actions = [];
    if (u.canAutoInstall) actions.push({ label: 'Скачать и установить', value: 'auto', kind: 'accent' });
    actions.push({ label: 'Открыть страницу релиза', value: 'open', kind: u.canAutoInstall ? '' : 'accent' });
    actions.push({ label: 'Позже', value: null });

    const v = await ask({
      title: `Обновление ${u.latest}`,
      text: `Установлена v${u.current}, вышла v${u.latest}.\n${u.repo}\n\n${(u.notes || 'Описание релиза не заполнено.').slice(0, 400)}`,
      actions,
    });
    if (v === 'open') app.shell.open(u.url);
    if (v === 'auto') await downloadUpdate(u);
  } catch (e) {
    if (!silent) updateNote(e.message, 'warn');   // иначе в панели навсегда остаётся «Проверяю…»
  } finally {
    if (!silent) btn.disabled = false;
  }
}

async function downloadUpdate(u) {
  try {
    toast('Качаю обновление…');
    const r = await call(app.update.download({ taskId: newTask() }));
    setProgress(100, 'Обновление загружено');
    const v = await ask({
      title: `Версия ${r.version} загружена`,
      text: 'Лаунчер закроется и поставит обновление. Игра, если запущена, продолжит работать.',
      actions: [
        { label: 'Установить и перезапустить', value: 'now', kind: 'accent' },
        { label: 'Установить при выходе', value: 'later' },
      ],
    });
    if (v === 'now') await call(app.update.install());
    else updateNote(`Версия ${r.version} установится при следующем закрытии лаунчера`, 'ok');
  } catch {
    updateNote(`Не вышло скачать автоматически — откройте страницу релиза: ${u.url}`, 'warn');
    clearProgress();
  }
}

// ---------------- папка лаунчера ----------------

async function loadStorage() {
  const info = await call(app.storage.info(), true).catch(() => null);
  if (!info) return null;
  $('#s-root').value = info.root;
  $('#st-size').textContent = fmtSize(info.size);
  $('#st-free').textContent = `свободно на диске: ${fmtSize(info.free)}`;
  return info;
}

/** Выбор новой папки: перенести файлы, начать с пустой или подхватить готовые данные */
async function changeRoot() {
  const picked = await call(app.storage.choose());
  if (!picked) return;

  let move = false;
  if (picked.hasData) {
    const v = await ask({
      title: 'В папке уже есть данные лаунчера',
      text: `{${picked.target}}\n\nЛаунчер будет работать с ними. Файлы из текущей папки останутся на месте — их можно удалить вручную.`,
      actions: [
        { label: 'Использовать эти данные', value: 'use', kind: 'accent' },
        { label: 'Отмена', value: null },
      ],
    });
    if (!v) return;
  } else if (picked.currentSize > 0) {
    const enough = picked.free == null || picked.free > picked.currentSize;
    const v = await ask({
      title: 'Новая папка лаунчера',
      text: `{${picked.target}}\n\nСейчас скачано ${fmtSize(picked.currentSize)}. Свободно на новом диске: ${fmtSize(picked.free)}.`
        + (enough ? '' : '\n\nМеста может не хватить — перенос прервётся.'),
      actions: [
        { label: `Перенести ${fmtSize(picked.currentSize)} туда`, value: 'move', kind: 'accent' },
        { label: 'Начать с пустой папки', value: 'fresh' },
        { label: 'Отмена', value: null },
      ],
    });
    if (!v) return;
    move = v === 'move';
    if (!move) {
      const ok = await ask({
        title: 'Начать с пустой папки?',
        text: 'Версии, моды и миры останутся в старой папке, лаунчер их больше не увидит. Список сборок и профили будут пустыми.',
        actions: [{ label: 'Да, начать заново', value: 'yes', kind: 'danger' }, { label: 'Отмена', value: null }],
      });
      if (!ok) return;
    }
  }

  try {
    const r = await call(app.storage.apply({ taskId: newTask(), newRoot: picked.target, move }));
    if (r.restarted) {
      setProgress(100, 'Перезапуск лаунчера…');
      toast('Папка изменена — лаунчер перезапускается');
    } else {
      await loadStorage();
      toast('Папка сохранена');
    }
  } catch {
    clearProgress();
  }
}

/** Первый запуск: спрашиваем, где держать файлы игры */
async function askStorageOnFirstRun(info) {
  const v = await ask({
    title: 'Где держать файлы игры?',
    text: `Версии, библиотеки и ресурсы занимают от 500 МБ на версию. По умолчанию всё ляжет в\n{${info.root}}\n\nМожно выбрать другой диск — путь потом меняется в настройках.`,
    actions: [
      { label: 'Оставить по умолчанию', value: 'default', kind: 'accent' },
      { label: 'Выбрать другую папку', value: 'choose' },
    ],
  });
  if (v === 'choose') await changeRoot();
  else await call(app.storage.apply({ taskId: newTask(), newRoot: info.root, move: false }), true).catch(() => {});
}

async function loadJavaList(force = false) {
  const box = $('#java-list');
  box.innerHTML = '<span class="dim"><span class="spin"></span> поиск java…</span>';
  const list = await call(app.java.list(force), true).catch(() => []);
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<span class="dim">java не найдена — скачайте кнопкой ниже</span>'; return; }
  for (const j of list) {
    const c = document.createElement('div');
    c.className = 'chip pick';
    c.innerHTML = `<b>Java ${j.major}</b><span>${j.arch}</span>`;
    c.title = j.path;
    c.addEventListener('click', async () => {
      $('#s-java').value = j.path;
      state.cfg = await call(app.config.set({ javaPath: j.path }));
      toast('Java выбрана');
    });
    box.appendChild(c);
  }
}

// ---------------- консоль и запуск ----------------

const consoleEl = $('#console');
function logLine(text) {
  const cls = /ERROR|Exception|FATAL/i.test(text) ? 'err' : /WARN/i.test(text) ? 'warn' : /\[launcher\]/.test(text) ? 'ok' : '';
  const span = document.createElement('span');
  span.className = cls;
  span.textContent = text;
  consoleEl.appendChild(span);
  if (consoleEl.childNodes.length > 3000) consoleEl.removeChild(consoleEl.firstChild);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
$('#log-clear').addEventListener('click', () => { consoleEl.textContent = ''; });
$('#log-kill').addEventListener('click', async () => {
  const killed = await call(app.game.kill());
  toast(killed ? 'Игра остановлена' : 'Игра не запущена');
});

/**
 * Запуск сборки. Вынесен отдельно, потому что вызывается и с большой кнопки,
 * и двойным кликом по карточке.
 */
async function launchInstance(inst) {
  if (!inst) return;

  // моды в папке есть, а Fabric API нет — загрузчик упадёт ещё до запуска игры
  const need = await call(app.mods.checkApi(inst.id), true).catch(() => null);
  if (need) {
    const v = await ask({
      title: `Не хватает ${need.title}`,
      text: `В сборке {${inst.folder || inst.mc}} стоит модов: ${need.mods}, но нет ${need.title}.\n\nБольшинство модов без него не работают — игра закроется с ошибкой сразу после запуска.`,
      actions: [
        { label: `Установить ${need.title} и запустить`, value: 'install', kind: 'accent' },
        { label: 'Запустить как есть', value: 'go' },
        { label: 'Отмена', value: null },
      ],
    });
    if (!v) return;
    if (v === 'install') {
      try {
        const r = await call(app.mods.installApi({ taskId: newTask(), instanceId: inst.id }));
        toast(`Поставлен ${r.files.map((f) => f.split('\\').pop()).join(', ')}`);
        renderInstalledMods();
      } catch { return; }
    }
  }

  const btn = $('#btn-play');
  btn.disabled = true; state.busy = true;
  try {
    await call(app.game.launch({ taskId: newTask(), instanceId: inst.id }));
    btn.textContent = 'ОСТАНОВИТЬ';
    btn.classList.add('stop');
    btn.disabled = false;
    state.instances = await call(app.instances.list());
    renderInstances();
  } catch {
    setProgress(0, '');
    btn.disabled = false;
  } finally { state.busy = false; }
}

$('#btn-play').addEventListener('click', async () => {
  const inst = currentInstance();
  if (!inst) return;
  // у большой кнопки двойная роль: запустить или остановить уже идущую игру
  if (await call(app.game.running())) return call(app.game.kill());
  return launchInstance(inst);
});

app.on('progress', (p) => setProgress(p.percent, p.detail ? `${p.stage} — ${p.detail}` : p.stage));
app.on('discord:status', (st) => renderDiscord(st));
app.on('game:crash', (info) => showCrash(info));
app.on('game:log', (line) => logLine(line));
app.on('game:exit', ({ code }) => {
  const btn = $('#btn-play');
  btn.textContent = 'ИГРАТЬ';
  btn.classList.remove('stop');
  btn.disabled = false;
  setProgress(0, '');
  logLine(`\n[launcher] игра завершена, код ${code}\n`);
  toast(code === 0 ? 'Игра закрыта' : `Игра завершилась с кодом ${code}`, code === 0 ? '' : 'err');
});
app.on('auth:code', (dc) => {
  // код придёт только если панель Microsoft возвращена в разметку
  if (!$('#ms-code-box')) return;
  $('#ms-code-box').hidden = false;
  $('#ms-code').textContent = dc.userCode;
  $('#ms-url').textContent = dc.verificationUri;
  go('account');
});

// ---------------- старт ----------------

(async function init() {
  state.cfg = await call(app.config.get());
  state.instances = await call(app.instances.list());
  state.selected = state.cfg.lastInstance || state.instances[0]?.id || null;
  state.icons = await call(app.instances.icons(), true).catch(() => ({}));

  renderSwatches();
  renderInstances();
  renderAccounts();
  renderWho();
  bindSettings();
  updateDock();
  syncInstanceSelects();
  refreshInstalledVersions();

  try {
    state.manifest = await call(app.versions.all());
    fillVersionSelect();
  } catch {
    toast('Список версий Mojang недоступен — проверьте интернет', 'err');
  }

  // первый запуск — предложить выбрать папку до того, как что-то скачается
  const info = await loadStorage();
  if (info && !info.configured) await askStorageOnFirstRun(info);

  if (state.cfg.checkUpdatesOnStart !== false) checkUpdate(true);

  renderDiscord(await call(app.discord.status(), true).catch(() => null));
  if (state.cfg.discordEnabled && state.cfg.discordAppId) app.discord.select(instanceForDiscord());
})();
