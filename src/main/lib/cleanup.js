'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { dirs } = require('./paths');
const config = require('./config');
const versions = require('./versions');

/**
 * Уборка неиспользуемых файлов.
 *
 * Считаем не «что удалить», а «что нужно оставить»: собираем всё, на что ссылаются
 * версии живых сборок, а остальное предлагаем убрать. Ошибиться в другую сторону
 * нельзя — удалённая библиотека ломает рабочую сборку, а лишний файл просто занимает место.
 *
 * Если хоть одна нужная версия не читается, разделы библиотек и ресурсов пропускаются
 * целиком: неполный список нужного превратил бы уборку в порчу.
 */

/** Все версии, от которых зависят сборки, включая родительские через inheritsFrom */
async function keptVersions() {
  const cfg = config.load();
  const kept = new Set();
  const broken = [];

  for (const inst of cfg.instances) {
    let id = inst.versionId;
    // цепочка fabric-loader-... -> 1.21.4 может быть длиной больше одного шага
    for (let depth = 0; id && depth < 12; depth++) {
      if (kept.has(id)) break;
      kept.add(id);
      let json;
      try {
        json = JSON.parse(await fsp.readFile(versions.versionJsonPath(id), 'utf8'));
      } catch {
        broken.push(id);
        break;
      }
      id = json.inheritsFrom || null;
    }
  }
  return { kept, broken };
}

async function walk(dir, out = []) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

async function sizeOf(files) {
  let total = 0;
  for (const f of files) {
    try { total += (await fsp.stat(f)).size; } catch { /* исчез — не считаем */ }
  }
  return total;
}

async function dirSize(dir) {
  return sizeOf(await walk(dir));
}

/** Что нужно оставить: пути библиотек и id индексов ресурсов */
async function needed(kept) {
  const libs = new Set();
  const indexes = new Set();
  let failed = 0;

  for (const id of kept) {
    let v;
    try { v = await versions.resolve(id); } catch { failed += 1; continue; }
    if (v.assetIndex?.id) indexes.add(v.assetIndex.id);
    for (const lib of versions.dedupeLibraries(v.libraries || [])) {
      for (const a of versions.libArtifacts(lib)) libs.add(path.resolve(a.path));
    }
  }
  return { libs, indexes, failed };
}

/** Хеши объектов, на которые ссылаются оставляемые индексы ресурсов */
async function neededObjects(indexes) {
  const hashes = new Set();
  for (const id of indexes) {
    try {
      const j = JSON.parse(await fsp.readFile(path.join(dirs.assetIndexes, `${id}.json`), 'utf8'));
      for (const o of Object.values(j.objects || {})) if (o.hash) hashes.add(o.hash);
    } catch { /* индекс не читается — объекты этой версии трогать не будем */ }
  }
  return hashes;
}

/**
 * Что можно убрать. Ничего не удаляет — только считает.
 * @returns {Promise<{groups: Array, kept: number, warning: string|null}>}
 */
