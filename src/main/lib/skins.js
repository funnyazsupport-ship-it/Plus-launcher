'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { dirs, gameDir } = require('./paths');
const { UA } = require('./net');
const config = require('./config');
const mods = require('./mods');

const MC_API = 'https://api.minecraftservices.com/minecraft/profile';
// Мод, который показывает скины оффлайн-профилям (Modrinth: customskinloader)
const CSL_PROJECT = 'idMHQ4n2';

/** Размер PNG из заголовка IHDR — без сторонних библиотек */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function skinFile(name) {
  return path.join(dirs.skins, `${String(name).replace(/[^a-zA-Z0-9._ -]/g, '_')}.png`);
}

/** Библиотека скинов лаунчера: %APPDATA%\.plslauncher\skins */
async function list() {
  await fsp.mkdir(dirs.skins, { recursive: true });
  const files = (await fsp.readdir(dirs.skins)).filter((f) => f.toLowerCase().endsWith('.png'));
  const out = [];
  for (const f of files) {
    const p = path.join(dirs.skins, f);
    try {
      const buf = await fsp.readFile(p);
      const size = pngSize(buf) || { width: 0, height: 0 };
      out.push({
        name: path.basename(f, '.png'),
        file: p,
        ...size,
        variant: config.load().skinVariants?.[f] || 'classic',
        dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
      });
    } catch { /* битый файл — пропускаем */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Добавляет png в библиотеку. Принимает 64x64 и старый 64x32; HD — только для оффлайна. */
async function add(srcPath, name = null) {
  const buf = await fsp.readFile(srcPath);
  const size = pngSize(buf);
  if (!size) throw new Error('Это не PNG-файл');
  const ratioOk = size.width === size.height || size.width === size.height * 2;
  if (!ratioOk || size.width % 64 !== 0) {
    throw new Error(`Неподходящий размер ${size.width}x${size.height}. Нужен скин 64x64 (или старый 64x32).`);
  }
  await fsp.mkdir(dirs.skins, { recursive: true });
  const dest = skinFile(name || path.basename(srcPath, path.extname(srcPath)));
  await fsp.writeFile(dest, buf);
  return { name: path.basename(dest, '.png'), file: dest, ...size, dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
}

async function remove(file) {
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== path.resolve(dirs.skins)) throw new Error('Файл вне библиотеки скинов');
  await fsp.unlink(resolved);
  return true;
}

function rememberVariant(file, variant) {
  const cfg = config.load();
  const map = { ...(cfg.skinVariants || {}), [path.basename(file)]: variant };
  config.save({ skinVariants: map });
}

// ---------------- скачивание скинов по нику ----------------

const MOJANG_NAME = 'https://api.mojang.com/users/profiles/minecraft';
const MOJANG_PROFILE = 'https://sessionserver.mojang.com/session/minecraft/profile';
const ELY_SKIN = 'https://skinsystem.ely.by/skins';
const ELY_TEXTURES = 'https://skinsystem.ely.by/textures';

async function grab(url, headers = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    return await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ac.signal });
  } finally { clearTimeout(timer); }
}

/** Скин лицензионного аккаунта: ник -> UUID -> ссылка на текстуру */
async function fromMojang(nick) {
  const r = await grab(`${MOJANG_NAME}/${encodeURIComponent(nick)}`);
  if (r.status === 404 || r.status === 204) return null;      // такого ника нет
  if (!r.ok) throw new Error(`Mojang не ответил (HTTP ${r.status})`);
  const { id, name } = await r.json();

  const pr = await grab(`${MOJANG_PROFILE}/${id}`);
  if (!pr.ok) throw new Error(`Профиль Mojang недоступен (HTTP ${pr.status})`);
  const prof = await pr.json();

  const raw = prof.properties?.find((p) => p.name === 'textures')?.value;
  if (!raw) return null;
  const tex = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')).textures || {};
  if (!tex.SKIN?.url) return null;                            // стандартный Steve, скачивать нечего

  return {
    name,
    url: tex.SKIN.url,
    variant: tex.SKIN.metadata?.model === 'slim' ? 'slim' : 'classic',
    cape: tex.CAPE?.url || null,
    source: 'mojang',
  };
}

