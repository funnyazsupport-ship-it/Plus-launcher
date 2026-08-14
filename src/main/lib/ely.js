'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { postJSON, getJSON, download } = require('./net');
const { dirs } = require('./paths');

/**
 * Вход через Ely.by — бесплатный сервис аккаунтов со своими скинами и плащами.
 *
 * Ely.by говорит по протоколу Yggdrasil (старый протокол Mojang), а чтобы игра
 * ходила за скинами и проверкой сессии на Ely.by, а не на серверы Mojang,
 * в JVM подключается агент authlib-injector — он подменяет адреса сервисов.
 *
 * Пароль нигде не сохраняется и никуда не пишется в лог: после входа остаются
 * только accessToken и clientToken. Хранятся они в config.json рядом с токенами
 * Microsoft, а при удалении профиля токен гасится и на стороне Ely.by.
 */
const AUTH = 'https://authserver.ely.by/auth';
const INJECTOR_API = 'https://authserver.ely.by/api/authlib-injector';
const LATEST = 'https://authlib-injector.yushi.moe/artifact/latest.json';

/** Постоянный идентификатор этого лаунчера на этом компьютере */
function clientToken() {
  const file = path.join(dirs.cache, 'ely-client-token');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* создадим ниже */ }
  const token = crypto.randomUUID();
  try { fs.writeFileSync(file, token, 'utf8'); } catch { /* работаем и без файла */ }
  return token;
}

const dashed = (id) => (String(id).includes('-')
  ? String(id)
  : String(id).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'));

/** Переводит ответы Ely.by на понятный язык */
function elyError(e) {
  const msg = e.data?.errorMessage || e.message || '';
  if (/two factor/i.test(msg)) {
    const err = new Error('Нужен код двухфакторной защиты');
    err.needTotp = true;
    return err;
  }
  if (/Invalid credentials|Invalid nickname or password/i.test(msg)) {
    return new Error('Неверный логин или пароль');
  }
  if (/banned|blocked/i.test(msg)) return new Error('Аккаунт заблокирован на Ely.by');
  if (/many/i.test(msg)) return new Error('Слишком много попыток входа — подождите пару минут');
  if (/accepted the rules|not activated/i.test(msg)) {
    return new Error('Аккаунт не подтверждён — проверьте почту на сайте Ely.by');
  }
  return new Error(msg || 'Ely.by не принял вход');
}

function toAccount(data) {
  const p = data.selectedProfile || {};
  return {
    type: 'ely',
    name: p.name,
    uuid: dashed(p.id),
    accessToken: data.accessToken,
    clientToken: data.clientToken,
    elyId: data.user?.id || null,
    // токен Ely.by живёт долго, но раз в двое суток проверяем и обновляем
    expiresAt: Date.now() + 2 * 24 * 3600 * 1000,
  };
}

/**
 * Вход по логину и паролю. Пароль используется один раз и не сохраняется.
 * @param {string} login почта или ник на Ely.by
 * @param {string} password пароль
 * @param {string} totp код из приложения, если включена двухфакторная защита
 */
async function login(login_, password, totp = '') {
  if (!login_ || !password) throw new Error('Введите логин и пароль Ely.by');
  // Ely.by ждёт двухфакторный код прямо в пароле через двоеточие
  const pass = totp ? `${password}:${String(totp).trim()}` : password;
  try {
    const data = await postJSON(`${AUTH}/authenticate`, {
      username: String(login_).trim(),
      password: pass,
      clientToken: clientToken(),
      requestUser: true,
    });
    if (!data.selectedProfile) throw new Error('На аккаунте Ely.by нет игрового профиля — создайте ник на сайте');
    return toAccount(data);
  } catch (e) {
    throw elyError(e);
  }
}

/** Продлевает сессию по сохранённому токену — пароль для этого не нужен */
async function refresh(account) {
  try {
    const data = await postJSON(`${AUTH}/refresh`, {
      accessToken: account.accessToken,
      clientToken: account.clientToken || clientToken(),
      requestUser: true,
    });
    return { ...account, ...toAccount(data) };
  } catch (e) {
    const err = elyError(e);
    err.needLogin = true;
    throw err;
  }
}

/** Жив ли токен. Ошибка сети не должна выглядеть как разлогин, поэтому отдельно. */
async function validate(account) {
  try {
    await postJSON(`${AUTH}/validate`, {
      accessToken: account.accessToken,
      clientToken: account.clientToken || clientToken(),
    });
    return true;
  } catch (e) {
    if (e.status === 403) return false;
    throw new Error('Не удалось проверить сессию Ely.by — нет связи с сервисом');
  }
}

/** Выход: гасим токен на стороне сервиса, чтобы он не остался рабочим */
async function logout(account) {
  try {
    await postJSON(`${AUTH}/invalidate`, {
      accessToken: account.accessToken,
      clientToken: account.clientToken || clientToken(),
    });
  } catch { /* токен всё равно удаляем локально */ }
  return true;
}

// ---------------- authlib-injector ----------------

const injectorPath = () => path.join(dirs.cache, 'authlib-injector.jar');

async function sha256(file) {
  const h = crypto.createHash('sha256');
  await new Promise((res, rej) => fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', res).on('error', rej));
  return h.digest('hex');
}

/**
 * Скачивает агент, который перенаправляет игру с серверов Mojang на Ely.by.
 * Без него вход есть, а скины и вход на сервера не работают.
 * @returns {Promise<string>} путь к jar
 */
async function ensureInjector(onProgress = () => {}) {
  const dest = injectorPath();
  const meta = await getJSON(LATEST).catch(() => null);

  if (fs.existsSync(dest)) {
    // файл на месте: если знаем ожидаемую сумму — сверяем, иначе доверяем
    if (!meta?.checksums?.sha256) return dest;
    if ((await sha256(dest).catch(() => '')) === meta.checksums.sha256) return dest;
  }
  if (!meta?.download_url) throw new Error('Не удалось получить authlib-injector — проверьте соединение');

  onProgress({ stage: 'Загрузка authlib-injector для Ely.by', percent: 40 });
  await download(meta.download_url, dest);

  const got = await sha256(dest).catch(() => '');
  if (meta.checksums?.sha256 && got !== meta.checksums.sha256) {
    await fsp.unlink(dest).catch(() => {});
    throw new Error('authlib-injector скачался повреждённым');
  }
  return dest;
}

/** JVM-аргументы для запуска с аккаунтом Ely.by */
async function jvmArgs(onProgress) {
  const jar = await ensureInjector(onProgress);
  return [`-javaagent:${jar}=${INJECTOR_API}`, '-Dauthlibinjector.side=client'];
}

module.exports = { login, refresh, validate, logout, ensureInjector, jvmArgs, clientToken, INJECTOR_API };
