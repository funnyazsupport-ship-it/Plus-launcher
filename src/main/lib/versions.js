'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const { dirs, osName, osArch } = require('./paths');
const { getJSON, download, pool, exists } = require('./net');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES = 'https://resources.download.minecraft.net';

const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

let manifestCache = null;

/** Полный список версий Mojang (release / snapshot / old_beta / old_alpha) */
async function manifest(force = false) {
  if (manifestCache && !force) return manifestCache;
  const cacheFile = path.join(dirs.cache, 'version_manifest_v2.json');
  try {
    manifestCache = await getJSON(MANIFEST);
    await fsp.writeFile(cacheFile, JSON.stringify(manifestCache));
  } catch (e) {
    if (await exists(cacheFile)) manifestCache = JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
    else throw e;
  }
  return manifestCache;
}

function versionDir(id) { return path.join(dirs.versions, id); }
function versionJsonPath(id) { return path.join(versionDir(id), `${id}.json`); }
function versionJarPath(id) { return path.join(versionDir(id), `${id}.jar`); }

/** Список локально установленных версий (включая профили загрузчиков) */
async function installed() {
  try {
    const names = await fsp.readdir(dirs.versions, { withFileTypes: true });
    const out = [];
    for (const d of names) {
      if (!d.isDirectory()) continue;
      if (await exists(versionJsonPath(d.name))) {
        const j = JSON.parse(await fsp.readFile(versionJsonPath(d.name), 'utf8'));
        out.push({ id: d.name, type: j.type || 'release', inheritsFrom: j.inheritsFrom || null, releaseTime: j.releaseTime });
      }
    }
    return out.sort((a, b) => String(b.releaseTime || '').localeCompare(String(a.releaseTime || '')));
  } catch { return []; }
}

/** Читает version.json локально; если нет — качает из манифеста */
async function fetchVersionJson(id) {
  const p = versionJsonPath(id);
  if (await exists(p)) return JSON.parse(await fsp.readFile(p, 'utf8'));
  const mf = await manifest();
  const entry = mf.versions.find((v) => v.id === id);
  if (!entry) throw new Error(`Версия ${id} не найдена в манифесте Mojang`);
  const json = await getJSON(entry.url);
  await fsp.mkdir(versionDir(id), { recursive: true });
  await fsp.writeFile(p, JSON.stringify(json, null, 2));
  return json;
}

/** Слияние профиля загрузчика с родительской версией (inheritsFrom) */
function mergeVersion(child, parent) {
  const merged = { ...parent, ...child };
  merged.libraries = dedupeLibraries([...(child.libraries || []), ...(parent.libraries || [])]);
  merged.id = child.id;
  merged.inheritsFrom = undefined;
  if (parent.arguments || child.arguments) {
    merged.arguments = {
      game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
    };
  }
  if (!child.mainClass) merged.mainClass = parent.mainClass;
  merged.downloads = parent.downloads || child.downloads;
  merged.assetIndex = parent.assetIndex || child.assetIndex;
  merged.assets = parent.assets || child.assets;
  merged.javaVersion = child.javaVersion || parent.javaVersion;
  // какой client.jar использовать (профили загрузчиков берут ванильный)
  merged.jar = child.jar || parent.jar || parent.id;
  if (child.minecraftArguments && !child.arguments) merged.minecraftArguments = child.minecraftArguments;
  return merged;
}

/** Разворачивает цепочку наследования в единый объект версии */
async function resolve(id, seen = new Set()) {
  if (seen.has(id)) throw new Error(`Циклическое наследование версий: ${id}`);
  seen.add(id);
  const json = await fetchVersionJson(id);
  if (!json.inheritsFrom) return json;
  const parent = await resolve(json.inheritsFrom, seen);
  return mergeVersion(json, parent);
}

// ---------- правила / библиотеки ----------

function matchRules(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const rule of rules) {
    let ok = true;
    if (rule.os) {
      if (rule.os.name && rule.os.name !== osName()) ok = false;
      if (rule.os.arch && rule.os.arch !== osArch() && !(rule.os.arch === 'x86' && osArch() === 'x86')) ok = false;
      if (rule.os.version && !new RegExp(rule.os.version).test(require('os').release())) ok = false;
    }
    if (ok && rule.features) {
      for (const [k, v] of Object.entries(rule.features)) if (Boolean(features[k]) !== Boolean(v)) ok = false;
    }
    if (ok) allowed = rule.action === 'allow';
  }
  return allowed;
}

