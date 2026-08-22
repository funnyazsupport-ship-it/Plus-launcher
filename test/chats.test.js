'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { useTempRoot, freshRequire } = require('./helpers');

let root;
let chats;

before(() => { root = useTempRoot(); });

beforeEach(() => {
  try { fs.rmSync(path.join(root, 'chats'), { recursive: true }); } catch { /* могло не быть */ }
  chats = freshRequire('../src/main/lib/chats.js');
});

const talk = (q, a) => [{ role: 'user', content: q }, { role: 'assistant', content: a }];

describe('история переписок', () => {
  test('сохранение и чтение', async () => {
    const { id } = await chats.save(null, talk('Какие моды поставить?', 'Sodium и Lithium'));
    const back = await chats.read(id);
    assert.equal(back.messages.length, 2);
    assert.equal(back.messages[0].content, 'Какие моды поставить?');
  });

  test('название берётся из первого вопроса человека', async () => {
    const { title } = await chats.save(null, talk('Собери сборку на технику', 'Готово'));
    assert.equal(title, 'Собери сборку на технику');
  });

  test('длинное название подрезается', async () => {
    const { title } = await chats.save(null, talk('я'.repeat(500), 'ответ'));
    assert.ok(title.length <= 80, `длина ${title.length}`);
    assert.ok(title.endsWith('…'));
  });

  test('переносы строк в названии не ломают список', async () => {
    const { title } = await chats.save(null, talk('первая строка\nвторая\nтретья', 'ответ'));
    assert.ok(!title.includes('\n'));
  });

  /*
   * Вызовы инструментов обязаны сохраняться: без них сервис отвергает переписку,
   * в которой на вызов инструмента нет ответа, и продолжить разговор не выйдет.
   */
  test('служебные части разговора сохраняются целиком', async () => {
    const withTools = [
      { role: 'user', content: 'Поставь Sodium' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'install_mod', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{"installed":true}' },
      { role: 'assistant', content: 'Готово' },
    ];
    const { id } = await chats.save(null, withTools);
    const back = await chats.read(id);
    assert.equal(back.messages.length, 4);
    assert.equal(back.messages[1].tool_calls[0].id, 'c1');
    assert.equal(back.messages[2].role, 'tool');
  });

  test('повторное сохранение обновляет тот же разговор, а не плодит новые', async () => {
    const first = await chats.save(null, talk('Вопрос', 'Ответ'));
    await chats.save(first.id, [...talk('Вопрос', 'Ответ'), ...talk('Ещё вопрос', 'Ещё ответ')]);
    const all = await chats.list();
    assert.equal(all.length, 1);
    assert.equal((await chats.read(first.id)).messages.length, 4);
  });

  test('список отсортирован — свежие сверху', async () => {
    const a = await chats.save(null, talk('Первый', 'x'));
    await new Promise((r) => setTimeout(r, 5));
    const b = await chats.save(null, talk('Второй', 'x'));
    const all = await chats.list();
    assert.equal(all[0].id, b.id);
    assert.equal(all[1].id, a.id);
  });

  test('удаление одного разговора и всей истории', async () => {
    const a = await chats.save(null, talk('Первый', 'x'));
    await chats.save(null, talk('Второй', 'x'));
    await chats.remove(a.id);
    assert.equal((await chats.list()).length, 1);
    await chats.clear();
    assert.equal((await chats.list()).length, 0);
  });

  test('пустой разговор не сохраняется', async () => {
    await assert.rejects(() => chats.save(null, []), /Нечего сохранять/);
  });

  // id приходит из окна помощника, но проверяем всё равно: путь наружу папки
  // не должен открыть чужой файл на диске
  test('выход за папку истории не проходит', async () => {
    for (const bad of ['../../config', 'a/b', '..', '', null, 'ЗАГЛАВНЫЕ']) {
      await assert.rejects(() => chats.read(bad), /Неверный номер|не открывается/, String(bad));
    }
  });

  test('битый файл не роняет список', async () => {
    await chats.save(null, talk('Живой', 'x'));
    fs.writeFileSync(path.join(root, 'chats', 'slomannyy.json'), 'это не json');
    const all = await chats.list();
    assert.equal(all.length, 1, 'битый файл просто не показывается');
  });
});
