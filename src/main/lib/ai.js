'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const rules = require('./crash-rules');

let embeddedKey = () => '';
try { embeddedKey = require('./embedded-key'); } catch { /* сборка без вшитых ключей */ }

const API = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';
const TIMEOUT_MS = 60000;
const MAX_LOG = 14000;          // столько символов лога отправляем максимум

/**
 * Общая база знаний про Minecraft. Подмешивается и в разбор вылетов, и в чат:
 * без неё модель путает версии Java, советует Optifine к Fabric и выдумывает моды.
 */
const MC_FACTS = `Факты про Minecraft, на которые опирайся (они точные):
— Java: 1.20.5 и новее — Java 21; 1.18–1.20.4 — Java 17; 1.17 — Java 16; 1.16.5 и старее — Java 8.
— Загрузчики: Fabric и Quilt совместимы между собой, Forge и NeoForge — отдельная ветка.
  Мод для Fabric НИКОГДА не заработает на Forge и наоборот. NeoForge — форк Forge с 1.20.1+.
— Fabric-модам почти всегда нужен Fabric API, Quilt-модам — QFAPI. Без него игра падает на старте.
— Оптимизация на Fabric: Sodium (графика), Lithium (логика), FerriteCore и ModernFix (память),
  Entity Culling, ImmediatelyFast. Шейдеры на Fabric — через Iris, он идёт с Sodium.
— Оптимизация на Forge/NeoForge: Embeddium (аналог Sodium), Oculus (шейдеры), Canary, FerriteCore.
— OptiFine несовместим с Fabric/Forge-сборками на модах; вместо него ставят Sodium+Iris или Embeddium+Oculus.
— Рецепты и предметы: JEI (Forge/NeoForge и Fabric), REI (чаще Fabric).
— Память: ваниль 2–3 ГБ, средние сборки 4–6 ГБ, тяжёлые 8–10 ГБ. Больше половины ОЗУ ставить вредно —
  сборщик мусора начинает тормозить сильнее, чем помогает лишняя память.
— Код выхода 1 обычно значит ошибку мода, 4294967295 (-1) — падение до старта игры (часто библиотеки),
  код 0 — игру закрыли штатно, это не вылет.`;

const LAUNCHER_FACTS = `Как устроен Plus Launcher. Названия вкладок и кнопок приводи ТОЧНО так, других в лаунчере нет:
— Слева панель вкладок: «Играть», «Версии», «Моды», «Скины», «Аккаунт», «Настройки», «Консоль», «Помощник».
— Внизу окна всегда видна большая кнопка «ИГРАТЬ» и полоса загрузки.
— «Играть» — карточки сборок. Клик по карточке выбирает сборку, на карточке значки настроек, папки и корзины.
  В «Настройках сборки» задаются своя память, своя Java и свои JVM-аргументы для одной сборки
  (пусто — берутся общие), а также резервные копии её миров.
— «Версии» — создание сборки: название, версия Minecraft, загрузчик (Fabric, Quilt, Forge, NeoForge)
  и кнопка «Установить».
— «Моды» — строка поиска сразу по Modrinth и CurseForge. Сверху выбираются сборка, тип
  (Моды / Ресурспаки / Шейдеры / Датапаки), источник и сортировка. У каждого найденного мода
  кнопки «Установить» и «Версии». Справа колонка «Установлено» — там мод можно выключить или удалить,
  и там же кнопка «Проверить обновления»: она находит моды, для которых вышли новые версии,
  и обновляет выбранные. По умолчанию предлагаются только релизы.
— «Скины» — библиотека скинов, загрузка на лицензию Microsoft и локальный скин для оффлайна.
  Есть «Скачать скин игрока»: по нику скин берётся с Mojang, а если ника там нет — с Ely.by.
— «Аккаунт» — вход через Ely.by (почта и пароль, поддерживается двухфакторный код)
  или локальный профиль без лицензии. Вход через Microsoft сейчас из интерфейса убран.
— «Настройки» — язык и тема (тёмная, светлая, как в системе), ползунок памяти, JVM-аргументы,
  выбор и кнопки скачивания Java, копирование миров перед запуском, папка лаунчера, Discord,
  обновления и раздел «Соединение и зеркала» с кнопкой «Проверить соединение»
  (нужен тем, у кого серверы Mojang открываются плохо — зеркало включается там же).
— «Консоль» — полный вывод игры, кнопки «Очистить» и «Завершить игру».
— У каждой сборки своя папка (mods, saves, config, resourcepacks, shaderpacks) — моды разных версий не смешиваются.
Не выдумывай кнопки «Добавить мод», «Запуск», «Обновить» и подобные — их нет.`;

const CRASH_SYSTEM = `Ты разбираешь вылеты Minecraft для игрока, который может ничего не знать про Java.
Отвечай по-русски, без markdown-заголовков и без вступлений вроде «конечно».

${MC_FACTS}

${LAUNCHER_FACTS}

Формат ответа строго такой:
1) Одно предложение — что случилось, простыми словами, без терминов.
2) «Причина:» — конкретный мод, библиотека или настройка. Называй имена ТОЛЬКО те, что есть в логе.
3) «Что делать:» — от одного до трёх пунктов, каждый начинается с действия и указывает вкладку лаунчера.

Правила: не выдумывай моды, которых нет в логе. Если лог не содержит внятной ошибки — так и скажи
и предложи прислать полный лог из вкладки «Консоль». Если лаунчер уже определил причину
(она придёт как «Лаунчер определил»), считай её верной и объясняй именно её.`;

