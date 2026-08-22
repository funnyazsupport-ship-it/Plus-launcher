'use strict';
const app = window.api;
const $ = (s) => document.querySelector(s);

// Область #chat исключена из автоперевода (там ответы помощника и названия модов —
// их трогать нельзя), поэтому свои надписи внутри неё переводим вручную.
const T = (s) => (window.i18n ? window.i18n.t(s) : s);

const history = [];           // {role, content} — уходит в сервис
let busy = false;
let stopped = false;          // человек нажал «Стоп» — дальше не идём
let pendingPermit = null;     // открытая карточка разрешения, если она сейчас висит

/**
 * Останавливает помощника: обрывает запрос к сервису, закрывает висящий вопрос
 * про разрешение и не даёт циклу сделать следующий шаг.
 * Уже начатую закачку не рвём — оборванный на середине jar-файл хуже лишнего мода.
 */
function stopAgent() {
  if (!busy || stopped) return;
  stopped = true;
  app.ai.cancel();
  if (pendingPermit) pendingPermit(false);
}

/** Показывает «Спросить» или «Стоп» — смотря, занят ли помощник сейчас */
function setBusy(on) {
  busy = on;
  $('#send').hidden = on;
  $('#stop').hidden = !on;
}

// адрес сайта в шапке — из настроек сборки, чтобы не расходился с лаунчером
app.links().then((r) => {
  const site = r?.ok && r.data?.site;
  if (site) $('#brand-site').textContent = site.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}).catch(() => { /* останется значение из вёрстки */ });

$('#a-min').addEventListener('click', () => app.win.minimize());
$('#a-max').addEventListener('click', () => app.win.maximize());
$('#a-close').addEventListener('click', () => app.win.close());

function bubble(role, content, kind = '') {
  $('.hello')?.remove();
  const el = document.createElement('div');
  el.className = `msg ${role === 'user' ? 'me' : 'ai'}${kind ? ` ${kind}` : ''}`;
  el.innerHTML = `<div class="who">${role === 'user' ? 'Я' : 'PL'}</div><div class="body"></div>`;
  const body = el.querySelector('.body');
  if (content instanceof Node) body.appendChild(content); else body.textContent = content;
  $('#chat').appendChild(el);
  $('#chat').scrollTop = $('#chat').scrollHeight;
  return body;
}

/**
 * Показывает ответ помощника с разметкой.
 * Текст приходит из сети, поэтому html собирает только md.js — он экранирует
 * ответ целиком и сам расставляет теги.
 */
function fillAnswer(body, text) {
  body.innerHTML = window.md.render(text);

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = T('Копировать');
  copy.addEventListener('click', () => flash(copy, T('Скопировано'), text));
  actions.appendChild(copy);
  body.appendChild(actions);

  for (const btn of body.querySelectorAll('.code-block .copy')) {
    btn.textContent = T('копировать');            // надпись приходит из md.js
    btn.addEventListener('click', () => {
      const code = btn.parentElement.querySelector('code').textContent;
      flash(btn, T('скопировано'), code);
    });
  }
}

/** Копирует текст и на секунду меняет надпись на кнопке */
function flash(btn, done, text) {
  navigator.clipboard.writeText(text).catch(() => {});
  const was = btn.textContent;
  btn.textContent = done;
  btn.classList.add('done');
  setTimeout(() => { btn.textContent = was; btn.classList.remove('done'); }, 1200);
}

// ссылки в ответах открываем системным браузером, а не внутри окна помощника
document.addEventListener('click', (e) => {
  const a = e.target.closest('.msg .body a[href]');
  if (!a) return;
  e.preventDefault();
  app.shell.open(a.href);
});

function typingBubble() {
  const dots = document.createElement('span');
  dots.className = 'typing';
  dots.innerHTML = '<i></i><i></i><i></i>';
  return bubble('assistant', dots);
}

/**
 * Что сейчас в лаунчере. Чем точнее контекст, тем меньше помощник
 * переспрашивает версию и тем реже советует моды не под тот загрузчик.
 */