/** Скин аккаунта Ely.by — там свой сервис текстур */
async function fromEly(nick) {
  const meta = await grab(`${ELY_TEXTURES}/${encodeURIComponent(nick)}`).catch(() => null);
  let variant = 'classic';
  let url = `${ELY_SKIN}/${encodeURIComponent(nick)}.png`;
  if (meta?.ok) {
    const j = await meta.json().catch(() => null);
    if (j?.SKIN?.url) url = j.SKIN.url;
    if (j?.SKIN?.metadata?.model === 'slim') variant = 'slim';
  }
  const r = await grab(url);
  if (!r.ok) return null;
  if (!/image\/png/i.test(r.headers.get('content-type') || '')) return null;
  return { name: nick, url, variant, cape: null, source: 'ely' };
}

/**
 * Скачивает скин игрока по нику в библиотеку.
 * Сначала спрашиваем Mojang, потом Ely.by — ники там разные, и оба варианта живые.
 */
async function downloadByName(nick) {
  const clean = String(nick || '').trim();
  if (!clean) throw new Error('Введите ник игрока');
  if (!/^[A-Za-z0-9_.-]{1,25}$/.test(clean)) throw new Error('В нике есть недопустимые символы');

  let found = null;
  const errors = [];
  for (const step of [fromMojang, fromEly]) {
    try {
      found = await step(clean);
      if (found) break;
    } catch (e) { errors.push(e.message); }
  }
  if (!found) {
    throw new Error(errors.length
      ? `Не удалось получить скин: ${errors[0]}`
      : `Игрок «${clean}» не найден ни на Mojang, ни на Ely.by`);
  }

  const res = await grab(found.url);
  if (!res.ok) throw new Error(`Не удалось скачать скин (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const size = pngSize(buf);
  if (!size) throw new Error('Сервис вернул не PNG');

  await fsp.mkdir(dirs.skins, { recursive: true });
  const dest = skinFile(found.name);
  await fsp.writeFile(dest, buf);
  rememberVariant(dest, found.variant);

  return {
    name: path.basename(dest, '.png'),
    file: dest,
    ...size,
    variant: found.variant,
    source: found.source,
    hasCape: Boolean(found.cape),
    dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
  };
}

/** Скачивает скин, который сейчас стоит на аккаунте, — чтобы не потерять свой же */
async function downloadOwn(account) {
  if (account?.type === 'microsoft') {
    const p = await fetchProfile(account);
    if (!p.skinUrl) throw new Error('На аккаунте стоит стандартный скин — скачивать нечего');
    return downloadByName(p.name);
  }
  return downloadByName(account?.name);
}

// ---------------- лицензия Microsoft ----------------

/** Загружает скин на аккаунт Mojang. variant: classic | slim */
async function uploadMojang(account, file, variant = 'classic') {
  if (!account?.accessToken || account.type !== 'microsoft') {
    throw new Error('Загрузка на сервер доступна только для лицензии Microsoft');
  }
  const buf = await fsp.readFile(file);
  const size = pngSize(buf);
  if (!size || size.width !== 64 || (size.height !== 64 && size.height !== 32)) {
    throw new Error(`Mojang принимает только 64x64 или 64x32, а тут ${size?.width}x${size?.height}`);
  }
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([buf], { type: 'image/png' }), 'skin.png');

  const res = await fetch(`${MC_API}/skins`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.accessToken}`, 'User-Agent': UA },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Mojang отклонил скин (HTTP ${res.status}): ${text.slice(0, 200)}`);
  rememberVariant(file, variant);
  return JSON.parse(text || '{}');
}

/** Сбрасывает скин на стандартный (Steve/Alex) */
async function resetMojang(account) {
  const res = await fetch(`${MC_API}/skins/active`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${account.accessToken}`, 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`Не удалось сбросить скин (HTTP ${res.status})`);
  return true;
}

/** Включает/выключает плащ (capeId = null — спрятать) */
async function setCape(account, capeId) {
  const url = `${MC_API}/capes/active`;
  const res = await fetch(url, {
    method: capeId ? 'PUT' : 'DELETE',
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': UA,
    },
    body: capeId ? JSON.stringify({ capeId }) : undefined,
  });
  if (!res.ok) throw new Error(`Не удалось изменить плащ (HTTP ${res.status})`);
  return true;
}

