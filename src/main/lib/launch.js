'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { dirs, gameDir: gameDirFor } = require('./paths');
const versions = require('./versions');
const java = require('./java');

const SEP = process.platform === 'win32' ? ';' : ':';

function flatten(args, features) {
  const out = [];
  for (const a of args || []) {
    if (typeof a === 'string') { out.push(a); continue; }
    if (!versions.matchRules(a.rules, features)) continue;
    const v = a.value;
    if (Array.isArray(v)) out.push(...v); else if (v != null) out.push(v);
  }
  return out;
}

function subst(str, vars) {
  return String(str).replace(/\$\{([a-z_]+)\}/gi, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Сборка classpath: все библиотеки версии + client.jar (по одной версии каждой библиотеки) */
function buildClasspath(v) {
  const cp = [];
  for (const lib of versions.dedupeLibraries(v.libraries || [])) {
    for (const a of versions.libArtifacts(lib)) {
      if (a.kind !== 'classpath') continue;
      if (!fs.existsSync(a.path)) continue;
      if (!cp.includes(a.path)) cp.push(a.path);
    }
  }
  const jarId = v.jar || v.id;
  const jar = versions.versionJarPath(jarId);
  if (fs.existsSync(jar)) cp.push(jar);
  return cp;
}

/**
 * Запуск игры.
 * @param {object} opt { versionId, account, config, instance }
 * @param {function} onEvent (type, payload) — 'log' | 'progress' | 'exit'
 */
async function launch(opt, onEvent = () => {}) {
  const { versionId, account, config } = opt;
  const v = await versions.resolve(versionId);

  // Своя игровая папка на каждую версию: <корень>\1.21.4\{mods,saves,config,...}
  const gameDir = opt.gameDir || (opt.folder ? gameDirFor(opt.folder) : dirs.root);
  for (const sub of ['mods', 'saves', 'config', 'resourcepacks', 'shaderpacks']) {
    await fsp.mkdir(path.join(gameDir, sub), { recursive: true });
  }

  const major = java.requiredMajor(v);
  onEvent('progress', { stage: `Проверка Java ${major}`, percent: 30 });
  const javaPath = await java.ensure(major, config.javaPath, (p) => onEvent('progress', p));

  const nativesDir = path.join(dirs.natives, versionId);
  fs.mkdirSync(nativesDir, { recursive: true });

  const classpath = buildClasspath(v);
  const assetsRoot = dirs.assets;
  const assetIndexId = v.assetIndex?.id || v.assets || 'legacy';
  const virtualDir = path.join(dirs.assets, 'virtual', assetIndexId);

  const vars = {
    auth_player_name: account.name,
    // Именно базовая версия игры: Forge подставляет её в -DignoreList=${version_name}.jar,
    // чтобы ванильный client.jar не превратился в JPMS-модуль и не конфликтовал с патчами.
    version_name: v.jar || v.id,
    game_directory: gameDir,
    assets_root: assetsRoot,
    game_assets: fs.existsSync(virtualDir) ? virtualDir : assetsRoot,
    assets_index_name: assetIndexId,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken || '0',
    auth_session: `token:${account.accessToken || '0'}:${account.uuid}`,
    auth_xuid: account.xuid || '0',
    clientid: account.clientId || '0',
    user_type: account.type === 'microsoft' ? 'msa' : 'legacy',
    user_properties: '{}',
    version_type: v.type || 'release',
    natives_directory: nativesDir,
    launcher_name: 'PlusLauncher',
    launcher_version: '1.0.0',
    classpath: classpath.join(SEP),
    classpath_separator: SEP,
    library_directory: dirs.libraries,
    resolution_width: String(config.width || 1280),
    resolution_height: String(config.height || 720),
  };

  const features = {
    is_demo_user: false,
    has_custom_resolution: !config.fullscreen,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false,
  };

  // --- JVM аргументы ---
  const jvm = [];
  jvm.push(`-Xms${config.minRam || 1024}M`, `-Xmx${config.maxRam || 4096}M`);
  jvm.push(...String(config.jvmArgs || '').split(/\s+/).filter(Boolean));
  if (process.platform === 'darwin') jvm.push('-XstartOnFirstThread');

  if (v.arguments?.jvm) {
    jvm.push(...flatten(v.arguments.jvm, features).map((a) => subst(a, vars)));
  } else {
    jvm.push(`-Djava.library.path=${nativesDir}`, '-cp', vars.classpath);
  }
  if (!jvm.includes('-cp') && !jvm.includes('-classpath')) jvm.push('-cp', vars.classpath);
  if (!jvm.some((a) => a.startsWith('-Djava.library.path'))) jvm.push(`-Djava.library.path=${nativesDir}`);

  // --- аргументы игры ---
  let game;
  if (v.arguments?.game) game = flatten(v.arguments.game, features).map((a) => subst(a, vars));
  else game = String(v.minecraftArguments || '').split(/\s+/).filter(Boolean).map((a) => subst(a, vars));

  if (config.fullscreen && !game.includes('--fullscreen')) game.push('--fullscreen');
  else if (!v.arguments?.game && !game.includes('--width')) game.push('--width', vars.resolution_width, '--height', vars.resolution_height);

  const args = [...jvm, v.mainClass, ...game];
  if (opt.dryRun) return { javaPath, args, classpath, gameDir, nativesDir };

  onEvent('progress', { stage: 'Запуск Minecraft', percent: 95 });
  onEvent('log', `[launcher] ${javaPath}\n[launcher] mainClass=${v.mainClass} libs=${classpath.length}`);

  const child = spawn(javaPath, args, { cwd: gameDir, windowsHide: false });
  child.stdout.on('data', (d) => onEvent('log', d.toString()));
  child.stderr.on('data', (d) => onEvent('log', d.toString()));
  child.on('error', (e) => onEvent('log', `[error] ${e.message}`));
  // Именно 'exit', а не 'close': игра порождает второй java-процесс, который наследует
  // stdout/stderr, и 'close' не наступает, пока он жив — лаунчер думал бы, что игра идёт.
  child.on('exit', (code) => onEvent('exit', { code }));
  onEvent('progress', { stage: 'Игра запущена', percent: 100 });
  return child;
}

module.exports = { launch, buildClasspath };
