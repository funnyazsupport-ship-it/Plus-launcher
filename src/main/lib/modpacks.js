'use strict';
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { postJSON, download, pool } = require('./net');
const { dirs } = require('./paths');
const mods = require('./mods');

/**
 * Установка готовых модпаков.
 *
 * Форматов два. Modrinth раздаёт .mrpack: внутри modrinth.index.json со списком
 * прямых ссылок. CurseForge раздаёт .zip с manifest.json, где вместо ссылок только
 * пары «id проекта / id файла» — ссылки приходится доспрашивать у их API.
 *
 * В обоих случаях рядом лежит папка overrides с конфигами, которую нужно положить
 * поверх игровой папки.
 */
const CURSEFORGE = 'https://api.curseforge.com/v1';

// classId CurseForge -> папка внутри игровой директории
const CF_FOLDER = { 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks', 6945: 'datapacks' };

// ключи зависимостей в modrinth.index.json -> наши загрузчики
const MR_LOADER = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', neoforge: 'neoforge', forge: 'forge' };

/**
 * Путь из манифеста внутрь игровой папки. Архив пришёл из интернета, поэтому
 * «../../» и абсолютные пути отбрасываем, а не пишем куда попало.
 */
function safeJoin(base, rel) {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || /^[a-zA-Z]:/.test(clean) || clean.split('/').includes('..')) return null;
  const root = path.resolve(base);
  const full = path.resolve(root, clean);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

// ---------------- Modrinth (.mrpack) ----------------

function parseModrinth(zip) {
  const idx = JSON.parse(zip.readAsText(zip.getEntry('modrinth.index.json')));
  const dep = idx.dependencies || {};
  let loader = 'vanilla';
  let loaderVersion = null;
  for (const [key, name] of Object.entries(MR_LOADER)) {
    if (dep[key]) { loader = name; loaderVersion = String(dep[key]); break; }
  }
  const files = (idx.files || [])
    // серверные моды клиенту не нужны и нередко ломают запуск
    .filter((f) => (f.env?.client || 'required') !== 'unsupported')
    .map((f) => ({
      path: f.path,
      url: (f.downloads || [])[0],
      sha1: f.hashes?.sha1 || null,
      size: f.fileSize || null,
    }))
    .filter((f) => f.path && f.url);

  return {
    source: 'modrinth',
    name: idx.name || '',
    packVersion: idx.versionId || '',
    mc: dep.minecraft || '',
    loader,
    loaderVersion,
    files,
    blocked: [],
    // client-overrides кладутся поверх overrides — так задумано форматом
    overrides: ['overrides', 'client-overrides'],
  };
}

// ---------------- CurseForge (.zip) ----------------

/** Разбирает id вида forge-47.2.0 / fabric-0.16.9 / neoforge-21.1.66 */
function parseCfLoader(id) {
  const m = String(id || '').match(/^(forge|neoforge|fabric|quilt)-(.+)$/i);
  return m ? { loader: m[1].toLowerCase(), loaderVersion: m[2] } : { loader: 'vanilla', loaderVersion: null };
}

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Доспрашивает у CurseForge ссылки на файлы и папку, в которую их класть */
async function resolveCurseForgeFiles(list, onProgress) {
  const fileIds = list.map((f) => f.fileID).filter(Boolean);
  const modIds = [...new Set(list.map((f) => f.projectID).filter(Boolean))];
  if (!fileIds.length) return { files: [], blocked: [] };

  const folderOf = new Map();
  const titleOf = new Map();
  for (const part of chunks(modIds, 200)) {
    const r = await postJSON(`${CURSEFORGE}/mods`, { modIds: part }, mods.cfHeaders()).catch(() => null);
    for (const m of r?.data || []) {
      folderOf.set(m.id, CF_FOLDER[m.classId] || 'mods');
      titleOf.set(m.id, m.name);
    }
  }

  const files = [];
  const blocked = [];
  let done = 0;
  for (const part of chunks(fileIds, 200)) {
    done += part.length;
    onProgress({ stage: `Состав модпака: ${Math.min(done, fileIds.length)} из ${fileIds.length}`, percent: 12 });
    const r = await postJSON(`${CURSEFORGE}/mods/files`, { fileIds: part }, mods.cfHeaders());
    for (const f of r.data || []) {
      // автор запретил раздачу вне сайта — CDN такой файл не отдаст
      if (!f.downloadUrl && f.isAvailable === false) {
        blocked.push(titleOf.get(f.modId) || f.fileName);
        continue;
      }
      files.push({
        path: `${folderOf.get(f.modId) || 'mods'}/${f.fileName}`,
        url: f.downloadUrl || mods.cfFallbackUrl(f.id, f.fileName),
        sha1: (f.hashes || []).find((h) => h.algo === 1)?.value || null,
        size: f.fileLength || null,
        title: titleOf.get(f.modId) || f.fileName,
      });
    }
  }
  return { files, blocked };
}

async function parseCurseForge(zip, onProgress) {
  const m = JSON.parse(zip.readAsText(zip.getEntry('manifest.json')));
  const primary = (m.minecraft?.modLoaders || []).find((l) => l.primary) || m.minecraft?.modLoaders?.[0];
  const { loader, loaderVersion } = parseCfLoader(primary?.id);
  const wanted = (m.files || []).filter((f) => f.required !== false);
  const { files, blocked } = await resolveCurseForgeFiles(wanted, onProgress);

  return {
    source: 'curseforge',
    name: m.name || '',
    packVersion: m.version || '',
    mc: m.minecraft?.version || '',
    loader,
    loaderVersion,
    files,
    blocked,
    overrides: [m.overrides || 'overrides'],
  };
}

// ---------------- чтение и установка ----------------

/** Скачивает архив модпака и разбирает его состав */
async function readPack({ source, projectId, versionId = null }, onProgress = () => {}) {
  const list = await mods.versionsFor(source, projectId);
  if (!list.length) throw new Error('У этого модпака нет файлов для загрузки');
  const ver = (versionId && list.find((v) => String(v.id) === String(versionId)))
    || list.find((v) => v.channel === 'release') || list[0];

  onProgress({ stage: `Загрузка ${ver.file.filename}`, percent: 4 });
  const file = path.join(dirs.cache, 'packs', ver.file.filename);
  await download(ver.file.url, file, { sha1: ver.file.hashes?.sha1, size: ver.file.size });

  onProgress({ stage: 'Читаю состав модпака', percent: 9 });
  let zip;
  try { zip = new AdmZip(file); } catch { throw new Error('Архив модпака повреждён — попробуйте другую версию'); }

  const isModrinth = Boolean(zip.getEntry('modrinth.index.json'));
  if (!isModrinth && !zip.getEntry('manifest.json')) {
    throw new Error('Это не модпак: в архиве нет ни modrinth.index.json, ни manifest.json');
  }
  const manifest = isModrinth ? parseModrinth(zip) : await parseCurseForge(zip, onProgress);
  if (!manifest.mc) throw new Error('В модпаке не указана версия Minecraft');

  return { zip, manifest, version: ver };
}

/** Раскладывает файлы модпака по игровой папке */
async function downloadFiles(files, gameDirPath, onProgress, base, span) {
  const skipped = [];
  if (!files.length) return skipped;
  let done = 0;
  await pool(files, 6, async (f) => {
    const dest = safeJoin(gameDirPath, f.path);
    done += 1;
    onProgress({
      stage: `Загрузка модов: ${done} из ${files.length}`,
      percent: base + Math.round((done / files.length) * span),
      detail: path.basename(f.path),
    });
    if (!dest) { skipped.push({ name: f.path, reason: 'подозрительный путь в манифесте' }); return; }
    try {
      await download(f.url, dest, { sha1: f.sha1, size: f.size });
    } catch (e) {
      // один недоступный мод не должен рушить установку всего пака
      skipped.push({ name: f.title || path.basename(f.path), reason: e.message });
    }
  });
  return skipped;
}

/** Конфиги и ресурсы из overrides — поверх игровой папки */
function applyOverrides(zip, names, gameDirPath) {
  let count = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    const dir = names.find((n) => n && name.startsWith(`${n}/`));
    if (!dir) continue;
    const dest = safeJoin(gameDirPath, name.slice(dir.length + 1));
    if (!dest) continue;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.getData());
      count += 1;
    } catch { /* один файл не записался — пак всё равно рабочий */ }
  }
  return count;
}

/** Ставит содержимое пака в готовую игровую папку */
async function applyPack(zip, manifest, gameDirPath, onProgress = () => {}, base = 60, span = 34) {
  const skipped = await downloadFiles(manifest.files, gameDirPath, onProgress, base, span);
  onProgress({ stage: 'Распаковка конфигов модпака', percent: base + span });
  const overrides = applyOverrides(zip, manifest.overrides, gameDirPath);
  onProgress({ stage: 'Готово', percent: 100 });
  return {
    installed: manifest.files.length - skipped.length,
    total: manifest.files.length,
    skipped,
    overrides,
    blocked: manifest.blocked || [],
  };
}

module.exports = { readPack, applyPack, safeJoin, parseCfLoader };
