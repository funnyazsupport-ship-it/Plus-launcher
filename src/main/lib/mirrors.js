'use strict';
const config = require('./config');

/**
 * Зеркала для файлов игры.
 *
 * Официальные CDN Mojang, Forge и Fabric из России часто отвечают рывками или
 * не отвечают вовсе — установка версии зависает на середине. BMCLAPI отдаёт те же
 * самые файлы и открыт без ограничений; им пользуются почти все сторонние лаунчеры.
 *
 * Подмена безопасна: библиотеки, ресурсы и jar-файлы игры мы всё равно сверяем
 * по sha1 из манифеста Mojang, поэтому изменённый файл просто не пройдёт проверку.
 */
const BMCL = 'https://bmclapi2.bangbang93.com';

// Порядок важен: правила проверяются сверху вниз, побеждает первое совпадение.
const RULES = [
  // манифест версий и метаданные — пути совпадают один в один
  { from: 'https://piston-meta.mojang.com/', to: `${BMCL}/` },
  { from: 'https://piston-data.mojang.com/', to: `${BMCL}/` },
  { from: 'https://launchermeta.mojang.com/', to: `${BMCL}/` },
  { from: 'https://launcher.mojang.com/', to: `${BMCL}/` },
  // ресурсы игры (звуки, языки) лежат под /assets
  { from: 'https://resources.download.minecraft.net/', to: `${BMCL}/assets/` },
  // библиотеки и мавены загрузчиков — под общим /maven
  { from: 'https://libraries.minecraft.net/', to: `${BMCL}/maven/` },
  { from: 'https://maven.minecraftforge.net/', to: `${BMCL}/maven/` },
  { from: 'https://maven.neoforged.net/releases/', to: `${BMCL}/maven/` },
  { from: 'https://maven.fabricmc.net/', to: `${BMCL}/maven/` },
  { from: 'https://meta.fabricmc.net/', to: `${BMCL}/fabric-meta/` },
];

/** Все адреса, по которым можно достать этот файл (без учёта режима и памяти) */
function alternatives(url) {
  const rule = RULES.find((r) => url.startsWith(r.from));
  if (!rule) return [];
  return [rule.to + url.slice(rule.from.length)];
}

// Какой источник для хоста реально ответил в этом запуске. Первый неудачный
// поход к Mojang стоит одного таймаута, дальше сразу идём туда, где всё работает.
const learned = new Map();
const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

/**
 * Список адресов в порядке попыток.
 * auto — сначала официальный источник, зеркало как запасной;
 * mirror — сразу зеркало (для тех, у кого Mojang не открывается вообще);
 * off — только официальный источник.
 */
function candidates(url) {
  const alt = alternatives(url);
  if (!alt.length) return [url];

  const mode = config.load().mirrors || 'auto';
  if (mode === 'off') return [url];

  const list = mode === 'mirror' ? [...alt, url] : [url, ...alt];

  // если в этом запуске уже выяснили, что работает — начинаем с него
  const good = learned.get(hostOf(url));
  if (good === 'mirror') return [...alt, url];
  if (good === 'direct') return [url, ...alt];
  return list;
}

/** Запоминает, какой источник ответил, чтобы больше не ждать таймаутов */
function worked(originalUrl, usedUrl) {
  if (!alternatives(originalUrl).length) return;
  learned.set(hostOf(originalUrl), usedUrl === originalUrl ? 'direct' : 'mirror');
}

/** Какой источник сейчас используется — для показа в настройках */
function stats() {
  const out = { direct: 0, mirror: 0, hosts: [] };
  for (const [host, kind] of learned) {
    out[kind] += 1;
    out.hosts.push({ host, kind });
  }
  return out;
}

const reset = () => learned.clear();

module.exports = { candidates, worked, alternatives, stats, reset, BMCL };
