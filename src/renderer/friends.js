'use strict';
const app = window.api;
const $ = (s) => document.querySelector(s);

const T = (s) => (window.i18n ? window.i18n.t(s) : s);

/** Разворачивает ответ главного процесса или показывает ошибку в подписи */
async function call(promise, note = null) {
  const r = await promise;
  if (r?.ok) return r.data;
  if (note) {
    note.hidden = false;
    note.className = 'note err';
    note.textContent = r?.error || T('Не получилось');
  }
  throw new Error(r?.error || 'ошибка');
}

const say = (note, text, kind = 'ok') => {
  note.hidden = false;
  note.className = `note ${kind}`;
  note.textContent = text;
};

$('#f-min').addEventListener('click', () => app.win.minimize());
$('#f-max').addEventListener('click', () => app.win.maximize());
$('#f-close').addEventListener('click', () => app.win.close());

app.links().then((r) => {
  const site = r?.ok && r.data?.site;
  if (site) $('#brand-site').textContent = site.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}).catch(() => { /* останется значение из вёрстки */ });

// ---------------- вход ----------------

/** Показывает вход или меню. Ник в шапке — чтобы было видно, под кем сидим. */
function showMenu(nick) {
  const inside = Boolean(nick);
  $('#f-gate').hidden = inside;
  $('#f-menu').hidden = !inside;
  $('#f-me').hidden = !inside;
  $('#f-me-nick').textContent = nick || '';
  if (inside) render();
}

async function enter(action, btn) {
  const note = $('#g-note');
  note.hidden = true;
  const nick = $('#g-nick').value.trim();
  const pass = $('#g-pass').value;
  if (!nick) return say(note, T('Введите ник'), 'err');
  if (!pass) return say(note, T('Введите пароль'), 'err');

  btn.disabled = true;
  const was = btn.textContent;
  btn.textContent = T('Секунду…');
  try {
    const acc = await call(action({ nick, pass }), note);
    $('#g-pass').value = '';
    showMenu(acc.nick);
  } catch (e) {
    // самый частый случай: ника ещё нет. Незачем заставлять человека
    // догадываться — прямо показываем, какая кнопка нужна
    if (/нет/i.test(e.message)) {
      say(note, T(`Ника «${nick}» ещё нет — нажмите «Создать ник»`), 'err');
      $('#g-reg').classList.add('accent');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = was;
  }
}

$('#g-login').addEventListener('click', (e) => enter(app.tunnel.login, e.currentTarget));
$('#g-reg').addEventListener('click', (e) => enter(app.tunnel.register, e.currentTarget));

for (const id of ['#g-nick', '#g-pass']) {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#g-login').click(); });
}

$('#f-me').addEventListener('click', async () => {
  await app.tunnel.logout().catch(() => {});
  showMenu(null);
});

// ---------------- список друзей ----------------

const icon = (name) => `<svg><use href="#i-${name}"/></svg>`;

/** Чем занят друг. «Не в сети» и «лаунчер запущен, но мир закрыт» — разные вещи */
function subtitle(st) {
  if (!st) return T('проверяем…');
  const where = st.pack ? ` · ${st.pack.name} (${st.pack.mc})` : '';
  if (st.online) return T('можно заходить') + where;
  if (st.connected) return T('в лаунчере, мир не открыт') + where;
  return T('не в сети') + where;
}

let statuses = {};

async function render() {
  const list = await app.friends.list().then((r) => (r.ok ? r.data : [])).catch(() => []);
  $('#f-count').textContent = String(list.length);

  const box = $('#f-list');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = `<div class="friends-empty">${T('Пока пусто. Спросите у друга его ник и добавьте выше.')}</div>`;
    return;
  }

  for (const f of list) {
    const st = statuses[f.id];
    const el = document.createElement('div');
    el.className = `friend${st?.online ? ' online' : ''}`;
    el.innerHTML = `
      <div class="friend-mark">${icon('user')}</div>
      <div class="friend-body">
        <div class="friend-name"></div>
        <div class="friend-addr"></div>
      </div>
      <div class="friend-acts">
        <button class="wide pack">${T('Скачать')}</button>
        <button class="wide play accent">${T('Играть')}</button>
        <button class="del" title="${T('Удалить')}">${icon('trash')}</button>
      </div>`;
    el.querySelector('.friend-name').textContent = f.name;
    el.querySelector('.friend-addr').textContent = subtitle(st);

    const play = el.querySelector('.play');
    play.disabled = !st?.online || !st?.ready;
    play.title = st?.ready === false
      ? T('Сначала скачайте сборку друга')
      : T('Запустить игру и зайти в мир');
    play.addEventListener('click', async () => {
      const note = $('#f-note');
      note.hidden = true;
      play.disabled = true;
      try {
        await call(app.friends.play({ id: f.id }), note);
        say(note, T(`Запускаем игру и заходим к ${f.name}…`));
      } catch { /* подпись уже показана */ } finally {
        play.disabled = !statuses[f.id]?.online;
      }
    });

    const pack = el.querySelector('.pack');
    // ставить нечего, если друг ни разу не открывал мир — мы не знаем, во что он играет
    pack.disabled = !st?.pack;
    pack.title = st?.pack
      ? T(`Поставить себе «${st.pack.name}»`)
      : T('Друг ещё не открывал мир — неизвестно, во что он играет');
    pack.addEventListener('click', async () => {
      const note = $('#f-note');
      note.hidden = true;
      say(note, T(`Ставим «${st.pack.name}» — это надолго, окно можно не закрывать.`), '');
      pack.disabled = true;
      try {
        const r = await call(app.friends.installPack({ id: f.id }), note);
        say(note, r.failed?.length
          ? T(`Сборка готова, но ${r.failed.length} модов скачать не вышло.`)
          : T('Сборка готова — можно заходить.'));
        await refreshStatus();
      } catch { /* подпись уже показана */ } finally {
        pack.disabled = !statuses[f.id]?.pack;
      }
    });

    el.querySelector('.del').addEventListener('click', async () => {
      if (!confirm(T(`Удалить ${f.name} из друзей?`))) return;
      await app.friends.remove(f.id).catch(() => {});
      await render();
    });
    box.appendChild(el);
  }
}

