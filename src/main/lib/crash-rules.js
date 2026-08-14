'use strict';

/**
 * Разбор типовых вылетов Minecraft прямо в лаунчере.
 *
 * Зачем: нейросеть без подсказки часто уводит в общие советы («переустановите игру»).
 * Здесь собраны причины, которые однозначно опознаются по логу — их мы находим сами
 * и передаём модели как проверенный факт. Заодно это работает без интернета:
 * если DeepSeek недоступен, пользователь всё равно получит ответ.
 */

// Какая Java нужна какой версии игры — самая частая причина «игра не стартует»
const JAVA_FOR = [
  { from: [1, 20, 5], java: 21 },
  { from: [1, 18, 0], java: 17 },
  { from: [1, 17, 0], java: 16 },
  { from: [0, 0, 0], java: 8 },
];

/** '1.20.4' -> [1, 20, 4] */
function parseMc(id) {
  const m = String(id || '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Минимальная версия Java для этой версии игры */
function javaFor(mc) {
  const v = parseMc(mc);
  if (!v) return 17;
  return (JAVA_FOR.find((r) => cmp(v, r.from) >= 0) || { java: 8 }).java;
}

/**
 * Правила: если в логе нашлось `test`, значит причина известна.
 * `extract` вытаскивает конкретику (имя мода, число) для точного ответа.
 */
const RULES = [
  {
    id: 'natives',
    test: /Failed to load a library|no lwjgl in java\.library\.path|UnsatisfiedLinkError.*lwjgl|lwjgl\.dll/i,
    title: 'Не распаковались нативные библиотеки LWJGL',
    fix: [
      'Нажмите «Играть» ещё раз — лаунчер переустановит библиотеки версии.',
      'Если не помогло, удалите папку natives в папке лаунчера и запустите снова.',
    ],
  },
  {
    id: 'oom',
    test: /java\.lang\.OutOfMemoryError|GC overhead limit exceeded|Ran out of memory/i,
    title: 'Игре не хватило оперативной памяти',
    fix: [
      'В «Настройках» поднимите максимум памяти (для сборок с модами — 4–8 ГБ).',
      'Не ставьте больше половины оперативки компьютера — станет только хуже.',
      'Уберите лишние моды или снизьте дальность прорисовки.',
    ],
  },
  {
    id: 'java-version',
    test: /UnsupportedClassVersionError|class file version (\d+)\.0|has been compiled by a more recent version of the Java/i,
    title: 'Версия Java не подходит этой версии игры',
    fix: [
      'В «Настройках» выберите другую Java или нажмите «Скачать» — лаунчер поставит нужную.',
    ],
    extract: (log) => {
      const m = log.match(/class file version (\d+)/);
      if (!m) return null;
      // 52 = Java 8, 61 = Java 17, 65 = Java 21
      return `мод собран под Java ${Number(m[1]) - 44}`;
    },
  },
  {
    id: 'fabric-api',
    test: /requires (?:any version of )?fabric(?:-api)?|Fabric API.*(?:missing|not installed)|net\.fabricmc\.fabric\.api/i,
    title: 'Модам нужен Fabric API, а его нет',
    fix: [
      'Во вкладке «Моды» найдите Fabric API и установите — лаунчер обычно ставит его сам.',
    ],
  },
  {
    id: 'missing-dep',
    test: /requires (?:version )?.* of .*, which is missing|Unmet dependency|Missing or unsupported mandatory dependencies|ModResolutionException/i,
    title: 'Моду не хватает другого мода',
    fix: [
      'Установите недостающие моды из списка ниже во вкладке «Моды».',
      'Проще всего — переустановить основной мод: зависимости подтянутся автоматически.',
    ],
    extract: (log) => {
      const names = new Set();
      const re = /requires (?:any version of |version [^ ]+ of )?([a-z0-9_\-]{3,}),? which is missing/gi;
      let m;
      while ((m = re.exec(log))) names.add(m[1]);
      return names.size ? `не хватает: ${[...names].slice(0, 8).join(', ')}` : null;
    },
  },
  {
    id: 'duplicate',
    test: /Duplicate mod|found duplicate mods|is present in multiple|DuplicateModsFoundException/i,
    title: 'Один и тот же мод стоит дважды',
    fix: [
      'В списке установленных модов справа найдите две версии одного мода и удалите старую.',
    ],
    extract: (log) => {
      const m = log.match(/Duplicate mods?:?\s*([^\n]{3,120})/i);
      return m ? `дубликат: ${m[1].trim()}` : null;
    },
  },
  {
    id: 'wrong-loader',
    test: /requires minecraft version|Incompatible mod set|is built for MC \d|does not support Minecraft|Mod .* requires .* forge/i,
    title: 'Мод собран под другую версию игры или другой загрузчик',
    fix: [
      'Проверьте, что моды скачаны именно под вашу версию Minecraft и ваш загрузчик.',
      'Лаунчер фильтрует каталог по сборке — ставьте моды через вкладку «Моды», а не вручную.',
    ],
  },
  {
    id: 'mixin',
    test: /Mixin apply failed|mixin\.injection\.throwables|InvalidInjectionException|MixinApplyError/i,
    title: 'Конфликт модов: не применился mixin',
    fix: [
      'Обычно виноват мод, отставший по версии, — обновите моды из лога.',
      'Отключайте моды по половине списка, пока не найдёте виновника.',
    ],
    extract: (log) => {
      const m = log.match(/Mixin apply(?:ing)? failed:? ([\w.\-]+)/i) || log.match(/from mod ([\w\-]+)/i);
      return m ? `сбой в моде ${m[1]}` : null;
    },
  },
  {
    id: 'gpu',
    test: /Pixel format not accelerated|EXCEPTION_ACCESS_VIOLATION.*(?:nvoglv|atio|ig\d)|Failed to create window|OpenGL 3\.2|GLFW error/i,
    title: 'Проблема с видеодрайвером или OpenGL',
    fix: [
      'Обновите драйвер видеокарты с сайта NVIDIA / AMD / Intel.',
      'Если стоят шейдеры — уберите их и проверьте запуск без них.',
    ],
  },
  {
    id: 'corrupt',
    test: /Invalid or corrupt jarfile|zip END header not found|Unable to read jar|error in opening zip file/i,
    title: 'Повреждён файл игры или мода',
    fix: [
      'Нажмите «Играть» — лаунчер перекачает битые файлы игры.',
      'Если ругается на мод, удалите его и поставьте заново.',
    ],
  },
  {
    id: 'world',
    test: /Exception generating new chunk|ChunkLoadingException|Failed to save chunk|world\/level\.dat/i,
    title: 'Сбой при загрузке мира',
    fix: [
      'Попробуйте зайти в другой мир — если он открывается, проблема в конкретном сохранении.',
      'Мод, который добавлял блоки в этот мир, удалять нельзя — верните его обратно.',
    ],
  },
];

/**
 * Ищет известные причины в логе.
 * @returns {Array<{id, title, fix: string[], detail: string|null}>}
 */
function match(log = '') {
  const text = String(log);
  const found = [];
  for (const r of RULES) {
    if (!r.test.test(text)) continue;
    found.push({
      id: r.id,
      title: r.title,
      fix: r.fix,
      detail: r.extract ? r.extract(text) : null,
    });
  }
  return found;
}

/** Первое исключение Java из лога — самая ценная строка для разбора */
function topException(log = '') {
  const m = String(log).match(/^.*?((?:[\w.$]+\.)?[\w$]*(?:Exception|Error|Throwable)(?::[^\n]{0,200})?)/m);
  return m ? m[1].trim() : null;
}

/** Готовый ответ без нейросети — на случай, когда сервис недоступен */
function offlineAnswer(found, { mc, loader } = {}) {
  if (!found.length) return null;
  const lines = [];
  for (const f of found.slice(0, 3)) {
    lines.push(`${f.title}${f.detail ? ` (${f.detail})` : ''}`);
    for (const step of f.fix) lines.push(`  — ${step}`);
  }
  if (mc) lines.push(`\nСборка: Minecraft ${mc}${loader && loader !== 'vanilla' ? ` · ${loader}` : ''}, нужна Java ${javaFor(mc)}+.`);
  return lines.join('\n');
}

module.exports = { match, topException, offlineAnswer, javaFor, parseMc, RULES };
