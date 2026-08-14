'use strict';
/*
 * Создаёт src/main/lib/embedded-key.js из переменных окружения.
 *
 * Сам ключевой файл лежит в .gitignore, поэтому сборка на чужой машине
 * (например, в GitHub Actions) осталась бы без ключей: пропал бы помощник
 * и поиск по CurseForge. Здесь ключи берутся из секретов и раскладываются
 * в тот же вид, что и на рабочем компьютере.
 *
 * Запуск:  CURSEFORGE_KEY=... DEEPSEEK_KEY=... node scripts/make-embedded-key.js
 *
 * Перемешивание — это защита от случайного взгляда в app.asar, а не от взлома:
 * ключ внутри программы на чужом компьютере скрыть полностью нельзя.
 */
const fs = require('fs');
const path = require('path');

const MASK = 0x5a;
const target = path.join(__dirname, '..', 'src', 'main', 'lib', 'embedded-key.js');

const mix = (text) => Buffer.from(Buffer.from(String(text), 'utf8').map((b) => b ^ MASK)).toString('base64');

const keys = {
  curseforge: process.env.CURSEFORGE_KEY || '',
  deepseek: process.env.DEEPSEEK_KEY || '',
};

const given = Object.entries(keys).filter(([, v]) => v);
if (!given.length) {
  // без ключей сборка тоже рабочая — просто без помощника и без CurseForge
  if (fs.existsSync(target)) {
    console.log('[key] переменных нет, оставляю уже существующий embedded-key.js');
    process.exit(0);
  }
  console.log('[key] ключей нет — собираю заглушку (помощник и CurseForge будут недоступны)');
}

const blobs = given.map(([name, value]) => `  ${name}: '${mix(value)}',`).join('\n');

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `'use strict';

/** Создан автоматически scripts/make-embedded-key.js — руками не правьте. */

const MASK = 0x${MASK.toString(16)};

const BLOBS = {
${blobs}
};

const unmix = (blob) => Buffer.from(Buffer.from(blob, 'base64').map((b) => b ^ MASK)).toString('utf8');

/** @param {'curseforge'|'deepseek'} name */
function embeddedKey(name = 'curseforge') {
  return BLOBS[name] ? unmix(BLOBS[name]) : '';
}

module.exports = embeddedKey;
module.exports.get = embeddedKey;
`, 'utf8');

// в лог пишем только имена ключей, никогда не значения
console.log(`[key] embedded-key.js создан, ключей внутри: ${given.map(([n]) => n).join(', ') || 'нет'}`);