async function scan(onProgress = () => {}) {
  const groups = [];
  const { kept, broken } = await keptVersions();

  // --- версии, не нужные ни одной сборке ---
  onProgress({ stage: 'Смотрю версии', percent: 10 });
  let versionDirs = [];
  try { versionDirs = (await fsp.readdir(dirs.versions, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* нет папки */ }
  const staleVersions = versionDirs.filter((id) => !kept.has(id));

  if (staleVersions.length) {
    const files = [];
    for (const id of staleVersions) {
      files.push(...await walk(versions.versionDir(id)));
      files.push(...await walk(path.join(dirs.natives, id)));
    }
    groups.push({
      id: 'versions',
      name: 'Неиспользуемые версии игры',
      note: `${staleVersions.length} шт.: ${staleVersions.slice(0, 6).join(', ')}${staleVersions.length > 6 ? ' и другие' : ''}`,
      dirs: [
        ...staleVersions.map((id) => versions.versionDir(id)),
        ...staleVersions.map((id) => path.join(dirs.natives, id)),
      ],
      count: files.length,
      size: await sizeOf(files),
    });
  }

  // --- библиотеки и ресурсы: только если все нужные версии читаются ---
  onProgress({ stage: 'Считаю нужные библиотеки', percent: 35 });
  const { libs, indexes, failed } = await needed(kept);
  const safe = broken.length === 0 && failed === 0;

  if (safe) {
    const allLibs = await walk(dirs.libraries);
    const staleLibs = allLibs.filter((f) => !libs.has(path.resolve(f)));
    if (staleLibs.length) {
      groups.push({
        id: 'libraries',
        name: 'Библиотеки от удалённых версий',
        note: `${staleLibs.length} файлов, на которые не ссылается ни одна сборка`,
        files: staleLibs,
        count: staleLibs.length,
        size: await sizeOf(staleLibs),
      });
    }

    onProgress({ stage: 'Считаю ресурсы игры', percent: 60 });
    const hashes = await neededObjects(indexes);
    const allObjects = await walk(dirs.assetObjects);
    const staleObjects = allObjects.filter((f) => !hashes.has(path.basename(f)));
    // Индексы ресурсов лежат отдельно и весят мало, но без своей версии бесполезны
    let staleIndexes = [];
    try {
      staleIndexes = (await fsp.readdir(dirs.assetIndexes))
        .filter((f) => f.endsWith('.json') && !indexes.has(path.basename(f, '.json')))
        .map((f) => path.join(dirs.assetIndexes, f));
    } catch { /* нет папки */ }

    const staleAssets = [...staleObjects, ...staleIndexes];
    if (staleAssets.length) {
      groups.push({
        id: 'assets',
        name: 'Ресурсы игры от удалённых версий',
        note: `${staleObjects.length} звуков, языков и текстур, которые больше никому не нужны`,
        files: staleAssets,
        count: staleAssets.length,
        size: await sizeOf(staleAssets),
      });
    }
  }

  // --- кэш: установщики загрузчиков, архивы модпаков, скачанные пакеты ---
  onProgress({ stage: 'Смотрю кэш', percent: 85 });
  const cacheFiles = (await walk(dirs.cache))
    // токен Ely.by и агент — не мусор, их выбрасывать не надо
    .filter((f) => !/authlib-injector\.jar$|ely-client-token$/.test(f));
  if (cacheFiles.length) {
    groups.push({
      id: 'cache',
      name: 'Кэш загрузок',
      note: 'Установщики Forge и NeoForge, архивы модпаков. Скачаются заново, если понадобятся',
      files: cacheFiles,
      count: cacheFiles.length,
      size: await sizeOf(cacheFiles),
    });
  }

  onProgress({ stage: 'Готово', percent: 100 });
  const warning = safe ? null
    : `Библиотеки и ресурсы не проверялись: не удалось прочитать версии (${[...broken, ...(failed ? ['ещё ' + failed] : [])].slice(0, 4).join(', ')}). `
      + 'Запустите такую сборку — лаунчер починит её файлы, после этого уборка посчитает и их.';

  return { groups, kept: kept.size, warning };
}

/** Удаляет выбранные разделы. Возвращает, сколько освободилось. */
async function clean(ids = [], onProgress = () => {}) {
  const { groups } = await scan();
  const picked = groups.filter((g) => ids.includes(g.id));
  let freed = 0;
  let removed = 0;

  for (let i = 0; i < picked.length; i++) {
    const g = picked[i];
    onProgress({ stage: `Убираю: ${g.name}`, percent: Math.round((i / picked.length) * 100) });
    freed += g.size;

    for (const d of g.dirs || []) {
      await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
      removed += 1;
    }
    for (const f of g.files || []) {
      await fsp.unlink(f).catch(() => {});
      removed += 1;
    }
  }

  // после удаления файлов остаются пустые каталоги — подчищаем
  onProgress({ stage: 'Убираю пустые папки', percent: 95 });
  for (const base of [dirs.libraries, dirs.assetObjects, dirs.cache]) await dropEmpty(base);

  onProgress({ stage: 'Готово', percent: 100 });
  return { freed, removed, groups: picked.map((g) => g.name) };
}

/** Рекурсивно убирает опустевшие подкаталоги, сам base оставляет */
async function dropEmpty(base) {
  let entries;
  try { entries = await fsp.readdir(base, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(base, e.name);
    await dropEmpty(p);
    try {
      if (!(await fsp.readdir(p)).length) await fsp.rmdir(p);
    } catch { /* занят — оставляем */ }
  }
}

module.exports = { scan, clean, keptVersions, dirSize };
