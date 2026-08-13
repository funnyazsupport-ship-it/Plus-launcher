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

  // Azure client id для входа по Microsoft (device code flow)
  msClientId: '00000000402b5328',
};
