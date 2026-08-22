'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { dirs } = require('./paths');

/*
 * История переписок с помощником.
 *
 * Каждый разговор — отдельный файл в chats/. Отдельными файлами, а не одним
 * списком, чтобы длинная переписка не тянулась в память вместе со всеми
 * остальными и чтобы порча одного файла не уносила всю историю.
 *
 * Внутри лежит и служебная часть — вызовы инструментов: без них продолжить
 * старый разговор нельзя, сервис отвергает переписку с неотвеченным вызовом.
 */

const DIR = path.join(dirs.root, 'chats');
const MAX_CHATS = 100;          // сверх этого удаляем самые старые
const MAX_TITLE = 80;

const file = (id) => path.join(DIR, `${id}.json`);
const ok = (id) => /^[a-z0-9]{6,32}$/.test(String(id || ''));

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Название разговора — первый вопрос человека, обрезанный до одной строки */
function titleFrom(messages) {
  const first = (messages || []).find((m) => m.role === 'user' && String(m.content || '').trim());
  const text = String(first?.content || 'Без названия').replace(/\s+/g, ' ').trim();
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1)}…` : text;
}

async function ensure() {
  await fsp.mkdir(DIR, { recursive: true });
}

/** Список разговоров: только заголовки, без самих сообщений */
async function list() {
  await ensure();
  const out = [];
  for (const f of await fsp.readdir(DIR).catch(() => [])) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(await fsp.readFile(path.join(DIR, f), 'utf8'));
      out.push({
        id: path.basename(f, '.json'),
        title: raw.title || 'Без названия',
        updated: raw.updated || 0,
        count: Array.isArray(raw.messages) ? raw.messages.length : 0,
      });
    } catch { /* битый файл просто не показываем */ }
  }
  return out.sort((a, b) => b.updated - a.updated);
}

async function read(id) {
  if (!ok(id)) throw new Error('Неверный номер разговора');
  try {
    const raw = JSON.parse(await fsp.readFile(file(id), 'utf8'));
    return {
      id,
      title: raw.title || 'Без названия',
      updated: raw.updated || 0,
      messages: Array.isArray(raw.messages) ? raw.messages : [],
    };
  } catch {
    throw new Error('Разговор не открывается');
  }
}

/** Самые старые сверх предела удаляем, чтобы папка не росла без конца */
async function trim() {
  const all = await list();
  for (const c of all.slice(MAX_CHATS)) {
    await fsp.unlink(file(c.id)).catch(() => {});
  }
}

/**
 * Сохраняет разговор. id не передан — заводится новый.
 * @returns {Promise<{id: string, title: string}>}
 */
async function save(id, messages) {
  await ensure();
  const list_ = Array.isArray(messages) ? messages : [];
  if (!list_.length) throw new Error('Нечего сохранять');

  const chatId = ok(id) ? id : newId();
  const title = titleFrom(list_);
  const data = { title, updated: Date.now(), messages: list_ };
  await fsp.writeFile(file(chatId), JSON.stringify(data), 'utf8');
  await trim();
  return { id: chatId, title };
}

async function remove(id) {
  if (!ok(id)) throw new Error('Неверный номер разговора');
  await fsp.unlink(file(id)).catch(() => {});
  return true;
}

/** Удаляет всю историю разом */
async function clear() {
  await ensure();
  for (const f of await fsp.readdir(DIR).catch(() => [])) {
    if (f.endsWith('.json')) await fsp.unlink(path.join(DIR, f)).catch(() => {});
  }
  return true;
}

module.exports = { list, read, save, remove, clear, DIR, titleFrom };
