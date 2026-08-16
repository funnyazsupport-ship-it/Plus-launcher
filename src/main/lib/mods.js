'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { getJSON, download } = require('./net');
const { gameDir, dirs } = require('./paths');
const config = require('./config');

const MODRINTH = 'https://api.modrinth.com/v2';
const CURSEFORGE = 'https://api.curseforge.com/v1';

// classId CurseForge / project_type Modrinth
const KINDS = {
  mod: { cf: 6, mr: 'mod', folder: 'mods' },
  resourcepack: { cf: 12, mr: 'resourcepack', folder: 'resourcepacks' },
  shader: { cf: 6552, mr: 'shader', folder: 'shaderpacks' },
  modpack: { cf: 4471, mr: 'modpack', folder: 'modpacks' },
  datapack: { cf: 6945, mr: 'datapack', folder: 'datapacks' },
};

const CF_LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6, liteloader: 3, cauldron: 2 };

function cfHeaders() {
  return { 'x-api-key': config.curseforgeKey() };
}

// ---------------- Modrinth ----------------

async function searchModrinth({ query = '', kind = 'mod', mc = '', loader = '', limit = 30, offset = 0, sort = 'relevance' }) {
  const facets = [[`project_type:${KINDS[kind]?.mr || 'mod'}`]];
  if (mc) facets.push([`versions:${mc}`]);
  if (loader && kind === 'mod') facets.push([`categories:${loader}`]);
  const url = `${MODRINTH}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}`
    + `&limit=${limit}&offset=${offset}&index=${sort}`;
  const data = await getJSON(url);
  return {
    total: data.total_hits,
    hits: (data.hits || []).map((h) => ({
      source: 'modrinth',
      id: h.project_id,
      slug: h.slug,
      name: h.title,
      summary: h.description,
      icon: h.icon_url,
      downloads: h.downloads,
      author: h.author,
      categories: h.categories || [],
      updated: h.date_modified,
      versions: h.versions || [],
      url: `https://modrinth.com/${h.project_type}/${h.slug}`,
    })),
  };
}

async function modrinthVersions(projectId, mc = '', loader = '') {
  let url = `${MODRINTH}/project/${projectId}/version`;
  const q = [];
  if (mc) q.push(`game_versions=${encodeURIComponent(JSON.stringify([mc]))}`);
  if (loader) q.push(`loaders=${encodeURIComponent(JSON.stringify([loader]))}`);
  if (q.length) url += `?${q.join('&')}`;
  const list = await getJSON(url);
  return list.map((v) => ({
    source: 'modrinth',
    id: v.id,
    projectId: v.project_id,
    name: v.name,
    versionNumber: v.version_number,
    channel: v.version_type,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    date: v.date_published,
    downloads: v.downloads,
    dependencies: v.dependencies || [],
    file: (v.files.find((f) => f.primary) || v.files[0]),
  })).filter((v) => v.file);
}

// ---------------- CurseForge ----------------

async function searchCurseForge({ query = '', kind = 'mod', mc = '', loader = '', limit = 30, offset = 0, sort = 'relevance' }) {
  const sortField = { relevance: 1, downloads: 6, updated: 3, newest: 11, name: 4 }[sort === 'follows' ? 'downloads' : sort] || 2;
  const params = new URLSearchParams({
    gameId: '432',
    classId: String(KINDS[kind]?.cf || 6),
    searchFilter: query,
    sortField: String(sortField),
    sortOrder: 'desc',
    index: String(offset),
    pageSize: String(Math.min(limit, 50)),
  });
  if (mc) params.set('gameVersion', mc);
  if (loader && CF_LOADER[loader] && kind === 'mod') params.set('modLoaderType', String(CF_LOADER[loader]));
  const data = await getJSON(`${CURSEFORGE}/mods/search?${params}`, cfHeaders());
  return {
    total: data.pagination?.totalCount || 0,
    hits: (data.data || []).map((m) => ({
      source: 'curseforge',
      id: m.id,
      slug: m.slug,
      name: m.name,
      summary: m.summary,
      icon: m.logo?.thumbnailUrl || m.logo?.url,
      downloads: m.downloadCount,
      author: m.authors?.[0]?.name,
      categories: (m.categories || []).map((c) => c.slug),
      updated: m.dateModified,
      url: m.links?.websiteUrl,
      allowDistribution: m.allowModDistribution !== false,
    })),
  };
}

function cfFallbackUrl(fileId, fileName) {
  const id = String(fileId);
  return `https://edge.forgecdn.net/files/${id.slice(0, 4)}/${Number(id.slice(4))}/${encodeURIComponent(fileName)}`;
}