async function launcherContext() {
  const data = async (p, fallback) => { try { const r = await p; return r.ok ? r.data : fallback; } catch { return fallback; } };
  try {
    const cfg = await data(app.config.get(), {});
    const instances = await data(app.instances.list(), []);
    if (!instances.length) return 'Сборок пока нет — их создают во вкладке «Версии».';

    const cur = instances.find((i) => i.id === cfg.lastInstance) || instances[0];
    const [mods, packs, shaders] = await Promise.all([
      data(app.mods.installed(cur.id, 'mod'), []),
      data(app.mods.installed(cur.id, 'resourcepack'), []),
      data(app.mods.installed(cur.id, 'shader'), []),
    ]);
    const on = mods.filter((m) => m.enabled).map((m) => m.file.replace(/\.jar$/i, ''));
    const off = mods.filter((m) => !m.enabled).map((m) => m.file.replace(/\.jar\.disabled$/i, ''));

    return [
      // id обязателен: инструменты работают по нему, иначе модель подставит название
      `Текущая сборка: «${cur.name}» (id ${cur.id}) — Minecraft ${cur.mc}, загрузчик ${cur.loader === 'vanilla' ? 'без модов (ваниль)' : cur.loader}${cur.loaderVersion ? ` ${cur.loaderVersion}` : ''}.`,
      `Память: ${cfg.minRam}–${cfg.maxRam} МБ. Java: ${cfg.javaPath || 'выбирается автоматически'}. Аргументы JVM: ${cfg.jvmArgs || 'по умолчанию'}.`,
      on.length ? `Включённые моды (${on.length}): ${on.slice(0, 60).join(', ')}` : 'Моды не установлены.',
      off.length ? `Выключенные моды (${off.length}): ${off.slice(0, 20).join(', ')}` : '',
      packs.length ? `Ресурспаков: ${packs.length}. ` : '',
      shaders.length ? `Шейдеров: ${shaders.length}.` : '',
      instances.length > 1
        ? `Другие сборки: ${instances.filter((i) => i.id !== cur.id).map((i) => `${i.name} (id ${i.id}, ${i.mc}, ${i.loader})`).slice(0, 8).join('; ')}`
        : '',
      `Разрешение окна игры: ${cfg.width}x${cfg.height}${cfg.fullscreen ? ', полноэкранный' : ''}.`,
    ].filter(Boolean).join('\n');
  } catch { return ''; }
}

// ---------------- инструменты помощника ----------------

/*
 * Помощник умеет не только советовать. Читающие инструменты выполняются сразу —
 * они ничего не меняют. Всё, что скачивает или создаёт папки, сначала показывается
 * человеку карточкой с кнопками: без нажатия «Разрешить» не выполнится ничего.
 */

const READONLY = new Set(['list_instances', 'list_installed_mods', 'search_mods', 'search_modpacks']);

const taskId = () => `agent-${Date.now().toString(36)}`;

/** Разворачивает ответ IPC ({ok, data} | {ok:false, error}) или бросает ошибку */
async function unwrap(promise) {
  const r = await promise;
  if (!r.ok) throw new Error(r.error || 'не получилось');
  return r.data;
}

/**
 * Ищет сборку по id, а если не нашлась — по названию: модель нет-нет да и подставит
 * в instance_id имя сборки вместо её id, и ронять из-за этого действие не стоит.
 */
async function instanceById(id) {
  if (!id) return null;
  const list = await unwrap(app.instances.list());
  const key = String(id).trim().toLowerCase();
  return list.find((i) => i.id === id)
    || list.find((i) => String(i.name).trim().toLowerCase() === key)
    || null;
}

