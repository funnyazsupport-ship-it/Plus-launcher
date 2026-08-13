'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { dirs } = require('./paths');
const { getJSON, download, exists } = require('./net');
const versions = require('./versions');
const java = require('./java');

const FABRIC = 'https://meta.fabricmc.net/v2';
const QUILT = 'https://meta.quiltmc.org/v3';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const FORGE_META = 'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json';
const NEO_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
const NEO_API = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';

// ---------- список доступных версий загрузчика для конкретной версии игры ----------

async function listFabric(mc) {
  const list = await getJSON(`${FABRIC}/versions/loader/${encodeURIComponent(mc)}`);
  return list.map((l) => ({ version: l.loader.version, stable: l.loader.stable }));
}

async function listQuilt(mc) {
  const list = await getJSON(`${QUILT}/versions/loader/${encodeURIComponent(mc)}`);
  return list.map((l) => ({ version: l.loader.version, stable: !/beta|pre|rc/i.test(l.loader.version) }));
}

async function listForge(mc) {
  const meta = await getJSON(FORGE_META);
  const all = meta[mc] || [];
  return all.slice().reverse().map((v) => ({ version: v, stable: true }));
}

/**
 * Версия NeoForge -> версия игры.
 * Старая схема: 21.1.x -> 1.21.1, 20.0.x -> 1.20
 * Новая схема (с 26.x): 26.2.x -> 26.2 / 26.2.1
 */
function neoMatches(neoVersion, mc) {
  const m = neoVersion.match(/^(\d+)\.(\d+)\./);
  if (!m) return false;
  const [, a, b] = m;
  if (mc === `1.${a}.${b}`) return true;
  if (b === '0' && mc === `1.${a}`) return true;
  if (mc === `${a}.${b}` || mc.startsWith(`${a}.${b}.`)) return true;
  return false;
}

async function listNeoForge(mc) {
  const data = await getJSON(NEO_API);
  const all = (data.versions || []).filter((v) => neoMatches(v, mc));
  return all.slice().reverse().map((v) => ({ version: v, stable: !/beta/i.test(v) }));
}

async function list(loader, mc) {
  try {
    if (loader === 'fabric') return await listFabric(mc);
    if (loader === 'quilt') return await listQuilt(mc);
    if (loader === 'forge') return await listForge(mc);
    if (loader === 'neoforge') return await listNeoForge(mc);
  } catch (e) {
    return [];
  }
  return [];
}

/** Итоговый id версии, который появится в versions/ */
function profileId(loader, mc, loaderVersion) {
  if (loader === 'fabric') return `fabric-loader-${loaderVersion}-${mc}`;
  if (loader === 'quilt') return `quilt-loader-${loaderVersion}-${mc}`;
  if (loader === 'forge') return null;      // задаётся установщиком
  if (loader === 'neoforge') return `neoforge-${loaderVersion}`;
  return mc;
}

// ---------- установка ----------

async function installMetaProfile(url, id) {
  const json = await getJSON(url);
  const realId = json.id || id;
  const dir = versions.versionDir(realId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `${realId}.json`), JSON.stringify(json, null, 2));
  return realId;
}

/** Запускает официальный установщик Forge/NeoForge в headless-режиме */
async function runInstaller(url, mc, onProgress) {
  const jar = path.join(dirs.cache, path.basename(new URL(url).pathname));
  onProgress({ stage: 'Загрузка установщика', percent: 10 });
  await download(url, jar);

  // установщику Forge нужен launcher_profiles.json в корне
  const profiles = path.join(dirs.root, 'launcher_profiles.json');
  if (!(await exists(profiles))) {
    await fsp.writeFile(profiles, JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2));
  }

  onProgress({ stage: 'Подготовка Java для установщика', percent: 20 });
  const javaPath = await java.ensure(Math.max(17, java.requiredMajor({ id: mc })), '', onProgress);

  onProgress({ stage: 'Установка загрузчика (это займёт минуту)', percent: 35 });
  const before = new Set(fs.existsSync(dirs.versions) ? fs.readdirSync(dirs.versions) : []);
  await new Promise((resolve, reject) => {
    // cwd = logs: установщик кладёт рядом с собой <installer>.jar.log, в корне он не нужен
    const p = spawn(javaPath, ['-jar', jar, '--installClient', dirs.root], { cwd: dirs.logs, windowsHide: true });
    let log = '';
    p.stdout.on('data', (d) => {
      log += d;
      const line = String(d).trim().split('\n').pop();
      if (line) onProgress({ stage: 'Установка загрузчика', percent: 55, detail: line.slice(0, 90) });
    });
    p.stderr.on('data', (d) => { log += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Установщик завершился с кодом ${code}\n${log.slice(-800)}`))));
  });

  const after = fs.readdirSync(dirs.versions);
  const created = after.filter((d) => !before.has(d));
  const id = created.find((d) => /forge/i.test(d)) || created[0];
  if (!id) throw new Error('Установщик не создал профиль версии');
  return id;
}

/**
 * Устанавливает игру + загрузчик. Возвращает id версии для запуска.
 * loader: vanilla | fabric | quilt | forge | neoforge
 */
async function install(loader, mc, loaderVersion, onProgress = () => {}) {
  if (!loader || loader === 'vanilla') {
    await versions.install(mc, onProgress);
    return mc;
  }

  onProgress({ stage: 'Установка базовой версии Minecraft', percent: 2 });
  await versions.install(mc, (p) => onProgress({ ...p, percent: Math.round(p.percent * 0.5) }));

  let id;
  if (loader === 'fabric') {
    onProgress({ stage: 'Установка Fabric Loader', percent: 55 });
    id = await installMetaProfile(`${FABRIC}/versions/loader/${encodeURIComponent(mc)}/${loaderVersion}/profile/json`,
      profileId('fabric', mc, loaderVersion));
  } else if (loader === 'quilt') {
    onProgress({ stage: 'Установка Quilt Loader', percent: 55 });
    id = await installMetaProfile(`${QUILT}/versions/loader/${encodeURIComponent(mc)}/${loaderVersion}/profile/json`,
      profileId('quilt', mc, loaderVersion));
  } else if (loader === 'forge') {
    id = await runInstaller(`${FORGE_MAVEN}/${loaderVersion}/forge-${loaderVersion}-installer.jar`, mc,
      (p) => onProgress({ ...p, percent: 50 + Math.round(p.percent * 0.3) }));
  } else if (loader === 'neoforge') {
    id = await runInstaller(`${NEO_MAVEN}/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`, mc,
      (p) => onProgress({ ...p, percent: 50 + Math.round(p.percent * 0.3) }));
  } else {
    throw new Error(`Неизвестный загрузчик: ${loader}`);
  }

  onProgress({ stage: 'Загрузка библиотек загрузчика', percent: 85 });
  await versions.install(id, (p) => onProgress({ ...p, percent: 85 + Math.round(p.percent * 0.15) }));
  return id;
}

module.exports = { list, install, profileId, neoMatches };
