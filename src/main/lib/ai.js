'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

let embeddedKey = () => '';
try { embeddedKey = require('./embedded-key'); } catch { /* сборка без вшитых ключей */ }

const API = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';
const TIMEOUT_MS = 45000;
const MAX_LOG = 12000;          // столько символов лога отправляем максимум

const SYSTEM = `Ты помогаешь игроку в Minecraft разобраться, почему игра закрылась с ошибкой.
Отвечай по-русски, коротко и по делу, без вступлений и без markdown-заголовков.
Формат ответа:
1) Одно предложение — что случилось простыми словами.
2) Причина: какой мод, библиотека или настройка виноваты (называй конкретные имена из лога).
3) Что сделать: 1-3 коротких пункта с конкретными действиями.
Если в логе нет явной ошибки, так и скажи. Не выдумывай моды, которых нет в логе.`;

/** Убирает из лога имя пользователя Windows и пути к домашней папке */
function anonymize(text) {
  const user = os.userInfo().username;
  let out = String(text);
  if (user) out = out.split(user).join('user');
  return out.replace(/[A-Za-z]:\\Users\\[^\\\s"]+/g, 'C:\\Users\\user');
}

/** Из длинного лога оставляем хвост и строки, похожие на ошибку */
function squeezeLog(log) {
  const text = anonymize(log);
  if (text.length <= MAX_LOG) return text;

  const lines = text.split(/\r?\n/);
  const interesting = lines.filter((l) => /ERROR|FATAL|Exception|Caused by|at [\w.$]+\(|Mod File|incompatible|missing|Failed/i.test(l));
  const head = interesting.slice(0, 120).join('\n');
  const tail = lines.slice(-160).join('\n');
  return `${head}\n...\n${tail}`.slice(-MAX_LOG);
}

/** Свежий crash-report из папки версии — там причина обычно написана яснее, чем в консоли */
async function readCrashReport(gameDir) {
  try {
    const dir = path.join(gameDir, 'crash-reports');
    const files = (await fsp.readdir(dir))
      .filter((f) => f.endsWith('.txt'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (!files.length) return null;
    // берём только свежий отчёт, чтобы не разбирать вчерашние падения
    if (Date.now() - files[0].t > 5 * 60 * 1000) return null;
    const text = await fsp.readFile(path.join(dir, files[0].f), 'utf8');
    return { name: files[0].f, text: text.slice(0, MAX_LOG) };
  } catch { return null; }
}

/**
 * Просит DeepSeek объяснить, из-за чего вылетела игра.
 * @returns {Promise<{text: string, source: string}>}
 */
async function explainCrash({ log = '', gameDir = '', instance = {}, exitCode = 1, mods = [] }) {
  const key = embeddedKey('deepseek');
  if (!key) throw new Error('В сборке нет ключа для разбора ошибок');

  const report = gameDir ? await readCrashReport(gameDir) : null;
  const parts = [
    `Minecraft ${instance.mc || '?'}, загрузчик: ${instance.loader || 'без модов'}, код выхода: ${exitCode}.`,
    mods.length ? `Установленные моды (${mods.length}): ${mods.slice(0, 40).join(', ')}` : 'Моды не установлены.',
    report ? `\nОтчёт о падении (${report.name}):\n${anonymize(report.text)}` : '',
    `\nВывод игры:\n${squeezeLog(log)}`,
  ];

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ac.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: parts.filter(Boolean).join('\n') },
        ],
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      // ключ в текст ошибки не попадает — наружу отдаём только код и краткое пояснение
      if (res.status === 401) throw new Error('Ключ разбора ошибок не принят сервисом');
      if (res.status === 402) throw new Error('На аккаунте разбора ошибок закончились средства');
      if (res.status === 429) throw new Error('Слишком много запросов к разбору — попробуйте позже');
      throw new Error(`Сервис разбора ответил ошибкой ${res.status}`);
    }
    const data = JSON.parse(raw);
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Пустой ответ от сервиса разбора');
    return { text, source: report ? `отчёт ${report.name}` : 'вывод игры' };
  } catch (e) {
    if (ac.signal.aborted) throw new Error('Сервис разбора не ответил вовремя');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const AGENT_SYSTEM = `Ты — помощник внутри лаунчера Minecraft «Plus Launcher». Отвечай по-русски, дружелюбно и коротко.

Что ты знаешь про лаунчер:
— Сборки: у каждой версии своя папка в папке лаунчера, внутри mods, saves, config, resourcepacks, shaderpacks.
— Моды ставятся во вкладке «Моды» — поиск идёт сразу по Modrinth и CurseForge, зависимости подтягиваются сами.
— Загрузчики: Fabric, Quilt, Forge, NeoForge — выбираются при создании сборки во вкладке «Версии».
— Вкладка «Скины» умеет грузить скин на лицензию Microsoft и класть локальный скин для оффлайна.
— Java лаунчер находит сам, при необходимости скачивает нужную версию.
— Память и аргументы JVM меняются в «Настройках», там же папка лаунчера и статус в Discord.

Помогай с ошибками, модами, версиями и настройками. Если вопрос не про Minecraft и не про лаунчер —
всё равно ответь, но коротко. Не выдумывай моды и функции, которых нет. Без markdown-заголовков,
списки — обычными цифрами или дефисами.`;

/**
 * Свободный разговор с помощником.
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 */
async function chat(messages, { context = '' } = {}) {
  const key = embeddedKey('deepseek');
  if (!key) throw new Error('В сборке нет ключа помощника');

  const history = (messages || []).slice(-16).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content).slice(0, 6000),
  }));

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ac.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 900,
        messages: [
          { role: 'system', content: AGENT_SYSTEM + (context ? `\n\nЧто сейчас в лаунчере:\n${context}` : '') },
          ...history,
        ],
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      if (res.status === 401) throw new Error('Ключ помощника не принят сервисом');
      if (res.status === 402) throw new Error('На аккаунте помощника закончились средства');
      if (res.status === 429) throw new Error('Слишком много запросов — попробуйте через минуту');
      throw new Error(`Сервис ответил ошибкой ${res.status}`);
    }
    const text = JSON.parse(raw).choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Пустой ответ от сервиса');
    return { text };
  } catch (e) {
    if (ac.signal.aborted) throw new Error('Сервис не ответил вовремя');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const available = () => Boolean(embeddedKey('deepseek'));

module.exports = { explainCrash, chat, available, anonymize, squeezeLog };