/** Создаёт сборку: подбирает версию загрузчика, качает игру, заводит папку */
async function makeInstance({ name, mc, loader = 'vanilla' }) {
  let loaderVersion = null;
  if (loader && loader !== 'vanilla') {
    const list = await unwrap(app.versions.loaders(loader, mc));
    if (!list.length) throw new Error(`Для Minecraft ${mc} нет доступных сборок ${loader}`);
    loaderVersion = (list.find((l) => l.stable) || list[0]).version;
  }
  const { versionId } = await unwrap(app.versions.install({ taskId: taskId(), mc, loader, loaderVersion }));
  return unwrap(app.instances.create({
    name: name || `${mc}${loader !== 'vanilla' ? ` ${loader}` : ''}`,
    mc, loader, loaderVersion, versionId,
  }));
}

const TOOLS = {
  async list_instances() {
    const list = await unwrap(app.instances.list());
    return list.map((i) => ({ id: i.id, name: i.name, mc: i.mc, loader: i.loader, folder: i.folder }));
  },

  async list_installed_mods({ instance_id, kind = 'mod' }) {
    const inst = await instanceById(instance_id);
    if (!inst) throw new Error('Такой сборки нет — сначала возьми id из list_instances');
    const list = await unwrap(app.mods.installed(inst.id, kind));
    return list.map((m) => ({ file: m.file, enabled: m.enabled, name: m.name || null }));
  },

  /**
   * Явные mc и loader важнее сборки: моды для будущей сборки подбираются тогда,
   * когда её ещё нет, и без фильтра в набор попал бы мод не под ту версию.
   */
  async search_mods({ query, instance_id, mc, loader, kind = 'mod', limit = 6 }) {
    const inst = instance_id ? await instanceById(instance_id) : null;
    const useLoader = loader || (inst && inst.loader !== 'vanilla' ? inst.loader : '');
    const r = await unwrap(app.mods.search({
      query,
      kind,
      mc: mc || inst?.mc || '',
      loader: kind === 'mod' ? useLoader : '',
      limit: Math.min(Math.max(Number(limit) || 6, 1), 10),
    }));
    return (r.hits || []).slice(0, 10).map((h) => ({
      source: h.source, project_id: String(h.id), name: h.name,
      summary: h.summary, downloads: h.downloads,
    }));
  },

  async search_modpacks({ query, mc = '', loader = '' }) {
    const r = await unwrap(app.mods.search({ query, kind: 'modpack', mc, loader, limit: 8 }));
    return (r.hits || []).slice(0, 8).map((h) => ({
      source: h.source, project_id: String(h.id), name: h.name,
      summary: h.summary, downloads: h.downloads,
    }));
  },

  async create_instance({ name, mc, loader = 'vanilla' }) {
    const inst = await makeInstance({ name, mc, loader });
    return { created: true, instance_id: inst.id, name: inst.name, folder: inst.folder };
  },

  async install_modpack({ source, project_id }) {
    const r = await unwrap(app.mods.installPack({ taskId: taskId(), source, projectId: project_id }));
    return {
      installed: true,
      instance_id: r.instance.id,
      name: r.instance.name,
      mods: `${r.installed} из ${r.total}`,
      // о подменённой версии загрузчика молчать нельзя: сборка поедет не на той, что задумал автор
      loader_swapped: r.loaderSwapped ? `${r.loaderSwapped.want} → ${r.loaderSwapped.used}` : null,
      blocked: r.blocked?.length || 0,
    };
  },

  /**
   * Своя сборка под задачу: создаём её и ставим весь набор.
   * Один упавший мод не отменяет остальные — итог возвращаем честным списком,
   * чтобы помощник не отрапортовал об успехе там, где половина не встала.
   */
  async build_modpack({ name, mc, loader, mods = [] }, status) {
    if (!Array.isArray(mods) || !mods.length) throw new Error('Список модов пуст');
    const list = mods.slice(0, 20);

    status?.text(`Создаю сборку «${name}»…`);
    const inst = await makeInstance({ name, mc, loader });

    const ok = [];
    const failed = [];
    for (let i = 0; i < list.length; i++) {
      if (stopped) break;
      const m = list[i];
      status?.text(`Ставлю ${m.name} (${i + 1} из ${list.length})…`);
      try {
        await unwrap(app.mods.install({
          taskId: taskId(),
          source: m.source,
          projectId: m.project_id,
          mc, loader, kind: 'mod',
          instance: inst.id,
          withDeps: true,
        }));
        ok.push(m.name);
      } catch (e) {
        failed.push(`${m.name}: ${e.message}`);
      }
    }
    return {
      built: true,
      instance_id: inst.id,
      name: inst.name,
      installed: ok,
      failed,
      stopped_early: stopped && ok.length + failed.length < list.length,
    };
  },

  async install_mod({ instance_id, source, project_id, kind = 'mod' }) {
    const inst = await instanceById(instance_id);
    if (!inst) throw new Error('Такой сборки нет — сначала возьми id из list_instances');
    const r = await unwrap(app.mods.install({
      taskId: taskId(),
      source,
      projectId: project_id,
      mc: inst.mc,
      loader: inst.loader,
      kind,
      instance: inst.id,
      withDeps: true,
    }));
    return { installed: true, files: r?.files || r?.file || null };
  },
};

