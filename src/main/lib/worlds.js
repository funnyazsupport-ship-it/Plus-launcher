'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
// electron берём по требованию: разбор level.dat и обход папок к окнам
// отношения не имеют, и без этого модуль нельзя было бы проверить тестами
const electron = () => require('electron');
const { gameDir } = require('./paths');
const config = require('./config');
const nbt = require('./nbt');
const backups = require('./backups');

/**
 * Миры и скриншоты сборки.
 *
 * До этого файла миры можно было только скопировать: чтобы переименовать мир или
 * убрать лишний, приходилось лезть в папку игры руками. Здесь то же самое делается
 * из лаунчера, и перед удалением мир кладётся в резервную копию — вернуть его
 * потом можно тем же способом, что и любую другую копию.
 */

const instanceById = (id) => {
  const inst = config.load().instances.find((i) => i.id === id);
  if (!inst) throw new Error('Сборка не найдена');
  return inst;
};

const dirOf = (inst) => gameDir(inst.folder || inst.mc || inst.id);
const savesDir = (inst) => path.join(dirOf(inst), 'saves');
const shotsDir = (inst) => path.join(dirOf(inst), 'screenshots');

/** Имя папки внутри saves. Ни разделителей пути, ни выхода наверх. */
function safeFolder(name) {
  const s = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[\s.]+$/, '')                 // Windows не хранит имена, кончающиеся точкой
    .trim()
    .slice(0, 60);
  if (!s || s === '.' || s === '..') throw new Error('Такое имя не подойдёт');
  return s;
}

/** Путь внутри папки — проверка, что имя не увело нас в другое место */
function inside(dir, name) {
  const p = path.resolve(dir, name);
  const base = path.resolve(dir) + path.sep;
  if (!p.startsWith(base)) throw new Error('Недопустимое имя');
  return p;
}

// ---------------- level.dat ----------------

/** Читает level.dat: он всегда сжат gzip, но старые миры встречаются и без сжатия */
function readLevel(file) {
  const raw = fs.readFileSync(file);
  const buf = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
  return { root: nbt.parse(buf), gzip: raw[0] === 0x1f };
}

/** Название мира — то, что игра показывает в списке; имя папки может быть другим */
function levelName(dir) {
  try {
    const { root } = readLevel(path.join(dir, 'level.dat'));
    const name = root.value?.Data?.value?.LevelName;
    return name && typeof name.value === 'string' ? name.value : null;
  } catch {
    return null;
  }
}

/**
 * Меняет название мира в level.dat.
 * Перед записью файл собирается заново и тут же перечитывается: если что-то
 * потерялось при сборке, мы это увидим до того, как испортим настоящий файл.
 */
function setLevelName(dir, title) {
  const file = path.join(dir, 'level.dat');
  const { root, gzip } = readLevel(file);
  const data = root.value?.Data?.value;
  if (!data || !data.LevelName) throw new Error('В мире нет level.dat с названием');

  data.LevelName = { __type: nbt.TAG.STRING, value: title };
  const out = nbt.write(root);
  if (nbt.parse(out).value?.Data?.value?.LevelName?.value !== title) {
    throw new Error('Не удалось переписать level.dat');
  }

  // копия на случай, если игра не примет наш файл: вернуть можно вручную
  fs.copyFileSync(file, `${file}.plus-bak`);
  fs.writeFileSync(file, gzip ? zlib.gzipSync(out) : out);
}

// ---------------- миры ----------------

/** Миры сборки: папка, название из level.dat, размер, когда последний раз играли */
async function list(instanceId) {
  const inst = instanceById(instanceId);
  const dir = savesDir(inst);
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }

  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (!fs.existsSync(path.join(p, 'level.dat'))) continue;   // это не мир
    const st = await fsp.stat(p).catch(() => null);
    out.push({
      folder: e.name,
      name: levelName(p) || e.name,
      path: p,
      changed: st ? st.mtimeMs : 0,
      size: await backups.dirSize(p),
    });
  }
  return out.sort((a, b) => b.changed - a.changed);
}

/**
 * Переименование. Меняем и название в level.dat, и имя папки — иначе в списке
 * миров будет одно, а в резервных копиях другое.
 * @returns {{folder: string, name: string}} как мир зовётся после переименования
 */