async function curseforgeVersions(modId, mc = '', loader = '') {
  const params = new URLSearchParams({ pageSize: '50' });
  if (mc) params.set('gameVersion', mc);
  if (loader && CF_LOADER[loader]) params.set('modLoaderType', String(CF_LOADER[loader]));
  const data = await getJSON(`${CURSEFORGE}/mods/${modId}/files?${params}`, cfHeaders());
  return (data.data || []).map((f) => ({
    source: 'curseforge',
    id: f.id,
    projectId: modId,
    name: f.displayName,
    versionNumber: f.fileName,
    channel: { 1: 'release', 2: 'beta', 3: 'alpha' }[f.releaseType] || 'release',
    gameVersions: (f.gameVersions || []).filter((g) => /^\d/.test(g)),
    loaders: (f.gameVersions || []).filter((g) => !/^\d/.test(g)).map((g) => g.toLowerCase()),
    date: f.fileDate,
    downloads: f.downloadCount,
    dependencies: (f.dependencies || []).filter((d) => d.relationType === 3).map((d) => ({ project_id: d.modId, dependency_type: 'required' })),
    file: {
      filename: f.fileName,
      url: f.downloadUrl || cfFallbackUrl(f.id, f.fileName),
      size: f.fileLength,
      hashes: { sha1: (f.hashes || []).find((h) => h.algo === 1)?.value },
    },
  }));
}

// ---------------- общий слой ----------------

async function search(opts) {
  const src = opts.source || 'both';
  const tasks = [];
  if (src === 'both' || src === 'modrinth') tasks.push(searchModrinth(opts).catch((e) => ({ total: 0, hits: [], error: e.message })));
  if (src === 'both' || src === 'curseforge') tasks.push(searchCurseForge(opts).catch((e) => ({ total: 0, hits: [], error: e.message })));
  const res = await Promise.all(tasks);
  const hits = [];
  const errors = res.map((r) => r.error).filter(Boolean);
  // чередуем результаты из обоих источников
  const max = Math.max(...res.map((r) => r.hits.length), 0);
  for (let i = 0; i < max; i++) for (const r of res) if (r.hits[i]) hits.push(r.hits[i]);
  return { hits, total: res.reduce((s, r) => s + (r.total || 0), 0), errors };
}

async function versionsFor(source, projectId, mc, loader) {
  return source === 'modrinth' ? modrinthVersions(projectId, mc, loader) : curseforgeVersions(projectId, mc, loader);
}

async function projectInfo(source, projectId) {
  if (source === 'modrinth') {
    const p = await getJSON(`${MODRINTH}/project/${projectId}`);
    return { name: p.title, description: p.body, icon: p.icon_url, url: `https://modrinth.com/mod/${p.slug}`, downloads: p.downloads };
  }
  const d = await getJSON(`${CURSEFORGE}/mods/${projectId}`, cfHeaders());
  const m = d.data;
  return { name: m.name, description: m.summary, icon: m.logo?.url, url: m.links?.websiteUrl, downloads: m.downloadCount };
}

/**
 * Папка для контента конкретной сборки.
 * instance — id сборки из config.json; папка берётся из её поля folder (имя версии, например 1.21.4).
 */
function targetFolder(instance, kind) {
  if (!instance) return path.join(dirs.root, KINDS[kind]?.folder || 'mods');
  const inst = config.load().instances.find((i) => i.id === instance);
  const base = gameDir(inst ? (inst.folder || inst.mc || inst.id) : instance);
  return path.join(base, KINDS[kind]?.folder || 'mods');
}

// Базовые API загрузчиков: без них не работает большинство модов,
// а CurseForge часто не указывает их в зависимостях файла.
const LOADER_API = {
  fabric: { project: 'P7dR8mSH', match: /fabric[-_]?api/i },          // Fabric API
  quilt: { project: 'qvIfYCYJ', match: /(quilted[-_]?fabric[-_]?api|qfapi)/i }, // QFAPI
};

/** Ставит Fabric API / QFAPI, если его ещё нет в папке модов */
async function ensureLoaderApi({ mc, loader, instance, kind }, onProgress) {
  const api = LOADER_API[loader];
  if (!api || kind !== 'mod' || !instance) return [];
  const dir = targetFolder(instance, kind);
  const present = (await listInstalled(instance, kind)).some((m) => api.match.test(m.file));
  if (present) return [];
  onProgress({ stage: `Установка ${loader === 'quilt' ? 'Quilted Fabric API' : 'Fabric API'}`, percent: 30 });
  const list = await modrinthVersions(api.project, mc, loader).catch(() => []);
  const ver = list.find((v) => v.channel === 'release') || list[0];
  if (!ver) return [];
  const dest = path.join(dir, ver.file.filename);
  await download(ver.file.url, dest, { sha1: ver.file.hashes?.sha1, size: ver.file.size });
  return [dest];
}