/** Понятное описание действия — его читает человек перед тем, как разрешить */
function describe(name, a) {
  if (name === 'create_instance') {
    return {
      title: 'Создать сборку',
      what: `${a.name || 'Новая сборка'} — Minecraft ${a.mc}${a.loader && a.loader !== 'vanilla' ? `, ${a.loader}` : ', без модов'}`,
      note: 'Скачает версию игры и загрузчик — это займёт место на диске.',
    };
  }
  if (name === 'install_mod') {
    return {
      title: 'Установить мод',
      what: `${a.name} → сборка «${a.instanceName || a.instance_id}»`,
      note: `Источник: ${a.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}. Зависимости поставятся вместе с ним.`,
    };
  }
  if (name === 'install_modpack') {
    return {
      title: 'Установить готовый модпак',
      what: `${a.name} — новая сборка со всеми модами автора`,
      note: `Источник: ${a.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}. Модпаки весят много — это надолго.`,
    };
  }
  if (name === 'build_modpack') {
    const mods = Array.isArray(a.mods) ? a.mods : [];
    return {
      title: 'Собрать сборку',
      what: `${a.name} — Minecraft ${a.mc}, ${a.loader}`,
      note: `Создаст сборку и поставит модов: ${mods.length}`,
      list: mods.map((m) => m.name),
    };
  }
  return { title: name, what: JSON.stringify(a), note: '' };
}

/** Карточка подтверждения. Ждёт нажатия и возвращает true/false. */
function askPermission(name, args) {
  return new Promise((resolve) => {
    const d = describe(name, args);
    const card = document.createElement('div');
    card.className = 'permit';
    card.innerHTML = `
      <div class="permit-head">${window.md.esc(T(d.title))}</div>
      <div class="permit-what"></div>
      <div class="permit-note dim"></div>
      <div class="permit-list" hidden></div>
      <div class="permit-btns">
        <button class="btn accent" data-yes>${window.md.esc(T('Разрешить'))}</button>
        <button class="btn" data-no>${window.md.esc(T('Не надо'))}</button>
      </div>`;
    card.querySelector('.permit-what').textContent = T(d.what);
    card.querySelector('.permit-note').textContent = T(d.note);

    // состав сборки показываем целиком: человек соглашается на конкретный список,
    // а не на «поставить что-нибудь»
    if (d.list?.length) {
      const box = card.querySelector('.permit-list');
      box.hidden = false;
      for (const item of d.list) {
        const row = document.createElement('span');
        row.textContent = item;
        box.appendChild(row);
      }
    }

    const done = (ok) => {
      if (!pendingPermit) return;           // уже отвечено — второй раз не считаем
      pendingPermit = null;
      card.querySelector('.permit-btns')?.remove();
      const mark = document.createElement('div');
      mark.className = `permit-done ${ok ? 'ok' : 'no'}`;
      mark.textContent = T(ok ? 'Разрешено' : 'Отклонено');
      card.appendChild(mark);
      resolve(ok);
    };
    // «Стоп» отвечает за человека отказом: висящая карточка держала бы весь цикл
    pendingPermit = done;
    card.querySelector('[data-yes]').addEventListener('click', () => done(true));
    card.querySelector('[data-no]').addEventListener('click', () => done(false));

    $('#chat').appendChild(card);
    $('#chat').scrollTop = $('#chat').scrollHeight;
  });
}

