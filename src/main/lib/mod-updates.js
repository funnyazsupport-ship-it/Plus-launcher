'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { postJSON, download, sha1File, pool } = require('./net');
const config = require('./config');
const mods = require('./mods');

/**
 * Поиск обновлений для уже установленных модов.
 *
 * Лаунчер не хранит, откуда взялся каждый jar: файлы могли положить и руками.
 * Поэтому мод опознаётся по содержимому — оба каталога умеют искать по хешу файла.
 * Modrinth принимает обычный sha1, CurseForge — свой murmur2 по файлу без пробельных байтов.
 */
const MODRINTH = 'https://api.modrinth.com/v2';
const CURSEFORGE = 'https://api.curseforge.com/v1';

const cfHeaders = () => ({ 'x-api-key': config.curseforgeKey() });
const clean = (file) => file.replace(/\.disabled$/, '');

/** murmur2 в варианте CurseForge: сид 1, пробельные байты выброшены */
function murmur2(buf) {
  const data = buf.filter((b) => b !== 9 && b !== 10 && b !== 13 && b !== 32);
  const m = 0x5bd1e995;
  let len = data.length;
  let h = 1 ^ len;
  let i = 0;
  while (len >= 4) {
    let k = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
    k = Math.imul(k, m);
    k ^= k >>> 24;
    k = Math.imul(k, m);
    h = Math.imul(h, m) ^ k;
    i += 4;
    len -= 4;
  }
  if (len === 3) h ^= data[i + 2] << 16;
  if (len >= 2) h ^= data[i + 1] << 8;
  if (len >= 1) { h ^= data[i]; h = Math.imul(h, m); }
  h ^= h >>> 13;
  h = Math.imul(h, m);
  h ^= h >>> 15;
  return h >>> 0;
}

// Каналы выпуска по возрастанию стабильности. По умолчанию предлагаем только release:
// подсунуть alpha вместо рабочего релиза — верный способ сломать человеку сборку.
const CHANNELS = ['release', 'beta', 'alpha'];
const allowedChannels = (unstable) => (unstable ? CHANNELS : ['release']);

/** Новее ли кандидат установленного. Сравниваем даты выпуска, а не номера: они у всех свои. */
const isNewer = (candidate, currentDate) => {
  if (!currentDate) return true;             // дату установленного узнать не удалось
  const a = Date.parse(candidate);
  const b = Date.parse(currentDate);
  return Number.isNaN(a) || Number.isNaN(b) ? false : a > b;
};

/** Опознаёт файлы на Modrinth и сразу спрашивает свежую версию под сборку */
async function fromModrinth(files, { mc, loader, unstable }) {
  if (!files.length) return new Map();
  const hashes = files.map((f) => f.sha1);
  const body = { hashes, algorithm: 'sha1', game_versions: [mc], version_types: allowedChannels(unstable) };
  if (loader) body.loaders = [loader];

  // Два запроса: какой версией является файл сейчас и какая версия свежая.
  // Без первого нельзя понять, что «свежая» на самом деле старше установленной.
  const [now, next] = await Promise.all([
    postJSON(`${MODRINTH}/version_files`, { hashes, algorithm: 'sha1' }).catch(() => ({})),
    postJSON(`${MODRINTH}/version_files/update`, body).catch(() => ({})),
  ]);

  const out = new Map();
  for (const f of files) {
    const cur = now[f.sha1];
    const v = next[f.sha1];
    if (!cur && !v) continue;                 // мод Modrinth не знает — пусть попробует CurseForge

    const file = v && (v.files.find((x) => x.primary) || v.files[0]);
    const same = !file || file.hashes?.sha1 === f.sha1;
    out.set(f.file, {
      source: 'modrinth',
      projectId: (v || cur).project_id,
      versionId: v?.id,
      version: v?.version_number,
      channel: v?.version_type,
      current: cur?.version_number || null,
      // «свежо» — если это тот же файл либо кандидат вышел раньше установленного
      fresh: same || !isNewer(v.date_published, cur?.date_published),
      newFile: file && { name: file.filename, url: file.url, size: file.size, sha1: file.hashes?.sha1 },
    });
  }
  return out;
}

