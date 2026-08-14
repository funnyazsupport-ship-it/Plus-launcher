'use strict';
const app = window.api;
const $ = (s) => document.querySelector(s);

const history = [];           // {role, content} — уходит в сервис
let busy = false;

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
      `Текущая сборка: «${cur.name}» — Minecraft ${cur.mc}, загрузчик ${cur.loader === 'vanilla' ? 'без модов (ваниль)' : cur.loader}${cur.loaderVersion ? ` ${cur.loaderVersion}` : ''}.`,
      `Память: ${cfg.minRam}–${cfg.maxRam} МБ. Java: ${cfg.javaPath || 'выбирается автоматически'}. Аргументы JVM: ${cfg.jvmArgs || 'по умолчанию'}.`,
      on.length ? `Включённые моды (${on.length}): ${on.slice(0, 60).join(', ')}` : 'Моды не установлены.',
      off.length ? `Выключенные моды (${off.length}): ${off.slice(0, 20).join(', ')}` : '',
      packs.length ? `Ресурспаков: ${packs.length}. ` : '',
      shaders.length ? `Шейдеров: ${shaders.length}.` : '',
      instances.length > 1
        ? `Другие сборки: ${instances.filter((i) => i.id !== cur.id).map((i) => `${i.name} (${i.mc}, ${i.loader})`).slice(0, 8).join('; ')}`
        : '',
      `Разрешение окна игры: ${cfg.width}x${cfg.height}${cfg.fullscreen ? ', полноэкранный' : ''}.`,
    ].filter(Boolean).join('\n');
  } catch { return ''; }
}

// вопрос про последний вылет отдаём разбору — только он видит лог и crash-report
const ABOUT_CRASH = /(вылет|краш|crash|упал|вылет|закрыл[аи]сь|не запускается|не стартует|ошибк|error)/i;
const ABOUT_MINE = /(последн|мо[йяе]|у меня|разбер|почему|что не так|помоги)/i;

async function send(text) {
  const q = String(text || $('#input').value).trim();
  if (!q || busy) return;

  busy = true;
  $('#send').disabled = true;
  $('#input').value = '';
  $('#input').style.height = 'auto';
  bubble('user', q);
  history.push({ role: 'user', content: q });
  const placeholder = typingBubble();

  try {
    // просьбу разобрать вылет отдаём отдельному разбору — он видит лог игры
    if (ABOUT_CRASH.test(q) && ABOUT_MINE.test(q)) {
      const r = await app.ai.explain();
      if (r.ok) {
        placeholder.textContent = r.data.text;
        history.push({ role: 'assistant', content: r.data.text });
        return;
      }
      // если разбирать нечего — продолжаем обычным ответом
    }
    const r = await app.ai.chat({ messages: history, context: await launcherContext() });
    if (!r.ok) throw new Error(r.error);
    placeholder.textContent = r.data.text;
    history.push({ role: 'assistant', content: r.data.text });
  } catch (e) {
    placeholder.textContent = e.message || 'Не получилось ответить';
    placeholder.closest('.msg').classList.add('err');
  } finally {
    busy = false;
    $('#send').disabled = false;
    $('#chat').scrollTop = $('#chat').scrollHeight;
    $('#input').focus();
  }
}

$('#send').addEventListener('click', () => send());
$('#clear').addEventListener('click', () => {
  history.length = 0;
  location.reload();
});

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