const AGENT_SYSTEM = `Ты — встроенный помощник лаунчера «Plus Launcher». Ты хорошо разбираешься в Minecraft:
версии, моды, загрузчики, оптимизация, шейдеры, сервера, ошибки и железо.

Отвечай по-русски, дружелюбно и по делу. Коротко — когда вопрос простой; подробно и по шагам —
когда человек просит настроить или починить. Без markdown-заголовков и без таблиц,
списки — дефисами или цифрами.

${MC_FACTS}

${LAUNCHER_FACTS}

Как себя вести:
— Советуй моды только реально существующие, с точными названиями. Не уверен в названии — скажи об этом.
— Всегда учитывай версию и загрузчик текущей сборки: не предлагай Forge-мод к Fabric-сборке.
— Если человек описывает вылет или лаги, сначала уточни версию и загрузчик, если их нет в контексте.
— Ты не можешь сам нажимать кнопки и ставить моды — объясняй, куда нажать пользователю.
— Про вопросы не по Minecraft отвечай коротко и возвращайся к делу.`;

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
  const head = interesting.slice(0, 140).join('\n');
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

/** Разбирает ответ DeepSeek и переводит ошибки сервиса на человеческий язык */
async function ask(messages, { temperature = 0.3, maxTokens = 900, what = 'Сервис' } = {}) {
  const key = embeddedKey('deepseek');
  if (!key) throw new Error(`${what} недоступен: в сборке нет ключа`);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ac.signal,
      body: JSON.stringify({ model: MODEL, temperature, max_tokens: maxTokens, messages }),
    });
    const raw = await res.text();
    if (!res.ok) {
      // ключ в текст ошибки не попадает — наружу отдаём только суть
      if (res.status === 401) throw new Error(`${what}: ключ не принят`);
      if (res.status === 402) throw new Error(`${what}: на аккаунте закончились средства`);
      if (res.status === 429) throw new Error(`${what}: слишком много запросов, попробуйте через минуту`);
      throw new Error(`${what} ответил ошибкой ${res.status}`);
    }
    const text = JSON.parse(raw).choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error(`${what}: пустой ответ`);
    return text;
  } catch (e) {
    if (ac.signal.aborted) throw new Error(`${what} не ответил вовремя`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Объясняет, из-за чего вылетела игра.
 * Сначала лаунчер сам ищет известные причины, потом отдаёт их модели как проверенный факт.
 * Если DeepSeek недоступен, а причина известна — отвечаем без него.
 * @returns {Promise<{text: string, source: string, offline?: boolean, found?: string[]}>}
 */
async function explainCrash({ log = '', gameDir = '', instance = {}, exitCode = 1, mods = [] }) {
  const report = gameDir ? await readCrashReport(gameDir) : null;
  const full = `${report ? report.text : ''}\n${log}`;

  const found = rules.match(full);
  const exception = rules.topException(full);
  const needJava = rules.javaFor(instance.mc);

  const facts = [
    `Сборка: Minecraft ${instance.mc || '?'}, загрузчик ${instance.loader || 'без модов'}, нужна Java ${needJava}+.`,
    `Код выхода: ${exitCode}.`,
    mods.length ? `Модов включено: ${mods.length}. Список: ${mods.slice(0, 50).join(', ')}` : 'Моды не установлены.',
    exception ? `Первое исключение в логе: ${exception}` : '',
    found.length
      ? `Лаунчер определил причину: ${found.map((f) => f.title + (f.detail ? ` (${f.detail})` : '')).join('; ')}`
      : 'Лаунчер не смог определить причину по известным шаблонам.',
    report ? `\nОтчёт о падении (${report.name}):\n${anonymize(report.text)}` : '',
    `\nВывод игры:\n${squeezeLog(log)}`,
  ].filter(Boolean);

  try {
    const text = await ask([
      { role: 'system', content: CRASH_SYSTEM },
      { role: 'user', content: facts.join('\n') },
    ], { temperature: 0.2, maxTokens: 800, what: 'Разбор вылетов' });
    return { text, source: report ? `отчёт ${report.name}` : 'вывод игры', found: found.map((f) => f.id) };
  } catch (e) {
    // сервис недоступен, но причину мы и сами знаем — отдаём свой разбор
    const offline = rules.offlineAnswer(found, instance);
    if (offline) {
      return {
        text: `${offline}\n\n(Разбор сделан самим лаунчером: ${e.message.toLowerCase()}.)`,
        source: 'встроенный разбор',
        offline: true,
        found: found.map((f) => f.id),
      };
    }
    throw e;
  }
}

/**
 * Свободный разговор с помощником.
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 */
async function chat(messages, { context = '' } = {}) {
  const history = (messages || []).slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content).slice(0, 6000),
  }));

  const system = AGENT_SYSTEM + (context ? `\n\nЧто сейчас открыто в лаунчере:\n${context}` : '');
  const text = await ask([{ role: 'system', content: system }, ...history], {
    temperature: 0.5,
    maxTokens: 1200,
    what: 'Помощник',
  });
  return { text };
}

const available = () => Boolean(embeddedKey('deepseek'));

module.exports = { explainCrash, chat, available, anonymize, squeezeLog };
