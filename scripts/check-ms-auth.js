'use strict';
/*
 * Проверяет, разрешили ли нашему приложению вход по лицензии Microsoft.
 *
 * Зачем: вход упирается не в код лаунчера, а во внешнее разрешение. Пока
 * приложению не выдано предварительное согласие на XboxLive.signin, страница
 * Microsoft отвечает ошибкой 0x8004A977 ещё до того, как человек введёт пароль.
 * Скрипт ловит ровно этот момент — входить никуда не нужно.
 *
 * Запуск:  npm run check-ms
 */
const path = require('path');

const DEVICE_CODE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const LINK = 'https://www.microsoft.com/link';
const SCOPE = 'XboxLive.signin offline_access';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Приложение работающего лаунчера с открытым кодом — как образец «так должно быть».
// Нужно только для сравнения: если ошибка вылезет и у него, значит сломалась
// сама проверка или Microsoft поменяла страницу, а не наше приложение.
const REFERENCE = { name: 'Prism Launcher', id: 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb' };

const NOT_ALLOWED = /8004A977|first party application/i;

function ourClientId() {
  try {
    return require(path.join(__dirname, '..', 'src', 'main', 'lib', 'app-config.js')).msClientId;
  } catch {
    return null;
  }
}

/** @returns {Promise<{ok: boolean, reason: string}>} */
async function check(clientId) {
  const r = await fetch(DEVICE_CODE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPE }).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, reason: d.error_description || d.error || `HTTP ${r.status}` };
  if (!d.user_code) return { ok: false, reason: 'Microsoft не выдала код' };

  // страницу открываем ровно так же, как её открыл бы браузер человека
  const page = await fetch(`${LINK}?otc=${encodeURIComponent(d.user_code)}`, { headers: { 'User-Agent': UA } });
  const html = await page.text();
  if (NOT_ALLOWED.test(html)) return { ok: false, reason: 'приложению не выдано разрешение XboxLive.signin' };
  return { ok: true, reason: 'страница согласия открывается' };
}

(async () => {
  const id = ourClientId();
  if (!id) {
    console.log('Не нашёл msClientId в src/main/lib/app-config.js');
    process.exit(2);
  }

  console.log(`Приложение лаунчера: ${id}\n`);

  const ours = await check(id).catch((e) => ({ ok: false, reason: e.message }));
  const ref = await check(REFERENCE.id).catch((e) => ({ ok: false, reason: e.message }));

  console.log(`наше приложение   : ${ours.ok ? 'РАЗРЕШЕНО' : 'не разрешено'} — ${ours.reason}`);
  console.log(`${REFERENCE.name.padEnd(18)}: ${ref.ok ? 'разрешено' : 'не разрешено'} — ${ref.reason}`);

  console.log();
  if (ours.ok) {
    console.log('Вход по лицензии Microsoft должен работать — проверьте его в лаунчере.');
  } else if (!ref.ok) {
    console.log('Образец тоже не проходит: похоже, Microsoft изменила страницу и проверку надо чинить,');
    console.log('а не приложение. Проверьте вход в лаунчере вручную.');
  } else {
    console.log('Разрешение ещё не выдано. Заявка на appID подаётся на aka.ms/mce-reviewappid,');
    console.log('после одобрения запустите проверку снова — она покажет РАЗРЕШЕНО.');
  }
  process.exit(ours.ok ? 0 : 1);
})();