/** group:artifact[:classifier] — по этому ключу библиотека считается одной и той же */
function libKey(name) {
  const parts = String(name || '').split('@')[0].split(':');
  return `${parts[0]}:${parts[1]}${parts[3] ? `:${parts[3]}` : ''}`;
}

function libVersion(name) {
  return String(name || '').split('@')[0].split(':')[2] || '0';
}

/**
 * Убирает дубли библиотек после склейки профиля загрузчика с ванильной версией.
 * Без этого на classpath попадают, например, asm 9.10.1 из Fabric и asm 9.6 из самой игры,
 * и загрузчик падает с "duplicate ASM classes found on classpath".
 *
 * Побеждает версия загрузчика: его библиотеки идут первыми в склеенном списке, они же
 * прописаны в его аргументах (-p у Forge/NeoForge), так что подменять их на ванильные нельзя.
 */
function dedupeLibraries(libs) {
  const kept = new Map();
  for (const lib of libs || []) {
    if (!lib?.name) continue;
    if (!matchRules(lib.rules)) continue;      // чужая ОС — сразу мимо
    const key = libKey(lib.name);
    const prev = kept.get(key);
    if (!prev) { kept.set(key, lib); continue; }
    if (libVersion(prev.name) !== libVersion(lib.name)) {
      console.log(`[libs] ${key}: беру ${libVersion(prev.name)}, отбрасываю ${libVersion(lib.name)}`);
    }
  }
  return [...kept.values()];
}

/** maven-координаты -> относительный путь (group/artifact/version/artifact-version[-classifier].ext) */
function mavenPath(name) {
  const [gav, ext = 'jar'] = name.split('@');
  const parts = gav.split(':');
  const [group, artifact, version] = parts;
  const classifier = parts[3];
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
  return path.join(...group.split('.'), artifact, version, file);
}

function nativeClassifier(lib) {
  if (!lib.natives) return null;
  const key = lib.natives[osName()];
  return key ? key.replace('${arch}', osArch() === 'x86' ? '32' : '64') : null;
}

/** Список артефактов библиотеки, подходящих для текущей ОС */
function libArtifacts(lib) {
  const out = [];
  if (!matchRules(lib.rules)) return out;
  const dl = lib.downloads || {};
  if (dl.artifact) {
    out.push({ kind: 'classpath', url: dl.artifact.url, sha1: dl.artifact.sha1, size: dl.artifact.size,
      path: path.join(dirs.libraries, dl.artifact.path || mavenPath(lib.name)) });
  } else if (lib.name && !lib.natives) {
    // библиотеки загрузчиков без downloads (Fabric/Forge) — собираем URL из maven-репозитория
    const rel = mavenPath(lib.name);
    const base = (lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/');
    out.push({ kind: 'classpath', url: base + rel.split(path.sep).join('/'), sha1: lib.checksums?.[0] || null,
      path: path.join(dirs.libraries, rel) });
  }
  const cls = nativeClassifier(lib);
  if (cls && dl.classifiers && dl.classifiers[cls]) {
    const n = dl.classifiers[cls];
    out.push({ kind: 'native', url: n.url, sha1: n.sha1, size: n.size, exclude: lib.extract?.exclude || [],
      path: path.join(dirs.libraries, n.path || mavenPath(`${lib.name}:${cls}`)) });
  }
  // Формат 1.19+: записи вида "org.lwjgl:lwjgl:3.3.1:natives-windows".
  // Такие jar-ы обязаны остаться в classpath (LWJGL грузит .dll прямо из них),
  // но мы дополнительно распаковываем их — так работает и старый, и новый формат.
  if (!cls && dl.artifact && /:natives-/.test(lib.name || '')) {
    const last = out[out.length - 1];
    out.push({ ...last, kind: 'native', exclude: lib.extract?.exclude || [] });
  }
  return out;
}

// ---------- установка ----------

async function extractNatives(files, targetDir) {
  await fsp.mkdir(targetDir, { recursive: true });
  for (const f of files) {
    let zip;
    try { zip = new AdmZip(f.path); } catch { continue; }
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const name = entry.entryName;
      if (name.startsWith('META-INF/')) continue;
      if ((f.exclude || []).some((ex) => name.startsWith(ex))) continue;
      if (!/\.(dll|so|dylib|jnilib)$/i.test(name)) continue;
      const dest = path.join(targetDir, path.basename(name));
      try { await fsp.writeFile(dest, entry.getData()); } catch {}
    }
  }
}

/**
 * Полная установка версии: json -> client.jar -> библиотеки -> нативы -> ассеты.
 * onProgress({stage, percent, detail})
 */
