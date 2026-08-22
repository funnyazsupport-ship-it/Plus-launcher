'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { loadRenderer } = require('./helpers');

const md = loadRenderer('md.js').md;

describe('разметка ответов помощника', () => {
  test('жирный, курсив и код', () => {
    assert.equal(md.render('Поставь **Sodium** через `mods/`'),
      '<p>Поставь <b>Sodium</b> через <code>mods/</code></p>');
  });

  test('заголовки уходят на уровень ниже, чтобы не спорить с заголовком окна', () => {
    assert.equal(md.render('## Что делать'), '<h3>Что делать</h3>');
    assert.equal(md.render('### Память'), '<h4>Память</h4>');
  });

  test('нумерованный список', () => {
    assert.equal(md.render('1. Открой\n2. Найди'), '<ol><li>Открой</li><li>Найди</li></ol>');
  });

  test('вложенный список остаётся правильным html', () => {
    // вложенный <ul> должен лежать внутри <li>, а не рядом с ним
    assert.equal(md.render('- Один\n  - Внутри\n- Два'),
      '<ul><li>Один<ul><li>Внутри</li></ul></li><li>Два</li></ul>');
  });

  test('таблица', () => {
    const out = md.render('| Мод | Загрузчик |\n|---|---|\n| Sodium | Fabric |');
    assert.match(out, /<th>Мод<\/th><th>Загрузчик<\/th>/);
    assert.match(out, /<td>Sodium<\/td><td>Fabric<\/td>/);
  });

  test('блок кода с языком и кнопкой копирования', () => {
    const out = md.render('```bash\n-Xmx4G\n```');
    assert.match(out, /<span class="lang">bash<\/span>/);
    assert.match(out, /<pre><code>-Xmx4G<\/code><\/pre>/);
  });

  /*
   * Раньше метка для кода была из пробелов и цифр, и обычное число в тексте
   * превращалось в <code>undefined</code>. Проверяем, что этого больше нет.
   */
  test('число в тексте не принимается за код', () => {
    assert.equal(md.render('Выделите 4096 МБ, это 4 ГБ.'), '<p>Выделите 4096 МБ, это 4 ГБ.</p>');
  });

  test('несколько кусков кода в строке не путаются', () => {
    assert.equal(md.render('Ставь `Sodium` и `Iris`'),
      '<p>Ставь <code>Sodium</code> и <code>Iris</code></p>');
  });
});

describe('безопасность: ответ приходит из сети', () => {
  test('html в тексте экранируется, а не выполняется', () => {
    const out = md.render('<img src=x onerror=alert(1)> и <script>alert(2)</script>');
    assert.ok(!/<script/i.test(out), 'живого тега script быть не должно');
    assert.ok(!/<img/i.test(out), 'живого тега img быть не должно');
    assert.match(out, /&lt;script&gt;/);
  });

  test('ссылка не на http не превращается в ссылку', () => {
    const out = md.render('[клик](javascript:alert(1))');
    assert.ok(!/href="javascript:/i.test(out));
    assert.ok(!/<a /.test(out), 'javascript: ссылкой стать не должен');
  });

  test('обычная ссылка открывается в новой вкладке и без передачи адреса', () => {
    const out = md.render('[тут](https://modrinth.com/mod/sodium)');
    assert.match(out, /href="https:\/\/modrinth\.com\/mod\/sodium"/);
    assert.match(out, /rel="noreferrer noopener"/);
  });

  test('кавычки в тексте не ломают атрибуты', () => {
    const out = md.render('Он сказал "привет" и \'пока\'');
    assert.ok(!out.includes('"привет"'), 'кавычки должны быть экранированы');
    assert.match(out, /&quot;|&#39;/);
  });
});
