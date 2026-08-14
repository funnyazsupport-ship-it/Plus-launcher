'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { dirs, defaultRoot, writePointer, readPointer } = require('./paths');

/** Размер каталога в байтах */
async function dirSize(dir) {
  let total = 0;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) {
      try { total += (await fsp.stat(p)).size; } catch { /* исчез — пропускаем */ }
    }
  }
  return total;
}

/**
 * Свободное место там, где лежит путь.
 * Спрашиваем про сам путь, а не про корень диска: на Linux и macOS домашняя папка
 * или выбранная папка часто оказываются на отдельном разделе, и корень покажет чужие цифры.
 * Если папки ещё нет — поднимаемся к ближайшей существующей.
 */
async function freeSpace(p) {
  let dir = path.resolve(p);
  for (let i = 0; i < 12; i++) {
    try {
      const st = await fsp.statfs(dir);
      return st.bsize * st.bavail;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
  return null;
}

function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Похоже ли, что в папке уже лежат данные лаунчера */
function looksLikeLauncherData(dir) {
  return ['versions', 'libraries', 'assets', 'config.json'].some((n) => fs.existsSync(path.join(dir, n)));
}

/**
 * Проверяет, годится ли папка под данные лаунчера.
 * @returns {{ target: string, hasData: boolean, empty: boolean }}
 */
async function validateTarget(newRoot) {
  const target = path.resolve(newRoot);
  const current = path.resolve(dirs.root);

  if (target === current) throw new Error('Это та же самая папка');
  if (isInside(target, current)) throw new Error('Нельзя выбрать папку внутри текущей папки лаунчера');
  if (isInside(current, target)) throw new Error('Нельзя выбрать папку, внутри которой лежит текущая папка лаунчера');

  await fsp.mkdir(target, { recursive: true });

  // проверяем, что туда действительно можно писать
  const probe = path.join(target, `.write-test-${Date.now()}`);
  try {
    await fsp.writeFile(probe, 'ok');
    await fsp.unlink(probe);
  } catch (e) {
    throw new Error(`В эту папку нельзя писать: ${e.message}`);
  }

  const entries = await fsp.readdir(target);
  return { target, hasData: looksLikeLauncherData(target), empty: entries.length === 0 };
}

/**
 * Переносит содержимое папки лаунчера. Внутри одного диска — мгновенное переименование,
 * между дисками — копирование с последующим удалением.
 */
async function moveData(from, to, onProgress = () => {}) {
  const entries = await fsp.readdir(from, { withFileTypes: true });
  await fsp.mkdir(to, { recursive: true });
  let done = 0;

  for (const e of entries) {
    const src = path.join(from, e.name);
    const dest = path.join(to, e.name);
    onProgress({ stage: `Перенос: ${e.name}`, percent: Math.round((done / entries.length) * 100) });
    try {
      await fsp.rename(src, dest);
    } catch (err) {
      if (err.code !== 'EXDEV' && err.code !== 'EPERM') throw err;
      // другой диск — копируем и удаляем исходник
      await fsp.cp(src, dest, { recursive: true, force: true, errorOnExist: false });
      await fsp.rm(src, { recursive: true, force: true });
    }
    done++;
  }
  onProgress({ stage: 'Перенос завершён', percent: 100 });

  // подчищаем опустевшую исходную папку
  try {
    if (!(await fsp.readdir(from)).length) await fsp.rmdir(from);
  } catch { /* не пустая или занята — оставляем как есть */ }
  return { moved: entries.length };
}

/** Сводка для интерфейса */
async function info() {
  const [size, free] = await Promise.all([dirSize(dirs.root), freeSpace(dirs.root)]);
  return {
    root: dirs.root,
    defaultRoot,
    isDefault: path.resolve(dirs.root) === path.resolve(defaultRoot),
    configured: Boolean(readPointer()),
    size,
    free,
  };
}

module.exports = { info, dirSize, freeSpace, validateTarget, moveData, writePointer, looksLikeLauncherData };