async function install(id, onProgress = () => {}) {
  onProgress({ stage: 'Получение метаданных версии', percent: 1 });
  const v = await resolve(id);

  // 1. client.jar
  const jarId = v.jar || v.inheritsFrom || v.id;
  const clientJarTarget = versionJarPath(jarId);
  if (v.downloads?.client) {
    onProgress({ stage: 'Загрузка клиента Minecraft', percent: 4 });
    await download(v.downloads.client.url, clientJarTarget, { sha1: v.downloads.client.sha1, size: v.downloads.client.size });
  }

  // 2. библиотеки + нативы
  const arts = [];
  for (const lib of v.libraries || []) arts.push(...libArtifacts(lib));
  const natives = arts.filter((a) => a.kind === 'native');
  let done = 0;
  const failed = [];
  onProgress({ stage: 'Загрузка библиотек', percent: 6, detail: `0/${arts.length}` });
  await pool(arts, 12, async (a) => {
    try {
      await download(a.url, a.path, { sha1: a.sha1, size: a.size });
    } catch (e) {
      if (!(await exists(a.path))) {
        // библиотеки загрузчиков, собранные из maven-координат, в репозитории бывают не выложены —
        // их отсутствие не смертельно. А вот файл от Mojang (с sha1) пропускать нельзя.
        const required = Boolean(a.sha1);
        console.warn('[lib]', required ? 'обязательная' : 'необязательная', a.url, e.message);
        if (required) failed.push({ file: path.basename(a.path), host: hostOf(a.url), reason: e.message });
      }
    }
    done++;
    onProgress({
      stage: 'Загрузка библиотек',
      percent: 6 + Math.round((done / arts.length) * 34),
      detail: `${done}/${arts.length} · ${path.basename(a.path)}`,
    });
  });

  if (failed.length) {
    const hosts = [...new Set(failed.map((f) => f.host))].join(', ');
    throw new Error(
      `Не удалось скачать ${failed.length} файлов с ${hosts}: ${failed[0].reason}. `
      + 'Проверьте интернет и запустите установку снова — уже скачанное не пропадёт.',
    );
  }

  const nativeDir = path.join(dirs.natives, id);
  if (natives.length) {
    onProgress({ stage: 'Распаковка нативных библиотек', percent: 42 });
    await extractNatives(natives.filter((n) => fs.existsSync(n.path)), nativeDir);
  }

  // 3. ассеты
  if (v.assetIndex) {
    const idxPath = path.join(dirs.assetIndexes, `${v.assetIndex.id}.json`);
    onProgress({ stage: 'Загрузка индекса ресурсов', percent: 44 });
    await download(v.assetIndex.url, idxPath, { sha1: v.assetIndex.sha1, size: v.assetIndex.size });
    const index = JSON.parse(await fsp.readFile(idxPath, 'utf8'));
    const objects = Object.entries(index.objects || {});
    let a = 0;
    onProgress({ stage: 'Загрузка ресурсов игры', percent: 46, detail: `0/${objects.length}` });
    await pool(objects, 24, async ([name, obj]) => {
      const sub = obj.hash.slice(0, 2);
      const dest = path.join(dirs.assetObjects, sub, obj.hash);
      await download(`${RESOURCES}/${sub}/${obj.hash}`, dest, { sha1: obj.hash, size: obj.size });
      // старые версии (pre-1.6 / virtual) читают ассеты как обычные файлы
      if (index.virtual || index.map_to_resources) {
        const vdir = index.map_to_resources
          ? path.join(dirs.root, 'resources')
          : path.join(dirs.assets, 'virtual', v.assetIndex.id);
        const vfile = path.join(vdir, name);
        if (!fs.existsSync(vfile)) {
          await fsp.mkdir(path.dirname(vfile), { recursive: true });
          await fsp.copyFile(dest, vfile);
        }
      }
      a++;
      if (a % 25 === 0 || a === objects.length) {
        onProgress({ stage: 'Загрузка ресурсов игры', percent: 46 + Math.round((a / objects.length) * 52), detail: `${a}/${objects.length}` });
      }
    });
  }

  // 4. конфиг логгера (опционально)
  if (v.logging?.client?.file) {
    const f = v.logging.client.file;
    await download(f.url, path.join(dirs.assets, 'log_configs', f.id), { sha1: f.sha1, size: f.size }).catch(() => {});
  }

  onProgress({ stage: 'Готово', percent: 100 });
  return v;
}

module.exports = {
  manifest, installed, resolve, install, fetchVersionJson,
  versionDir, versionJsonPath, versionJarPath, matchRules, libArtifacts, mavenPath,
  dedupeLibraries, libKey, libVersion,
};