/** Спрашивает сервер, кто из друзей в сети. Дороговато, поэтому не чаще раза в 15 с. */
let checking = false;
async function refreshStatus() {
  if ($('#f-menu').hidden || checking) return;
  checking = true;
  $('#f-refresh').classList.add('spin');
  try {
    const r = await app.friends.status().catch(() => null);
    if (r?.ok) {
      statuses = Object.fromEntries(r.data.map((s) => [s.id, s]));
      await render();
    }
  } finally {
    checking = false;
    $('#f-refresh').classList.remove('spin');
  }
}

$('#f-refresh').addEventListener('click', refreshStatus);

$('#f-add').addEventListener('click', async () => {
  const note = $('#f-note');
  note.hidden = true;
  const nick = $('#f-nick').value.trim();
  if (!nick) return;
  try {
    const f = await call(app.friends.add({ nick }), note);
    $('#f-nick').value = '';
    say(note, f.online
      ? T(`${f.name} уже в сети — нажмите «играть».`)
      : T(`${f.name} добавлен. Кнопка «играть» оживёт, когда он откроет мир.`));
    await refreshStatus();
  } catch { /* подпись уже показана */ }
});

$('#f-nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#f-add').click(); });

// ---------------- свой мир ----------------

let serverOn = false;
let task = null;                      // номер текущей долгой работы: по нему ловим её шаги

function paintStatus(tn) {
  const box = $('#f-share-status');
  const open = serverOn && tn?.running && tn.world;
  box.className = open ? 'count mono ok' : 'count mono';
  if (open) box.textContent = T('друзья могут заходить');
  else if (serverOn) box.textContent = T('сервер поднимается…');
  else box.textContent = T('закрыт');

  $('#f-tunnel-on').hidden = serverOn;
  $('#f-tunnel-off').hidden = !serverOn;
  // в свой мир хозяин заходит так же, как друзья — через сервер, только без сети
  $('#f-my-play').hidden = !open;
  $('#f-world').disabled = serverOn;
  $('#f-eula-row').hidden = serverOn;
}

$('#f-my-play').addEventListener('click', async () => {
  const note = $('#f-share-note');
  note.hidden = true;
  try {
    await call(app.server.play({ instanceId: $('#f-instance').value }), note);
    say(note, T('Запускаем игру…'));
  } catch { /* подпись уже показана */ }
});

function paintTunnel(st) {
  lastTunnel = st;
  paintStatus(st);
  const note = $('#f-share-note');
  if (st?.error) say(note, st.error, 'err');
}

let lastTunnel = null;

/**
 * Сборки и их миры.
 *
 * Сборку выбирает человек, а не лаунчер «по последней запущенной»: она меняется
 * при каждом запуске игры, и мир из списка потом искался бы не там.
 */
async function loadWorlds(instanceId = null) {
  const inst = $('#f-instance');
  const sel = $('#f-world');

  const r = await app.server.worlds(instanceId).catch(() => null);
  if (!r?.ok) {
    inst.innerHTML = `<option value="">${T('нет сборок')}</option>`;
    sel.innerHTML = `<option value="">${T('нет сборок')}</option>`;
    return;
  }

  // список сборок заполняем один раз, дальше только миры
  if (inst.options.length !== r.data.instances.length) {
    inst.innerHTML = '';
    for (const i of r.data.instances) {
      const o = document.createElement('option');
      o.value = i.id;
      o.textContent = `${i.name} · ${i.mc}${i.loader === 'vanilla' ? '' : ` ${i.loader}`}`;
      inst.appendChild(o);
    }
  }
  inst.value = r.data.instance.id;

  sel.innerHTML = '';
  if (!r.data.worlds.length) {
    sel.innerHTML = `<option value="">${T('в этой сборке нет миров')}</option>`;
    return;
  }
  for (const w of r.data.worlds) {
    const o = document.createElement('option');
    o.value = w.name;
    o.textContent = w.name;
    sel.appendChild(o);
  }
}

