'use strict';

/**
 * Настройки уровня разработчика.
 *
 * Их правят здесь, в коде, и они не показываются пользователю в окне настроек.
 * Ничего секретного тут нет: Application ID Discord публичен по своей природе,
 * адрес репозитория тоже. Настоящий секрет — ключ CurseForge — лежит отдельно,
 * в embedded-key.js, которого нет в git.
 */
module.exports = {
  // Application ID из discord.com/developers/applications — от его имени показывается статус
  discordAppId: '1537371101242331226',

  // Ключ картинки из Rich Presence -> Art Assets. Пусто — статус без картинки:
  // Discord отвергает активность с несуществующим ключом.
  discordImage: '',

  // Репозиторий с релизами лаунчера, откуда приходят обновления.
  // Должен быть публичным: приватные релизы GitHub без токена не отдаёт.
  updateRepo: 'funnyazsupport-ship-it/Plus-launcher',

  // Azure client id для входа по Microsoft (вход по коду устройства).
  // Своё приложение: portal.azure.com -> Entra ID -> App registrations.
  // Прежний общеизвестный id официального лаунчера (00000000402b5328) Microsoft
  // отозвала — он отвечает AADSTS700016, поэтому годится только своё приложение.
  msClientId: 'fedcc289-f7c4-491e-9b38-004e27113133',

  // Адрес счётчика игроков на сайте. Пусто — лаунчер никуда не отмечается.
  // Скрипты лежат в docs/api и кладутся в public_html/api на хостинге.
  statsUrl: 'https://plus-launcher.fun/api',

  // Куда писать при проблемах. Показывается в настройках и в окне вылета.
  supportUrl: 'https://t.me/dowuto',
  supportName: '@dowuto',
  siteUrl: 'https://plus-launcher.fun',
};
