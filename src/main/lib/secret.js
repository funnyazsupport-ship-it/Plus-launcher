'use strict';
const { app, safeStorage } = require('electron');

/**
 * Хранение секретов в config.json в зашифрованном виде.
 * Шифрует средствами системы (на Windows это DPAPI): расшифровать можно только
 * под той же учётной записью Windows, на другом компьютере файл бесполезен.
 */

function available() {
  try {
    return Boolean(app?.isReady?.() && safeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
}

/** @returns {string} строка вида "enc:<base64>" либо "plain:<base64>", если шифрование недоступно */
function encrypt(text) {
  if (!text) return '';
  if (!available()) return `plain:${Buffer.from(String(text), 'utf8').toString('base64')}`;
  try {
    return `enc:${safeStorage.encryptString(String(text)).toString('base64')}`;
  } catch {
    return `plain:${Buffer.from(String(text), 'utf8').toString('base64')}`;
  }
}

function decrypt(blob) {
  if (!blob) return '';
  const s = String(blob);
  if (s.startsWith('enc:')) {
    try { return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')); } catch { return ''; }
  }
  if (s.startsWith('plain:')) {
    try { return Buffer.from(s.slice(6), 'base64').toString('utf8'); } catch { return ''; }
  }
  return s;                      // старый формат — обычный текст
}

/** Был ли секрет сохранён в незашифрованном виде (нужно перешифровать) */
const isPlain = (blob) => Boolean(blob) && !String(blob).startsWith('enc:');

module.exports = { encrypt, decrypt, available, isPlain };
