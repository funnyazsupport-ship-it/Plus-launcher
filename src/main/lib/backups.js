'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const { dirs, gameDir, folderName } = require('./paths');
const config = require('./config');

/**
 * Резервные копии миров.
 *
 * Мир теряется от одного повреждённого чанка или от мода, снесённого не вовремя,
 * и вернуть его неоткуда. Копии складываются рядом с игрой, вне папки сборки:
 * удаление сборки не должно уносить с собой сохранения.
 */
const root = () => path.join(dirs.root, 'backups');

const instanceById = (id) => {
  const inst = config.load().instances.find((i) => i.id === id);
  if (!inst) throw new Error('Сборка не найдена');
  return inst;
};

const savesDir = (inst) => path.join(gameDir(inst.folder || inst.mc || inst.id), 'saves');
const backupDir = (inst) => path.join(root(), folderName(inst.folder || inst.mc || inst.id));

/** 2026-08-15 в 21:04 -> 2026-08-15_21-04 */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

/**
 * Имя мира для имени файла. В отличие от folderName из paths.js кириллицу не трогаем:
 * там она вырезается целиком, и «Мой мир» с «Другой мир» стали бы одним и тем же файлом,
 * а вместе с ними перемешались бы и счётчики копий.
 */
const safeName = (name) => String(name || 'world')
  .replace(/[\\/:*?"<>|]/g, '-')          // запрещённые в именах файлов символы
  .replace(/[\s.]+$/, '')                 // Windows не хранит имена, кончающиеся точкой или пробелом
  .slice(0, 80) || 'world';

/** Миры сборки: имя, размер, когда последний раз играли */
async function worlds(instanceId) {
  const dir = savesDir(instanceById(instanceId));
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }

  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    // level.dat отличает мир от случайной папки
    if (!fs.existsSync(path.join(p, 'level.dat'))) continue;
    const st = await fsp.stat(p).catch(() => null);
    out.push({ name: e.name, path: p, changed: st ? st.mtimeMs : 0, size: await dirSize(p) });
  }
  return out.sort((a, b) => b.changed - a.changed);
}

async function dirSize(dir) {
  let total = 0;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) { try { total += (await fsp.stat(p)).size; } catch { /* исчез */ } }
  }
  return total;
}

/** Готовые копии этой сборки, свежие сверху */
async function list(instanceId) {
  const dir = backupDir(instanceById(instanceId));
  let files;
  try { files = await fsp.readdir(dir); } catch { return []; }

  const out = [];
  for (const f of files) {
    if (!f.endsWith('.zip')) continue;
    const st = await fsp.stat(path.join(dir, f)).catch(() => null);
    if (!st) continue;
    // имя вида «Мир_2026-08-15_21-04.zip»
    const m = f.replace(/\.zip$/, '').match(/^(.*)_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2})$/);
    out.push({
      file: f,
      path: path.join(dir, f),
      world: m ? m[1] : f.replace(/\.zip$/, ''),
      at: st.mtimeMs,
      size: st.size,
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

/**
 * Складывает мир в zip. Старые копии сверх keep удаляются — но только этого же мира,
 * чтобы копия одного мира не вытесняла копии другого.
 */
async function create(instanceId, worldName, { keep = 5 } = {}, onProgress = () => {}) {
  const inst = instanceById(instanceId);
  const src = path.join(savesDir(inst), worldName);
  if (!fs.existsSync(src)) throw new Error(`Мир «${worldName}» не найден`);

  const dir = backupDir(inst);
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${safeName(worldName)}_${stamp()}.zip`);

  onProgress({ stage: `Копирую мир «${worldName}»`, percent: 30 });
  const zip = new AdmZip();
  // мир кладём внутрь папки с его именем — так он распакуется сразу правильно
  zip.addLocalFolder(src, worldName);
  await new Promise((resolve, reject) => zip.writeZip(dest, (e) => (e ? reject(e) : resolve())));

  onProgress({ stage: 'Убираю старые копии', percent: 85 });
  const mine = (await list(instanceId)).filter((b) => b.world === safeName(worldName));
  for (const old of mine.slice(keep)) await fsp.unlink(old.path).catch(() => {});

  onProgress({ stage: 'Готово', percent: 100 });
  const st = await fsp.stat(dest);
  return { file: path.basename(dest), size: st.size, removed: Math.max(0, mine.length - keep) };
}

/**
 * Возвращает мир из копии. Текущая версия мира не стирается, а откладывается
 * в сторону: если распаковали не ту копию, вернуть всё обратно ещё можно.
 */
async function restore(instanceId, file, onProgress = () => {}) {
  const inst = instanceById(instanceId);
  const src = path.join(backupDir(inst), path.basename(file));
  if (!fs.existsSync(src)) throw new Error('Копия не найдена');

  const saves = savesDir(inst);
  await fsp.mkdir(saves, { recursive: true });

  onProgress({ stage: 'Читаю копию', percent: 20 });
  let zip;
  try { zip = new AdmZip(src); } catch { throw new Error('Файл копии повреждён'); }

  // какой мир внутри: имя верхней папки в архиве
  const first = zip.getEntries().find((e) => e.entryName.includes('/'));
  const world = first ? first.entryName.split('/')[0] : null;
  if (!world) throw new Error('В копии нет папки мира');

  const current = path.join(saves, world);
  let movedTo = null;
  if (fs.existsSync(current)) {
    movedTo = path.join(saves, `${world}_до-восстановления_${stamp()}`);
    onProgress({ stage: 'Откладываю текущий мир', percent: 45 });
    await fsp.rename(current, movedTo);
  }

  onProgress({ stage: `Распаковываю «${world}»`, percent: 70 });
  try {
    zip.extractAllTo(saves, true);
  } catch (e) {
    // не смогли распаковать — возвращаем отложенный мир на место
    if (movedTo) await fsp.rename(movedTo, current).catch(() => {});
    throw new Error(`Не удалось распаковать копию: ${e.message}`);
  }

  onProgress({ stage: 'Готово', percent: 100 });
  return { world, kept: movedTo ? path.basename(movedTo) : null };
}

async function remove(instanceId, file) {
  const src = path.join(backupDir(instanceById(instanceId)), path.basename(file));
  await fsp.unlink(src);
  return true;
}

/** Копии всех миров сборки — вызывается перед запуском игры, если включено */
async function backupAll(instanceId, { keep = 5 } = {}, onProgress = () => {}) {
  const all = await worlds(instanceId);
  const done = [];
  for (let i = 0; i < all.length; i++) {
    onProgress({ stage: `Копия миров: ${i + 1} из ${all.length}`, percent: Math.round((i / all.length) * 100) });
    try {
      done.push(await create(instanceId, all[i].name, { keep }));
    } catch { /* один мир не скопировался — остальные всё равно сохраним */ }
  }
  return { done: done.length, total: all.length };
}

const folder = (instanceId) => backupDir(instanceById(instanceId));

module.exports = { worlds, list, create, restore, remove, backupAll, folder, dirSize };
