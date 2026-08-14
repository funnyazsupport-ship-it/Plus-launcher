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

/** Что сейчас в лаунчере — помощник отвечает с учётом выбранной сборки */
async function launcherContext() {
  try {
    const cfg = (await app.config.get()).data;
    const instances = (await app.instances.list()).data || [];
    const last = instances.find((i) => i.id === cfg.lastInstance) || instances[0];
    if (!last) return 'Сборок пока нет.';
    const mods = (await app.mods.installed(last.id, 'mod')).data || [];
    return [
      `Выбранная сборка: ${last.name} — Minecraft ${last.mc}, загрузчик ${last.loader}, папка ${last.folder}.`,
      `Память: ${cfg.minRam}–${cfg.maxRam} МБ. Аргументы JVM: ${cfg.jvmArgs || 'нет'}.`,
      mods.length ? `Моды (${mods.length}): ${mods.slice(0, 30).map((m) => m.file).join(', ')}` : 'Моды не установлены.',
      `Всего сборок: ${instances.length}.`,
    ].join('\n');
  } catch { return ''; }
}

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
    if (/вылет|краш|упала|closed with|ошибк/i.test(q) && /последн|мой|разбер/i.test(q)) {
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