async function rename(instanceId, folder, title) {
  const inst = instanceById(instanceId);
  const dir = inside(savesDir(inst), folder);
  if (!fs.existsSync(path.join(dir, 'level.dat'))) throw new Error('Мир не найден');

  const name = String(title || '').trim();
  if (!name) throw new Error('Название не может быть пустым');
  setLevelName(dir, name);

  // папку переименовываем, только если новое имя свободно: занятую не трогаем,
  // мир и так уже называется правильно
  const want = safeFolder(name);
  if (want === folder) return { folder, name };
  const dest = inside(savesDir(inst), want);
  if (fs.existsSync(dest)) return { folder, name };

  await fsp.rename(dir, dest);
  return { folder: want, name };
}

/**
 * Удаление мира. Сначала копия, потом уже стираем: мир — единственное, что
 * в лаунчере нельзя скачать заново.
 */
async function remove(instanceId, folder, onProgress = () => {}) {
  const inst = instanceById(instanceId);
  const dir = inside(savesDir(inst), folder);
  if (!fs.existsSync(path.join(dir, 'level.dat'))) throw new Error('Мир не найден');

  let backup;
  try {
    // keep берём с запасом: копия перед удалением не должна вытеснить сама себя
    backup = await backups.create(instanceId, folder, { keep: 50 }, onProgress);
  } catch {
    // копия не вышла (нет места, файл занят игрой) — тогда и удалять не будем
    throw new Error('Не получилось сделать копию мира, поэтому удалять его не стал');
  }
  await fsp.rm(dir, { recursive: true, force: true });
  return { backup: backup.file };
}

/** Открывает папку мира (или saves, если мир не назван) в проводнике */
function folder(instanceId, world) {
  const inst = instanceById(instanceId);
  const dir = world ? inside(savesDir(inst), world) : savesDir(inst);
  fs.mkdirSync(dir, { recursive: true });
  return electron().shell.openPath(dir);
}

// ---------------- скриншоты ----------------

const SHOT = /\.(png|jpe?g|webp)$/i;

/** Снимки сборки, новые сверху */
async function screenshots(instanceId) {
  const inst = instanceById(instanceId);
  const dir = shotsDir(inst);
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }

  const out = [];
  for (const e of entries) {
    if (!e.isFile() || !SHOT.test(e.name)) continue;
    const st = await fsp.stat(path.join(dir, e.name)).catch(() => null);
    if (!st) continue;
    out.push({ file: e.name, path: path.join(dir, e.name), at: st.mtimeMs, size: st.size });
  }
  return out.sort((a, b) => b.at - a.at);
}

/**
 * Уменьшенная копия снимка для списка.
 * Целиком кадр 1920×1080 — это несколько мегабайт, и десяток таких в интерфейсе
 * съел бы память впустую. Отдаём картинку шириной в 320 точек.
 */
function thumb(instanceId, file) {
  const inst = instanceById(instanceId);
  const p = inside(shotsDir(inst), file);
  const img = electron().nativeImage.createFromPath(p);
  if (img.isEmpty()) return null;
  return img.resize({ width: 320, quality: 'good' }).toDataURL();
}

/** Удаляет снимок в корзину: промахнуться мышью по нужному кадру слишком легко */
async function removeShot(instanceId, file) {
  const inst = instanceById(instanceId);
  const p = inside(shotsDir(inst), file);
  await electron().shell.trashItem(p).catch(() => fsp.rm(p, { force: true }));
  return true;
}

/** Открывает снимок в просмотрщике системы */
function openShot(instanceId, file) {
  const inst = instanceById(instanceId);
  return electron().shell.openPath(inside(shotsDir(inst), file));
}

/** Открывает папку со снимками */
function shotsFolder(instanceId) {
  const dir = shotsDir(instanceById(instanceId));
  fs.mkdirSync(dir, { recursive: true });
  return electron().shell.openPath(dir);
}

module.exports = {
  list, rename, remove, folder,
  screenshots, thumb, removeShot, openShot, shotsFolder,
  levelName, setLevelName, safeFolder,
};