/**
 * Выполняет запрошенный инструмент, спросив разрешение, если он что-то меняет.
 * Никогда не бросает исключение: на каждый вызов инструмента сервису обязан
 * уйти ответ, иначе следующий запрос отвергается с ошибкой 400 и переписка
 * становится непригодной до очистки.
 */
async function runToolCall(callInfo, status) {
  const name = callInfo.function?.name;
  try {
    let args = {};
    try { args = JSON.parse(callInfo.function.arguments || '{}'); } catch { /* пустые аргументы */ }

    const runner = TOOLS[name];
    if (!runner) return { error: `Инструмент ${name} не поддерживается` };

    if (!READONLY.has(name)) {
      // в карточке показываем название сборки, а не её id — человеку так понятнее
      if (args.instance_id) args.instanceName = (await instanceById(args.instance_id))?.name;
      status.hide();
      const allowed = await askPermission(name, args);
      status.show();
      if (!allowed) return { declined: true, note: 'Пользователь отказался. Не повторяй это действие.' };
    }

    const STARTING = {
      install_mod: 'Устанавливаю…',
      create_instance: 'Создаю сборку…',
      install_modpack: 'Ставлю модпак — это надолго…',
      build_modpack: 'Собираю сборку…',
    };
    status.text(STARTING[name] || 'Смотрю…');
    // сборке набора нужен статус: она идёт долго и должна показывать, что ставит сейчас
    return await runner(args, status);
  } catch (e) {
    return { error: e.message || 'не получилось' };
  }
}

// вопрос про последний вылет отдаём разбору — только он видит лог и crash-report
const ABOUT_CRASH = /(вылет|краш|crash|упал|вылет|закрыл[аи]сь|не запускается|не стартует|ошибк|error)/i;
const ABOUT_MINE = /(последн|мо[йяе]|у меня|разбер|почему|что не так|помоги)/i;

/** Пузырь «печатает…», который умеет прятаться на время вопроса про разрешение */
function statusBubble() {
  let body = typingBubble();
  const msg = () => body.closest('.msg');
  return {
    body: () => body,
    hide() { msg().hidden = true; },
    show() { msg().hidden = false; $('#chat').scrollTop = $('#chat').scrollHeight; },
    text(line) {
      body.innerHTML = '<span class="typing"><i></i><i></i><i></i></span> ';
      body.append(T(line));
      $('#chat').scrollTop = $('#chat').scrollHeight;
    },
    /** начинает новый пузырь; прошлый остаётся в переписке как есть */
    restart() { body = typingBubble(); },
  };
}

/*
 * Сколько раз подряд модель может просить инструменты.
 * Обычная сборка укладывается в два-три шага: поиск всех модов идёт одним заходом.
 * Запас нужен на нештатное — мод не нашёлся, установка сорвалась, человек отказал
 * и модель ищет другой путь. На последнем заходе инструменты не выдаются вовсе,
 * поэтому разговор всегда заканчивается ответом, а не ошибкой про «круг».
 */
const MAX_STEPS = 12;

/** Подпись вызова: одинаковое имя и одинаковые аргументы — один и тот же запрос */
const callKey = (c) => `${c.function.name}:${c.function.arguments || ''}`;

