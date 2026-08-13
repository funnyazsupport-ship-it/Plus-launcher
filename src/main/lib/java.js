'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');
const { dirs } = require('./paths');
const { getJSON, download } = require('./net');

const EXE = process.platform === 'win32' ? 'java.exe' : 'java';

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10000, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ err, out: `${stdout || ''}${stderr || ''}` }));
  });
}

/** Версия JRE по пути к java.exe, либо null */
async function probe(javaPath) {
  if (!javaPath || !fs.existsSync(javaPath)) return null;
  const { err, out } = await run(javaPath, ['-version']);
  if (err && !out) return null;
  const m = out.match(/version "(\d+)(?:\.(\d+))?[^"]*"/);
  if (!m) return null;
  let major = parseInt(m[1], 10);
  if (major === 1) major = parseInt(m[2] || '8', 10); // 1.8.0_xxx -> 8
  const arch64 = /64-Bit/.test(out);
  return { path: javaPath, major, arch: arch64 ? 'x64' : 'x86', raw: out.split('\n')[0].trim() };
}

function candidateRoots() {
  const roots = [];
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      for (const vendor of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'AdoptOpenJDK', 'Amazon Corretto', 'BellSoft', 'Programs']) {
        roots.push(path.join(base, vendor));
      }
    }
    roots.push('C:\\Program Files\\Minecraft Launcher\\runtime');
    roots.push(path.join(process.env.APPDATA || '', '.minecraft', 'runtime'));
  } else {
    roots.push('/usr/lib/jvm', '/Library/Java/JavaVirtualMachines', path.join(os.homedir(), '.jdks'));
  }
  roots.push(dirs.runtime);
  return roots.filter(Boolean);
}

function walkForJava(dir, depth = 0, found = []) {
  if (depth > 4 || found.length > 60) return found;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return found; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === EXE && path.basename(dir) === 'bin') found.push(p);
    else if (e.isDirectory()) walkForJava(p, depth + 1, found);
  }
  return found;
}

// Обход Program Files и прочих папок занимает секунды, а список меняется редко
let cache = { at: 0, list: null };
const CACHE_MS = 5 * 60 * 1000;

/** Все найденные в системе JRE/JDK. force=true — искать заново, минуя кэш */
async function findAll(force = false) {
  if (!force && cache.list && Date.now() - cache.at < CACHE_MS) return cache.list;
  const list = await scanAll();
  cache = { at: Date.now(), list };
  return list;
}

async function scanAll() {
  const paths = new Set();
  if (process.env.JAVA_HOME) paths.add(path.join(process.env.JAVA_HOME, 'bin', EXE));
  const { out } = await run(process.platform === 'win32' ? 'where' : 'which', ['java']);
  for (const line of String(out).split(/\r?\n/)) if (line.trim().endsWith(EXE)) paths.add(line.trim());
  for (const root of candidateRoots()) for (const p of walkForJava(root)) paths.add(p);

  const results = [];
  for (const p of paths) {
    const info = await probe(p);
    if (info) results.push(info);
  }
  const uniq = new Map();
  for (const r of results) uniq.set(r.path.toLowerCase(), r);
  return [...uniq.values()].sort((a, b) => b.major - a.major);
}

/** Нужная мажорная версия Java для версии игры (по javaVersion из version.json) */
function requiredMajor(versionJson) {
  const c = versionJson?.javaVersion?.majorVersion;
  if (c) return c;
  const id = versionJson?.id || '';
  const m = id.match(/^1\.(\d+)/);
  if (!m) return 17;
  const minor = parseInt(m[1], 10);
  if (minor >= 20) return 21;
  if (minor >= 18) return 17;
  if (minor >= 17) return 16;
  return 8;
}

/** Подобрать java под версию: точное совпадение мажора, иначе ближайшая старше */
async function pick(major, preferred = '') {
  if (preferred) {
    const info = await probe(preferred);
    if (info) return info;
  }
  const all = await findAll();
  return all.find((j) => j.major === major) || all.find((j) => j.major > major) || all[0] || null;
}

const ADOPTIUM = 'https://api.adoptium.net/v3/assets/latest';

/** Скачивает Temurin JRE нужной версии в runtime/ и возвращает путь к java */
async function install(major, onProgress = () => {}) {
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'ia32' ? 'x86' : 'x64';
  const osn = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  onProgress({ stage: `Поиск Java ${major}...`, percent: 5 });
  const list = await getJSON(`${ADOPTIUM}/${major}/hotspot?architecture=${arch}&image_type=jre&os=${osn}&vendor=eclipse`);
  const asset = list.find((a) => a.binary?.package?.link);
  if (!asset) throw new Error(`Не нашёл сборку Java ${major} для ${osn}/${arch}`);
  const pkg = asset.binary.package;
  const target = path.join(dirs.runtime, `jre-${major}`);
  const archive = path.join(dirs.cache, pkg.name);

  onProgress({ stage: `Скачивание Java ${major} (${Math.round(pkg.size / 1048576)} МБ)...`, percent: 15 });
  await download(pkg.link, archive, { size: pkg.size });

  onProgress({ stage: 'Распаковка Java...', percent: 75 });
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.mkdir(target, { recursive: true });
  if (pkg.name.endsWith('.zip')) {
    new AdmZip(archive).extractAllTo(target, true);
  } else {
    await new Promise((resolve, reject) =>
      execFile('tar', ['-xzf', archive, '-C', target], (e) => (e ? reject(e) : resolve())));
  }
  const found = walkForJava(target);
  if (!found.length) throw new Error('java не найдена в распакованном архиве');
  try { await fsp.unlink(archive); } catch {}
  if (process.platform !== 'win32') await fsp.chmod(found[0], 0o755);
  cache = { at: 0, list: null };            // появилась новая java — кэш устарел
  onProgress({ stage: `Java ${major} установлена`, percent: 100 });
  return found[0];
}

/** Гарантирует наличие подходящей java: находит или скачивает */
async function ensure(major, preferred = '', onProgress = () => {}) {
  const found = await pick(major, preferred);
  if (found && found.major >= major) return found.path;
  return install(major, onProgress);
}

module.exports = { findAll, probe, pick, install, ensure, requiredMajor };