/** То же самое на CurseForge: сначала опознаём по отпечатку, потом берём свежий файл */
async function fromCurseForge(files, { mc, loader, unstable }) {
  if (!files.length || !config.curseforgeKey()) return new Map();
  const prints = files.map((f) => ({ ...f, print: murmur2(fs.readFileSync(f.path)) }));

  const data = await postJSON(`${CURSEFORGE}/fingerprints`,
    { fingerprints: prints.map((p) => p.print) }, cfHeaders()).catch(() => null);
  const matches = data?.data?.exactMatches || [];
  if (!matches.length) return new Map();

  const byPrint = new Map(matches.map((m) => [m.file?.fileFingerprint, m]));
  const ok = allowedChannels(unstable);
  const out = new Map();

  await pool(prints, 4, async (p) => {
    const match = byPrint.get(p.print);
    if (!match) return;
    const modId = match.id || match.file?.modId;
    const list = (await mods.versionsFor('curseforge', modId, mc, loader).catch(() => []))
      .filter((v) => ok.includes(v.channel));
    // самый свежий по дате: список приходит не всегда по порядку
    const latest = list.slice().sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0))[0];
    if (!latest) return;

    const curDate = match.file?.fileDate;
    out.set(p.file, {
      source: 'curseforge',
      projectId: modId,
      versionId: latest.id,
      version: latest.name || latest.versionNumber,
      channel: latest.channel,
      current: match.file?.displayName || null,
      fresh: String(latest.id) === String(match.file?.id) || !isNewer(latest.date, curDate),
      newFile: { name: latest.file.filename, url: latest.file.url, size: latest.file.size, sha1: latest.file.hashes?.sha1 },
    });
  });
  return out;
}

/**
 * Проверяет установленные моды сборки.
 * @returns {Promise<{items: Array, checked: number, unknown: string[]}>}
 */
async function check(instanceId, kind = 'mod', onProgress = () => {}, { unstable = false } = {}) {
  const inst = config.load().instances.find((i) => i.id === instanceId);
  if (!inst) throw new Error('Сборка не найдена');

  const installed = await mods.listInstalled(instanceId, kind);
  if (!installed.length) return { items: [], checked: 0, unknown: [] };

  onProgress({ stage: 'Считаю контрольные суммы модов', percent: 10 });
  const files = [];
  await pool(installed, 6, async (m) => {
    files.push({ file: m.file, path: m.path, enabled: m.enabled, sha1: await sha1File(m.path).catch(() => null) });
  });
  const usable = files.filter((f) => f.sha1);

  const ctx = { mc: inst.mc, loader: inst.loader !== 'vanilla' ? inst.loader : '', unstable };
  onProgress({ stage: 'Спрашиваю Modrinth', percent: 35 });
  const found = await fromModrinth(usable, ctx);

  // чего Modrinth не знает — ищем на CurseForge
  const rest = usable.filter((f) => !found.has(f.file));
  if (rest.length) {
    onProgress({ stage: 'Спрашиваю CurseForge', percent: 65 });
    for (const [k, v] of await fromCurseForge(rest, ctx)) found.set(k, v);
  }

  const items = [];
  const seen = new Set();
  for (const f of usable) {
    const info = found.get(f.file);
    if (!info || info.fresh || !info.newFile) continue;
    // Один и тот же мод может лежать в двух копиях (частая причина вылетов).
    // Показываем такое обновление один раз, иначе файл качался бы дважды.
    if (seen.has(info.newFile.name)) continue;
    seen.add(info.newFile.name);
    items.push({ file: f.file, name: clean(f.file), enabled: f.enabled, ...info });
  }
  onProgress({ stage: 'Готово', percent: 100 });
  return {
    items,
    checked: usable.length,
    unknown: usable.filter((f) => !found.has(f.file)).map((f) => clean(f.file)),
  };
}

/**
 * Ставит выбранные обновления: качает новый файл, убирает старый.
 * Выключенный мод остаётся выключенным.
 */
async function apply(instanceId, items = [], kind = 'mod', onProgress = () => {}) {
  const dir = mods.targetFolder(instanceId, kind);
  const done = [];
  const failed = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    onProgress({
      stage: `Обновление ${i + 1} из ${items.length}`,
      percent: Math.round((i / items.length) * 100),
      detail: it.newFile.name,
    });
    try {
      // выключенный мод должен остаться выключенным и после обновления
      const target = path.join(dir, it.enabled ? it.newFile.name : `${it.newFile.name}.disabled`);
      await download(it.newFile.url, target, { sha1: it.newFile.sha1, size: it.newFile.size });

      const old = path.join(dir, it.file);
      if (path.resolve(old) !== path.resolve(target)) await fsp.unlink(old).catch(() => {});
      done.push({ from: clean(it.file), to: it.newFile.name });
    } catch (e) {
      failed.push({ name: clean(it.file), reason: e.message });
    }
  }
  onProgress({ stage: 'Готово', percent: 100 });
  return { done, failed };
}

module.exports = { check, apply, murmur2 };
