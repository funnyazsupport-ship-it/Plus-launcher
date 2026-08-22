'use strict';
/*
 * Разметка ответов помощника. Своя, а не библиотека: окно помощника работает
 * под строгим CSP (script-src 'self'), сторонний скрипт туда не подключить.
 *
 * Про безопасность: текст приходит от внешнего сервиса, поэтому HTML в нём
 * экранируется ДО разметки. Всё, что модель напишет тегами, останется текстом,
 * а сами теги появляются только там, где их поставил этот файл.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

// href уже экранирован и проверен на http(s) — javascript: сюда не пролезет
const link = (href, text) => `<a href="${href}" target="_blank" rel="noreferrer noopener">${text}</a>`;

/** Жирный, курсив, код и ссылки внутри строки */
function inline(text) {
  let out = esc(text);

  // `код` вынимаем первым: внутри него разметка не работает
  const codes = [];
  out = out.replace(/`([^`\n]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`);

  out = out
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+)__/g, '<b>$1</b>')
    .replace(/(^|[\s(—-])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>');

  out = out
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, href) => link(href, t))
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, href) => pre + link(href, href));

  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const NUMBER = /^(\s*)\d+[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,4})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```(\w+)?\s*$/;
// строка-разделитель шапки таблицы: |---|:--:|
const TABLE_SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

const isList = (l) => BULLET.test(l) || NUMBER.test(l);
const cells = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

/** Пункты списка в html; вложенность определяется по отступу */
function buildList(items, ordered) {
  const tag = ordered ? 'ol' : 'ul';
  const out = [`<${tag}>`];
  const stack = [items[0].indent];

  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    const next = items[k + 1];
    while (stack.length > 1 && it.indent < stack[stack.length - 1]) {
      out.push(`</${tag}></li>`);
      stack.pop();
    }
    if (it.indent > stack[stack.length - 1]) {
      out.push(`<${tag}>`);
      stack.push(it.indent);
    }
    out.push(`<li>${inline(it.text)}`);
    // если следующий пункт глубже — <li> оставляем открытым, вложенный список ляжет внутрь
    if (!(next && next.indent > it.indent)) out.push('</li>');
  }
  while (stack.length > 1) { out.push(`</${tag}></li>`); stack.pop(); }
  out.push(`</${tag}>`);
  return out.join('');
}

function takeList(lines, i) {
  const ordered = NUMBER.test(lines[i]);
  const items = [];
  while (i < lines.length) {
    const m = lines[i].match(ordered ? NUMBER : BULLET);
    if (m) {
      items.push({ indent: m[1].length, text: m[2] });
      i++;
    } else if (items.length && /^\s+\S/.test(lines[i]) && !isList(lines[i])) {
      // продолжение пункта на следующей строке
      items[items.length - 1].text += ` ${lines[i].trim()}`;
      i++;
    } else break;
  }
  return { html: buildList(items, ordered), next: i };
}

function takeTable(lines, i) {
  const head = cells(lines[i]);
  const rows = [];
  let j = i + 2;
  while (j < lines.length && lines[j].includes('|') && lines[j].trim()) {
    rows.push(cells(lines[j]));
    j++;
  }
  const th = head.map((c) => `<th>${inline(c)}</th>`).join('');
  const tb = rows
    .map((r) => `<tr>${head.map((_, n) => `<td>${inline(r[n] || '')}</td>`).join('')}</tr>`)
    .join('');
  return { html: `<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`, next: j };
}

function takeCode(lines, i) {
  const lang = (lines[i].match(FENCE) || [])[1] || '';
  const body = [];
  let j = i + 1;
  while (j < lines.length && !FENCE.test(lines[j])) { body.push(lines[j]); j++; }
  const label = lang ? `<span class="lang">${esc(lang)}</span>` : '';
  return {
    html: `<div class="code-block">${label}<button class="copy" type="button">копировать</button>`
      + `<pre><code>${esc(body.join('\n'))}</code></pre></div>`,
    next: j + 1,
  };
}

/** Markdown -> html. Поддержано то, что реально пишет модель. */
function render(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    if (FENCE.test(line)) { const r = takeCode(lines, i); out.push(r.html); i = r.next; continue; }
    if (RULE.test(line)) { out.push('<hr />'); i++; continue; }

    const h = line.match(HEADING);
    if (h) {
      const level = Math.min(h[1].length + 1, 4);   // ## -> h3, чтобы не спорить с заголовком окна
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    if (isList(line)) { const r = takeList(lines, i); out.push(r.html); i = r.next; continue; }

    if (line.includes('|') && lines[i + 1] && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('|')) {
      const r = takeTable(lines, i);
      out.push(r.html);
      i = r.next;
      continue;
    }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) { body.push(lines[i].match(QUOTE)[1]); i++; }
      out.push(`<blockquote>${inline(body.join(' '))}</blockquote>`);
      continue;
    }

    // обычный абзац: до пустой строки или начала другого блока
    const para = [];
    while (i < lines.length && lines[i].trim() && !isList(lines[i])
      && !HEADING.test(lines[i]) && !QUOTE.test(lines[i]) && !FENCE.test(lines[i]) && !RULE.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
  }

  return out.join('');
}

window.md = { render, inline, esc };