/** Ведёт разговор, пока модель просит инструменты, и возвращает итоговый ответ */
async function converse(status, doneSoFar) {
  const context = await launcherContext();
  const seen = new Map();          // что уже спрашивали — чтобы не спрашивать дважды

  for (let step = 0; step <= MAX_STEPS; step++) {
    // последний заход — без инструментов: модель обязана ответить словами
    const finish = step === MAX_STEPS;
    if (finish) status.text('Подвожу итог…');

    const r = await app.ai.chat({ messages: history, context, noTools: finish });
    if (stopped) return null;
    if (!r.ok) throw new Error(r.error);
    const { text, toolCalls } = r.data;

    if (!toolCalls || !toolCalls.length) return text;

    history.push({ role: 'assistant', content: text || '', tool_calls: toolCalls });
    if (text) { fillAnswer(status.body(), text); status.restart(); }

    // На каждый вызов инструмента ответ обязателен, даже после «Стоп»:
    // иначе переписка останется битой и следующий вопрос упрётся в ошибку 400.
    for (const c of toolCalls) {
      const key = callKey(c);
      let result;

      if (stopped) {
        result = { declined: true, note: 'Пользователь остановил помощника.' };
      } else if (seen.has(key)) {
        // Повтор того же запроса — самая частая причина хождения по кругу.
        // Ответ отдаём прежний и прямо говорим не повторяться: заново лезть
        // в сеть или второй раз дёргать человека тем же вопросом незачем.
        result = {
          ...seen.get(key),
          repeated: true,
          note: 'Этот запрос уже выполнялся выше, ответ тот же. Не повторяй его — '
            + 'действуй по тому, что уже известно, или скажи словами, что не выходит.',
        };
      } else {
        result = await runToolCall(c, status);
        seen.set(key, result);
      }

      // что успело встать — реально лежит в сборке, и сказать об этом надо
      if (Array.isArray(result?.installed) && result.installed.length) {
        doneSoFar.push(...result.installed);
      } else if (result?.installed === true && c.function?.name === 'install_mod') {
        try { doneSoFar.push(JSON.parse(c.function.arguments).name); } catch { /* без имени */ }
      }
      history.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
    if (stopped) return null;
    status.text('Думаю…');
  }
  // сюда не попасть: на шаге MAX_STEPS инструментов нет, значит был обычный ответ
  return null;
}

async function send(text) {
  const q = String(text || $('#input').value).trim();
  if (!q || busy) return;

  stopped = false;
  setBusy(true);
  $('#input').value = '';
  $('#input').style.height = 'auto';
  bubble('user', q);
  history.push({ role: 'user', content: q });
  const status = statusBubble();
  const doneSoFar = [];        // что успели поставить — пригодится, если нажмут «Стоп»

  try {
    // просьбу разобрать вылет отдаём отдельному разбору — он видит лог игры
    if (ABOUT_CRASH.test(q) && ABOUT_MINE.test(q)) {
      const r = await app.ai.explain();
      if (stopped) return;
      if (r.ok) {
        fillAnswer(status.body(), r.data.text);
        history.push({ role: 'assistant', content: r.data.text });
        return;
      }
      // если разбирать нечего — продолжаем обычным ответом
    }
    const answer = await converse(status, doneSoFar);
    if (stopped) return;
    if (!answer) throw new Error('Помощник не смог ответить — попробуйте спросить иначе');
    fillAnswer(status.body(), answer);
    history.push({ role: 'assistant', content: answer });
    persist();
  } catch (e) {
    // после «Стоп» запрос падает по обрыву — это не ошибка, а то, о чём просили
    if (stopped) return;
    status.body().textContent = e.message || 'Не получилось ответить';
    status.body().closest('.msg').classList.add('err');
  } finally {
    if (stopped) {
      status.body().textContent = doneSoFar.length
        ? T(`Остановлено. Успело установиться: ${doneSoFar.join(', ')}.`)
        : T('Остановлено');
      status.body().closest('.msg').classList.add('stopped');
    }
    pendingPermit = null;
    setBusy(false);
    $('#chat').scrollTop = $('#chat').scrollHeight;
    $('#input').focus();
  }
}

$('#stop').addEventListener('click', stopAgent);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopAgent(); });

