'use strict';
const { ping } = require('./net');
const { BMCL } = require('./mirrors');
const config = require('./config');

/**
 * Что проверяем и насколько это критично.
 *
 * need: 'game'  — без этого игра не установится и не запустится;
 *       'login' — нужно только для лицензионного входа Microsoft;
 *       'extra' — приятно иметь, но лаунчер работает и без него.
 *
 * mirror: адрес запасного источника. Если официальный недоступен, а зеркало живо,
 * лаунчер сам переключится и пользователю ничего делать не нужно.
 */
const SERVICES = [
  {
    id: 'mojang',
    name: 'Файлы Minecraft (Mojang)',
    url: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    mirror: `${BMCL}/mc/game/version_manifest_v2.json`,
    need: 'game',
  },
  {
    id: 'libraries',
    name: 'Библиотеки игры',
    url: 'https://libraries.minecraft.net/',
    mirror: `${BMCL}/maven/`,
    need: 'game',
  },
  {
    id: 'assets',
    name: 'Ресурсы игры (звуки, языки)',
    url: 'https://resources.download.minecraft.net/',
    mirror: `${BMCL}/assets/`,
    need: 'game',
  },
  {
    id: 'fabric',
    name: 'Fabric',
    url: 'https://meta.fabricmc.net/v2/versions/loader',
    mirror: `${BMCL}/fabric-meta/v2/versions/loader`,
    need: 'game',
  },
  {
    id: 'forge',
    name: 'Forge',
    url: 'https://maven.minecraftforge.net/',
    mirror: `${BMCL}/maven/`,
    need: 'game',
  },
  {
    id: 'modrinth',
    name: 'Каталог модов Modrinth',
    url: 'https://api.modrinth.com/v2/search?limit=1',
    need: 'extra',
  },
  {
    id: 'curseforge',
    name: 'Каталог модов CurseForge',
    url: 'https://api.curseforge.com/v1/games/432',
    need: 'extra',
    key: true,
  },
  {
    id: 'java',
    name: 'Загрузка Java (Adoptium)',
    url: 'https://api.adoptium.net/v3/info/available_releases',
    need: 'game',
  },
  {
    id: 'ms-login',
    name: 'Вход Microsoft',
    url: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
    need: 'login',
  },
  {
    id: 'mc-services',
    name: 'Профиль и скины Minecraft',
    url: 'https://api.minecraftservices.com/minecraft/profile',
    need: 'login',
  },
  {
    id: 'deepseek',
    name: 'Помощник и разбор вылетов',
    url: 'https://api.deepseek.com/',
    need: 'extra',
  },
  {
    id: 'updates',
    name: 'Обновления лаунчера (GitHub)',
    url: 'https://api.github.com/rate_limit',
    need: 'extra',
  },
];

/**
 * Проверяет всё разом и говорит, что делать.
 * @returns {Promise<{items: Array, verdict: string, advice: string[]}>}
 */
async function check() {
  const key = config.curseforgeKey();

  const items = await Promise.all(SERVICES.map(async (s) => {
    const headers = s.key && key ? { 'x-api-key': key } : {};
    const direct = await ping(s.url, { headers });
    const mirror = !direct.ok && s.mirror ? await ping(s.mirror) : null;
    return {
      id: s.id,
      name: s.name,
      need: s.need,
      direct,
      mirror,
      // сервис считается рабочим, если открыт он сам или его зеркало
      ok: direct.ok || Boolean(mirror?.ok),
      viaMirror: !direct.ok && Boolean(mirror?.ok),
    };
  }));

  const broken = items.filter((i) => !i.ok);
  const gameBroken = broken.filter((i) => i.need === 'game');
  const viaMirror = items.filter((i) => i.viaMirror);

  const advice = [];
  if (viaMirror.length) {
    advice.push(`Официальные серверы Mojang недоступны, но зеркало работает — лаунчер уже качает через него (${viaMirror.length} шт.). Ставить VPN не нужно.`);
  }
  if (gameBroken.length) {
    advice.push(`Не открывается: ${gameBroken.map((i) => i.name).join(', ')}. Проверьте интернет и антивирус — он умеет резать соединения лаунчера.`);
  }
  if (broken.some((i) => i.need === 'login')) {
    advice.push('Серверы входа Microsoft недоступны. Их подменить нельзя (это чужие пароли), поэтому вход по лицензии требует VPN. Играть по локальному аккаунту можно без него.');
  }
  if (broken.some((i) => i.id === 'curseforge')) {
    advice.push('CurseForge не отвечает. Моды всё равно ищутся — переключите источник на Modrinth во вкладке «Моды».');
  }
  if (!broken.length) advice.push('Все сервисы отвечают, VPN не нужен.');

  const verdict = gameBroken.length ? 'bad' : (broken.length || viaMirror.length ? 'warn' : 'good');
  return { items, verdict, advice, mode: config.load().mirrors || 'auto' };
}

module.exports = { check, SERVICES };