$('#f-instance').addEventListener('change', (e) => loadWorlds(e.target.value));

$('#f-eula-link').addEventListener('click', () => app.shell.open('https://www.minecraft.net/eula'));

// Выключатель на случай «сейчас не хочу никого»: снятая галочка обрывает
// входящие в перенаправителе, не трогая ни сервер, ни список друзей.
$('#f-incoming').addEventListener('change', (e) => {
  app.config.set({ friendsIncoming: e.target.checked }).catch(() => {});
});

$('#f-tunnel-on').addEventListener('click', async () => {
  const note = $('#f-share-note');
  note.hidden = true;
  const world = $('#f-world').value;
  const instanceId = $('#f-instance').value;
  if (!world) return say(note, T('В этой сборке нет миров — создайте мир в игре'), 'err');
  if (!$('#f-eula').checked) return say(note, T('Нужно принять правила Minecraft'), 'err');

  serverOn = true;
  paintStatus(lastTunnel);
  // Первый запуск сборки долгий: качается серверная часть, у Forge ещё и
  // ставится установщиком. Молчать всё это время нельзя — человек решит,
  // что зависло, и закроет лаунчер на середине.
  task = `t${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
  say(note, T('Готовлю сервер…'), '');
  try {
    await call(app.server.start({ taskId: task, instanceId, world, eula: true }), note);
  } catch {
    serverOn = false;
    paintStatus(lastTunnel);
  } finally {
    task = null;
  }
});

app.on('progress', (p) => {
  if (!task || p.taskId !== task) return;
  const note = $('#f-share-note');
  note.hidden = false;
  note.className = 'note';
  const pc = Number.isFinite(p.percent) ? ` · ${Math.round(p.percent)}%` : '';
  note.textContent = `${p.stage || 'Работаю'}${pc}${p.detail ? ` — ${p.detail}` : ''}`;
});

$('#f-tunnel-off').addEventListener('click', async () => {
  say($('#f-share-note'), T('Останавливаю сервер, мир сохраняется…'), '');
  await app.server.stop().catch(() => {});
  serverOn = false;
  paintStatus(lastTunnel);
  $('#f-share-note').hidden = true;
});

app.on('tunnel:state', paintTunnel);
app.on('server:state', (st) => {
  serverOn = Boolean(st?.running);
  paintStatus(lastTunnel);
  // сервер закрылся, не успев подняться — говорим почему, а не молчим
  if (!st?.failed) return;
  task = null;
  const note = $('#f-share-note');
  const why = st.reason || T('Сервер не запустился');

  if (st.text) {
    // разбор помощника подробнее нашего: показываем его, свой оставляем сверху
    note.hidden = false;
    note.className = 'note err';
    note.textContent = '';
    const head = document.createElement('div');
    head.textContent = why;
    const body = document.createElement('div');
    body.className = 'ai-answer';
    body.textContent = st.text;
    note.append(head, body);
    return;
  }

  say(note, st.analyzing ? `${why}\n\n${T('Спрашиваю помощника…')}` : why, 'err');
});

(async function init() {
  // оформление у окон общее: цвета боот уже поставил, картинку берём отдельно
  const cfgUi = await app.config.get().then((r) => (r.ok ? r.data.ui : null)).catch(() => null);
  if (cfgUi) window.theme.applyUi(cfgUi);
  if (cfgUi?.background) {
    app.ui.background().then((r) => { if (r?.ok && r.data) window.theme.applyBackground(r.data); }).catch(() => {});
  }

  const acc = await app.tunnel.account().then((r) => (r.ok ? r.data : null)).catch(() => null);
  showMenu(acc?.saved ? acc.nick : null);
  if (acc?.nick && !acc.saved) {
    // ник запомнен, но сервер его не признал — подставим, чтобы не набирать заново
    $('#g-nick').value = acc.nick;
    if (acc.error) say($('#g-note'), acc.error, 'err');
  }

  const cfg = await app.config.get().then((r) => (r.ok ? r.data : {})).catch(() => ({}));
  $('#f-eula').checked = cfg.eulaAccepted === true;
  $('#f-incoming').checked = cfg.friendsIncoming !== false;

  const srv = await app.server.state().then((r) => (r.ok ? r.data : null)).catch(() => null);
  serverOn = Boolean(srv?.running);

  const tn = await app.tunnel.state().then((r) => (r.ok ? r.data : null)).catch(() => null);
  paintTunnel(tn);

  await loadWorlds();
  await refreshStatus();
  setInterval(refreshStatus, 15000);
})();