// Ход установки: прогресс приходит из главного процесса. Пишем в последний
// «печатает…» — искать его перебором надёжнее, чем по позиции: последней
// в чате может стоять карточка разрешения, а не сообщение.
app.on('progress', (p) => {
  if (!busy || !p?.stage) return;
  const dots = $('#chat').querySelectorAll('.typing');
  const line = dots[dots.length - 1]?.parentElement;
  if (!line) return;
  line.innerHTML = '<span class="typing"><i></i><i></i><i></i></span> ';
  line.append(`${p.stage}${p.percent ? ` — ${Math.round(p.percent)}%` : ''}`);
});

$('#send').addEventListener('click', () => send());
// ---------------- история переписок ----------------

/*
 * Разговор сохраняется целиком, вместе с вызовами инструментов: без них
 * продолжить старую переписку нельзя — сервис отвергает её, если на вызов
 * инструмента нет ответа. Сохраняем после каждого ответа, чтобы ничего
 * не потерялось, если лаунчер закроют.
 */
let chatId = null;

async function persist() {
  if (!history.length) return;
  const r = await app.ai.chatSave({ id: chatId, messages: history }).catch(() => null);
  if (r?.ok) { chatId = r.data.id; renderHistory(); }
}

/** Рисует заново весь разговор — используется при открытии из истории */
function replay(messages) {
  $('#chat').innerHTML = '';
  for (const m of messages) {
    if (m.role === 'user') bubble('user', m.content);
    // ответы с вызовами инструментов показываем, только если в них был текст
    else if (m.role === 'assistant' && m.content) fillAnswer(bubble('assistant', ''), m.content);
  }
  $('#chat').scrollTop = $('#chat').scrollHeight;
}

async function openChat(id) {
  if (busy) return;
  const r = await app.ai.chatRead(id).catch(() => null);
  if (!r?.ok) {
    // в этом окне тостов нет — говорим прямо в переписке
    bubble('assistant', T('Не удалось открыть разговор')).closest('.msg').classList.add('err');
    return;
  }
  chatId = id;
  history.length = 0;
  history.push(...r.data.messages);
  replay(r.data.messages);
  renderHistory();
}

function startNew() {
  if (busy) return;
  chatId = null;
  history.length = 0;
  location.reload();
}

async function renderHistory() {
  const box = $('#hist-list');
  if (!box || $('#hist').hidden) return;
  const r = await app.ai.chats().catch(() => null);
  const list = r?.ok ? r.data : [];
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = `<div class="hist-empty">${window.md.esc(T('Прошлых разговоров пока нет'))}</div>`;
    return;
  }
  for (const c of list) {
    const el = document.createElement('button');
    el.className = `hist-item${c.id === chatId ? ' on' : ''}`;
    el.innerHTML = '<b></b><span></span><i title="Удалить">×</i>';
    el.querySelector('b').textContent = c.title;
    el.querySelector('span').textContent = when(c.updated);
    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'I') return;
      openChat(c.id);
    });
    el.querySelector('i').addEventListener('click', async (e) => {
      e.stopPropagation();
      await app.ai.chatRemove(c.id).catch(() => {});
      if (c.id === chatId) chatId = null;
      renderHistory();
    });
    box.appendChild(el);
  }
}

/** Когда был разговор — коротко, без точной даты */
function when(ts) {
  if (!ts) return '';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return T('только что');
  if (min < 60) return `${min} ${T('мин назад')}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ${T('ч назад')}`;
  return new Date(ts).toLocaleDateString();
}

$('#hist-toggle').addEventListener('click', () => {
  const box = $('#hist');
  box.hidden = !box.hidden;
  if (!box.hidden) renderHistory();
});

$('#new-chat').addEventListener('click', startNew);

$('#hist-clear').addEventListener('click', async () => {
  if (!confirm(T('Удалить всю историю переписок?'))) return;
  await app.ai.chatsClear().catch(() => {});
  chatId = null;
  renderHistory();
});

$('#clear').addEventListener('click', startNew);

$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('#input').addEventListener('input', (e) => {
  e.target.style.height = 'auto';
  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
});

document.querySelectorAll('#quick .chip').forEach((b) =>
  b.addEventListener('click', () => send(b.dataset.q)));

$('#input').focus();
