'use strict';
const crypto = require('crypto');
const { postJSON, getJSON, UA } = require('./net');

const MS = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';
const XBL = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile';
const MC_ENTITLEMENTS = 'https://api.minecraftservices.com/entitlements/mcstore';

async function form(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error_description || data.error || `HTTP ${res.status}`);
    e.code = data.error;
    throw e;
  }
  return data;
}

/** Шаг 1: код для ввода на microsoft.com/link */
async function startDeviceCode(clientId) {
  const d = await form(`${MS}/devicecode`, { client_id: clientId, scope: SCOPE });
  const uri = d.verification_uri || 'https://www.microsoft.com/link';
  return {
    userCode: d.user_code,
    verificationUri: uri,
    /*
     * Адрес с уже вписанным кодом отдаёт сама Microsoft — и только если захочет.
     * Складывать его руками (`?otc=<код>`) нельзя: переадресация срабатывает,
     * но конечная страница отвечает ошибкой «users are not permitted to consent
     * to first party applications». Поэтому либо берём готовый адрес, либо
     * открываем обычную страницу и даём человеку вставить код.
     */
    verificationUriComplete: d.verification_uri_complete || null,
    deviceCode: d.device_code,
    interval: (d.interval || 5) * 1000,
    expiresIn: d.expires_in || 900,
  };
}

/** Шаг 2: ожидание подтверждения пользователем */
async function pollDeviceCode(clientId, deviceCode, interval, expiresIn, shouldCancel = () => false) {
  const deadline = Date.now() + expiresIn * 1000;
  let wait = interval;
  while (Date.now() < deadline) {
    if (shouldCancel()) throw new Error('Вход отменён');
    await new Promise((r) => setTimeout(r, wait));
    try {
      return await form(`${MS}/token`, {
        client_id: clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
      });
    } catch (e) {
      if (e.code === 'authorization_pending') continue;
      if (e.code === 'slow_down') { wait += 5000; continue; }
      throw e;
    }
  }
  throw new Error('Время ожидания входа истекло');
}

/** Цепочка Xbox Live -> XSTS -> Minecraft -> профиль */
async function xboxChain(msAccessToken) {
  const xbl = await postJSON(XBL, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  const uhs = xbl.DisplayClaims?.xui?.[0]?.uhs;

  let xsts;
  try {
    xsts = await postJSON(XSTS, {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    });
  } catch (e) {
    const x = e.data?.XErr;
    if (x === 2148916233) throw new Error('У этого Microsoft-аккаунта нет профиля Xbox. Создайте его на xbox.com и повторите вход.');
    if (x === 2148916238) throw new Error('Детский аккаунт: нужно добавить его в семью Microsoft.');
    if (x === 2148916235) throw new Error('Xbox Live недоступен в вашем регионе.');
    throw e;
  }

  let mc;
  try {
    mc = await postJSON(MC_LOGIN, { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` });
  } catch (e) {
    // Mojang не пускает приложения, не прошедшие у них проверку. Вход при этом
    // выглядит исправным до самого конца, поэтому объясняем прямо.
    if (e.status === 403 && /invalid app registration/i.test(JSON.stringify(e.data || ''))) {
      throw new Error('Mojang пока не одобрил это приложение — вход по лицензии Microsoft заработает после проверки. '
        + 'Пока пользуйтесь Ely.by или оффлайн-профилем.');
    }
    throw e;
  }

  const ent = await getJSON(MC_ENTITLEMENTS, { Authorization: `Bearer ${mc.access_token}` }).catch(() => ({ items: [] }));
  if (!(ent.items || []).length) {
    throw new Error('На этом аккаунте не куплена Minecraft: Java Edition.');
  }

  const profile = await getJSON(MC_PROFILE, { Authorization: `Bearer ${mc.access_token}` });
  return {
    type: 'microsoft',
    name: profile.name,
    uuid: profile.id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'),
    accessToken: mc.access_token,
    xuid: mc.username,
    skins: profile.skins || [],
    expiresAt: Date.now() + (mc.expires_in || 86400) * 1000,
  };
}

/** Полный вход по коду устройства */
async function loginMicrosoft(clientId, onCode, shouldCancel) {
  const dc = await startDeviceCode(clientId);
  onCode(dc);
  const token = await pollDeviceCode(clientId, dc.deviceCode, dc.interval, dc.expiresIn, shouldCancel);
  const account = await xboxChain(token.access_token);
  account.refreshToken = token.refresh_token;
  account.clientId = clientId;
  return account;
}

/** Обновление истёкшего токена по refresh_token */
async function refresh(clientId, refreshToken) {
  const token = await form(`${MS}/token`, {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SCOPE,
  });
  const account = await xboxChain(token.access_token);
  account.refreshToken = token.refresh_token || refreshToken;
  account.clientId = clientId;
  return account;
}

/** Оффлайн-аккаунт (для пиратских серверов / одиночной игры) */
function offlineAccount(name) {
  const clean = String(name || 'Player').trim().slice(0, 16).replace(/[^A-Za-z0-9_]/g, '') || 'Player';
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${clean}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return {
    type: 'offline',
    name: clean,
    uuid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    accessToken: '0',
    expiresAt: Infinity,
  };
}

module.exports = { loginMicrosoft, refresh, offlineAccount, startDeviceCode, pollDeviceCode, xboxChain };