/** Актуальный профиль с сервера: текущий скин и список плащей */
async function fetchProfile(account) {
  const res = await fetch(MC_API, { headers: { Authorization: `Bearer ${account.accessToken}`, 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Профиль недоступен (HTTP ${res.status})`);
  const p = await res.json();
  return {
    name: p.name,
    skinUrl: p.skins?.find((s) => s.state === 'ACTIVE')?.url || null,
    variant: (p.skins?.find((s) => s.state === 'ACTIVE')?.variant || 'CLASSIC').toLowerCase(),
    capes: (p.capes || []).map((c) => ({ id: c.id, alias: c.alias, url: c.url, active: c.state === 'ACTIVE' })),
  };
}

// ---------------- оффлайн-профиль ----------------

const CSL_CONFIG = (model) => ({
  version: 1,
  loadlist: [
    {
      name: 'LocalSkin',
      type: 'Legacy',
      checkPNG: true,
      model,
      skin: 'LocalSkin/skins/{USERNAME}.png',
      cape: 'LocalSkin/capes/{USERNAME}.png',
    },
    { name: 'Mojang', type: 'MojangAPI', apiRoot: 'https://api.mojang.com/', sessionRoot: 'https://sessionserver.mojang.com/' },
  ],
  enableDynamicSkull: true,
  enableTransparentSkin: true,
  forceLoadAllTextures: true,
  enableCacheAutoClean: true,
  cacheExpiry: 30,
  threadPoolSize: 8,
});

/**
 * Ставит скин оффлайн-профилю: кладёт png в CustomSkinLoader/LocalSkin/skins/<ник>.png
 * игровой папки версии. Возвращает, установлен ли сам мод.
 */
async function applyLocal({ instanceId, playerName, file, variant = 'classic' }) {
  const inst = config.load().instances.find((i) => i.id === instanceId);
  if (!inst) throw new Error('Сборка не найдена');
  const base = path.join(gameDir(inst.folder || inst.mc || inst.id), 'CustomSkinLoader');
  const skinDir = path.join(base, 'LocalSkin', 'skins');
  await fsp.mkdir(skinDir, { recursive: true });
  await fsp.mkdir(path.join(base, 'LocalSkin', 'capes'), { recursive: true });

  const dest = path.join(skinDir, `${playerName}.png`);
  await fsp.copyFile(file, dest);

  // конфиг мода трогаем только если его ещё нет — чужие настройки не перетираем
  const cfgFile = path.join(base, 'CustomSkinLoader.json');
  if (!fs.existsSync(cfgFile)) {
    await fsp.writeFile(cfgFile, JSON.stringify(CSL_CONFIG(variant === 'slim' ? 'slim' : 'default'), null, 2));
  }
  rememberVariant(file, variant);

  const installed = (await mods.listInstalled(instanceId, 'mod'))
    .some((m) => /customskinloader/i.test(m.file));
  return { dest, modInstalled: installed, loader: inst.loader, vanilla: inst.loader === 'vanilla' };
}

/** Ставит сам CustomSkinLoader в сборку */
async function installLoaderMod(instanceId, onProgress = () => {}) {
  const inst = config.load().instances.find((i) => i.id === instanceId);
  if (!inst) throw new Error('Сборка не найдена');
  if (inst.loader === 'vanilla') {
    throw new Error('Для скинов в оффлайне нужна сборка с загрузчиком (Fabric, Quilt, Forge или NeoForge)');
  }
  return mods.install({
    source: 'modrinth',
    projectId: CSL_PROJECT,
    mc: inst.mc,
    loader: inst.loader,
    kind: 'mod',
    instance: instanceId,
    withDeps: true,
  }, onProgress);
}

module.exports = {
  list, add, remove, pngSize, skinFile,
  uploadMojang, resetMojang, setCape, fetchProfile,
  applyLocal, installLoaderMod, CSL_PROJECT,
  downloadByName, downloadOwn,
};