/**
 * Проверяет, не забыт ли Fabric API / QFAPI при том, что моды в папке есть.
 * Без него загрузчик падает ещё до запуска игры.
 * @returns {Promise<null | {loader: string, mc: string, title: string}>}
 */
async function missingLoaderApi(instanceId) {
  const inst = config.load().instances.find((i) => i.id === instanceId);
  if (!inst) return null;
  const api = LOADER_API[inst.loader];
  if (!api) return null;
  const list = await listInstalled(instanceId, 'mod');
  if (!list.some((m) => m.enabled)) return null;              // модов нет — и API не нужен
  if (list.some((m) => api.match.test(m.file))) return null;  // уже стоит
  return {
    loader: inst.loader,
    mc: inst.mc,
    title: inst.loader === 'quilt' ? 'Quilted Fabric API' : 'Fabric API',
    mods: list.filter((m) => m.enabled).length,
  };
}

/** Доставляет недостающий Fabric API / QFAPI в сборку */
async function installLoaderApi(instanceId, onProgress = () => {}) {
  const inst = config.load().instances.find((i) => i.id === instanceId);
  if (!inst) throw new Error('Сборка не найдена');
  const files = await ensureLoaderApi({ mc: inst.mc, loader: inst.loader, instance: instanceId, kind: 'mod' }, onProgress);
  if (!files.length) throw new Error(`Не нашёл подходящую версию API для ${inst.mc} / ${inst.loader}`);
  return { files };
}

/**
 * Установка мода (с зависимостями) в папку инстанса.
 * @returns {Promise<{files: string[]}>}
 */
async function install({ source, projectId, versionId = null, mc, loader, kind = 'mod', instance, withDeps = true },
  onProgress = () => {}, seen = new Set()) {
  const key = `${source}:${projectId}`;
  if (seen.has(key)) return { files: [] };
  seen.add(key);

  const list = await versionsFor(source, projectId, mc, loader);
  if (!list.length) throw new Error(`Нет версий для Minecraft ${mc}${loader ? ` / ${loader}` : ''}`);
  const ver = (versionId && list.find((v) => String(v.id) === String(versionId)))
    || list.find((v) => v.channel === 'release') || list[0];

  const dir = targetFolder(instance, kind);
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, ver.file.filename);

  onProgress({ stage: `Загрузка ${ver.file.filename}`, percent: 50 });
  await download(ver.file.url, dest, { sha1: ver.file.hashes?.sha1, size: ver.file.size });

  const files = [dest];
  if (withDeps && kind === 'mod' && seen.size === 1) {
    try {
      files.push(...await ensureLoaderApi({ mc, loader, instance, kind }, onProgress));
    } catch (e) { console.warn('[loader-api]', e.message); }
  }
  if (withDeps && kind === 'mod') {
    const deps = (ver.dependencies || []).filter((d) => d.dependency_type === 'required' && d.project_id);
    for (const d of deps) {
      try {
        onProgress({ stage: `Зависимость ${d.project_id}`, percent: 70 });
        const r = await install({ source, projectId: d.project_id, versionId: d.version_id, mc, loader, kind, instance, withDeps }, onProgress, seen);
        files.push(...r.files);
      } catch (e) {
        console.warn('[dep]', d.project_id, e.message);
      }
    }
  }
  onProgress({ stage: 'Готово', percent: 100 });
  return { files, version: ver };
}

/** Список установленных модов инстанса */
async function listInstalled(instance, kind = 'mod') {
  const dir = targetFolder(instance, kind);
  try {
    const files = await fsp.readdir(dir);
    return files.filter((f) => /\.(jar|zip)(\.disabled)?$/i.test(f)).map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, path: path.join(dir, f), size: st.size, enabled: !f.endsWith('.disabled') };
    });
  } catch { return []; }
}

async function toggle(instance, file, kind = 'mod') {
  const dir = targetFolder(instance, kind);
  const from = path.join(dir, file);
  const to = file.endsWith('.disabled') ? from.replace(/\.disabled$/, '') : `${from}.disabled`;
  await fsp.rename(from, to);
  return path.basename(to);
}

async function remove(instance, file, kind = 'mod') {
  await fsp.unlink(path.join(targetFolder(instance, kind), file));
  return true;
}

module.exports = {
  search, versionsFor, projectInfo, install, listInstalled, toggle, remove, targetFolder, KINDS,
  missingLoaderApi, installLoaderApi,
  // нужны установщику модпаков: он ходит в CurseForge своими запросами
  cfHeaders, cfFallbackUrl,
};
