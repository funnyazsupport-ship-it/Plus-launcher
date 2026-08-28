'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const { dirs, gameDir } = require('./paths');
const { getJSON, download } = require('./net');
const versions = require('./versions');
const java = require('./java');

/*
 * Свой сервер для игры с другом.
 *
 * «Открыть для сети» из самой игры не годится: встроенный сервер проверяет
 * сессию входящего на серверах авторизации, и любой аккаунт без сессии
 * отлетает с «Invalid session». Обойти это в игре нельзя — проверку делает
 * она сама, и никакие настройки лаунчера на неё не влияют.
 *
 * Настоящий сервер такую проверку умеет выключать: online-mode=false. Тогда
 * заходят любые аккаунты, и модов не нужно ни хозяину, ни гостю.
 *
 * Мир не копируется: сервер запускается прямо в папке сборки, а level-name
 * указывает внутрь saves. Иначе у человека было бы два разных мира с одним
 * названием, и он бы не понимал, в каком из них его постройки.
 */

const FABRIC_META = 'https://meta.fabricmc.net/v2';
const QUILT_META = 'https://meta.quiltmc.org/v3';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEO_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

// Где установщик Forge и NeoForge оставляет список аргументов запуска
const ARGS_DIR = { forge: 'net/minecraftforge/forge', neoforge: 'net/neoforged/neoforge' };
const ARGS_FILE = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
const READY = /Done \([\d.]+s\)!/;
const PORT_LINE = /Starting Minecraft server on [^:]*:(\d{2,5})/;
const STOP_MS = 20000;                 // столько ждём, пока сервер сохранит мир и выйдет

/** Папка, куда складываем серверные jar-файлы */
const jarDir = () => path.join(dirs.cache, 'server');

/**
 * Свободный порт, выбранный заранее.
 *
 * Можно было бы написать в настройках 0 и дать серверу выбрать самому, но тогда
 * узнать номер получится только из его журнала — а формулировка строки у разных
 * загрузчиков разная. Не разобрали строку — и друзья молча никуда не попадают.
 * Выбирая порт сами, мы знаем его до запуска.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '0.0.0.0', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Сервер запущен? Разбираем строку журнала */
const isReady = (line) => READY.test(String(line || ''));

/** Порт, на котором сервер в итоге поднялся */
function portFrom(line) {
  const m = String(line || '').match(PORT_LINE);
  if (!m) return null;
  const port = Number(m[1]);
  return port > 0 && port < 65536 ? port : null;
}

/**
 * Настройки сервера.
 * online-mode=false — то, ради чего всё затевалось. Остальное подобрано так,
 * чтобы мир вёл себя как одиночный: те же правила, никакого списка белых.
 */
function propertiesFor({ port, world, motd = 'Мир друга' }) {
  return [
    '# создано Plus Launcher',
    'online-mode=false',
    `server-port=${Number(port) || 25565}`,
    `level-name=${String(world).replace(/\\/g, '/')}`,
    `motd=${motd}`,
    'enable-command-block=true',
    'allow-flight=true',
    'max-players=8',
    'view-distance=10',
    'sync-chunk-writes=false',
    'enforce-secure-profile=false',
    '',
  ].join('\n');
}

/** Миры сборки — из них человек выбирает, какой открыть */
async function worlds(inst) {
  const saves = path.join(gameDir(inst.folder || inst.mc || inst.id), 'saves');
  let names;
  try {
    names = await fsp.readdir(saves, { withFileTypes: true });
  } catch {
    return [];                         // играли только на серверах — своих миров нет
  }
  const out = [];
  for (const d of names) {
    if (!d.isDirectory()) continue;
    // папка без level.dat — это не мир, а мусор рядом
    if (!fs.existsSync(path.join(saves, d.name, 'level.dat'))) continue;
    let played = 0;
    try { played = (await fsp.stat(path.join(saves, d.name, 'level.dat'))).mtimeMs; } catch { /* неважно */ }
    out.push({ name: d.name, played });
  }
  return out.sort((a, b) => b.played - a.played);
}

/** Серверный файл ванильной игры — он же годится для сборок с OptiFine */
async function vanillaJar(inst, onProgress) {
  const v = await versions.resolve(inst.versionId);
  const server = v.downloads?.server;
  if (!server?.url) throw new Error(`Для Minecraft ${inst.mc} нет серверного файла`);
  const file = path.join(jarDir(), `minecraft-${inst.mc}.jar`);
  onProgress({ stage: 'Скачиваю сервер Minecraft', percent: 20 });
  await download(server.url, file, { sha1: server.sha1, size: server.size });
  return file;
}

/** Fabric отдаёт готовый серверный файл — своего установщика гонять не нужно */
async function fabricJar(inst, onProgress) {
  const installers = await getJSON(`${FABRIC_META}/versions/installer`);
  const installer = (installers.find((i) => i.stable) || installers[0])?.version;
  if (!installer) throw new Error('Fabric не отдал список установщиков');
  const file = path.join(jarDir(), `fabric-${inst.mc}-${inst.loaderVersion}-${installer}.jar`);
  onProgress({ stage: 'Скачиваю сервер Fabric', percent: 20 });
  await download(`${FABRIC_META}/versions/loader/${inst.mc}/${inst.loaderVersion}/${installer}/server/jar`, file);
  return file;
}

/** Запускает чужой установщик и ждёт его молча — говорить будем сами */
function runJar(javaPath, args, cwd, onProgress, what) {
  return new Promise((resolve, reject) => {
    const p = spawn(javaPath, args, { cwd, windowsHide: true });
    let log = '';
    const watch = (d) => {
      log += d;
      const line = String(d).trim().split('\n').pop();
      if (line) onProgress({ stage: what, percent: 50, detail: line.slice(0, 90) });
    };
    p.stdout.on('data', watch);
    p.stderr.on('data', watch);
    p.on('error', reject);
    p.on('close', (code) => (code === 0
      ? resolve()
      : reject(new Error(`${what}: установщик вышел с кодом ${code}\n${log.slice(-600)}`))));
  });
}

/**
 * Готовит серверную часть сборки и возвращает аргументы запуска java.
 *
 * У каждого загрузчика свой путь. Fabric отдаёт готовый файл. Quilt, Forge и
 * NeoForge — только установщик, который надо прогнать один раз в папке сервера.
 * OptiFine серверной части не имеет вовсе: он про то, как игра рисует картинку,
 * и на стороне сервера ему делать нечего — берём ванильный.
 */
async function serverArgs(inst, dir, opt, onProgress = () => {}) {
  const loader = inst.loader || 'vanilla';
  const ram = `-Xmx${opt.ram || 2048}M`;
  const javaPath = opt.javaPath;

  if (loader === 'fabric') return [ram, '-jar', await fabricJar(inst, onProgress), 'nogui'];
  if (loader === 'vanilla' || loader === 'optifine') {
    return [ram, '-jar', await vanillaJar(inst, onProgress), 'nogui'];
  }

  if (loader === 'quilt') {
    const launch = path.join(dir, 'quilt-server-launch.jar');
    if (!fs.existsSync(launch)) {
      const list = await getJSON(`${QUILT_META}/versions/installer`);
      const url = (list.find((i) => i.url) || {}).url;
      if (!url) throw new Error('Quilt не отдал установщик');
      const jar = path.join(jarDir(), path.basename(new URL(url).pathname));
      onProgress({ stage: 'Скачиваю установщик Quilt', percent: 20 });
      await download(url, jar);
      onProgress({ stage: 'Ставлю сервер Quilt', percent: 35 });
      await runJar(javaPath, ['-jar', jar, 'install', 'server', inst.mc, inst.loaderVersion,
        `--install-dir=${dir}`, '--download-server'], dir, onProgress, 'Quilt');
    }
    return [ram, '-jar', launch, 'nogui'];
  }

  if (loader === 'forge' || loader === 'neoforge') {
    // Установщик кладёт список аргументов рядом с библиотеками. Он длинный —
    // там весь classpath, — поэтому java читает его из файла, а не из строки.
    const argsPath = path.join(dir, 'libraries', ARGS_DIR[loader], String(inst.loaderVersion), ARGS_FILE);

    /*
     * Старые Forge (до 1.17) списка аргументов не делают вовсе — там обычный
     * jar рядом. Поэтому «уже установлено» проверяем по обоим признакам:
     * иначе на каждый запуск такой сборки установщик гонялся бы заново.
     */
    const readyJar = () => {
      let files;
      try { files = fs.readdirSync(dir); } catch { return null; }
      const skip = /installer|shim|sources|javadoc/i;
      return files.find((f) => /^(forge|neoforge).*\.jar$/i.test(f) && !skip.test(f))
        || files.find((f) => /^minecraft_server.*\.jar$/i.test(f))
        || null;
    };

    if (!fs.existsSync(argsPath) && !readyJar()) {
      const url = loader === 'forge'
        ? `${FORGE_MAVEN}/${inst.loaderVersion}/forge-${inst.loaderVersion}-installer.jar`
        : `${NEO_MAVEN}/${inst.loaderVersion}/neoforge-${inst.loaderVersion}-installer.jar`;
      const jar = path.join(jarDir(), path.basename(new URL(url).pathname));
      onProgress({ stage: `Скачиваю установщик ${loader}`, percent: 20 });
      await download(url, jar);
      onProgress({ stage: `Ставлю сервер ${loader} — это займёт минуту`, percent: 35 });
      await fsp.mkdir(dir, { recursive: true });
      await runJar(javaPath, ['-jar', jar, '--installServer', dir], dir, onProgress, loader);
    }

    if (fs.existsSync(argsPath)) {
      // путь относительно папки сервера: в самом файле пути тоже относительные
      const rel = path.relative(dir, argsPath).replace(/\\/g, '/');
      return [ram, `@${rel}`, 'nogui'];
    }

    const jar = readyJar();
    if (!jar) throw new Error(`Установщик ${loader} не оставил файла для запуска сервера`);
    return [ram, '-jar', jar, 'nogui'];
  }

  // Незнакомый загрузчик: ванильный сервер — самое безопасное, что можно дать
  return [ram, '-jar', await vanillaJar(inst, onProgress), 'nogui'];
}

/*
 * Почему сервер не поднялся — человеческими словами.
 *
 * Голый кусок стека java ничего не объясняет, а причины у падения на старте
 * почти всегда одни и те же. Что не узнали — отдаём последней осмысленной
 * строкой журнала: она хотя бы указывает направление.
 */
const REASONS = [
  [/Module org\.lwjgl|lwjgl.*not found|org\.lwjgl\.\w+ not found/i,
    'Мод для картинки (шейдеры или ускоритель отрисовки) тянет графическую библиотеку, которой на сервере нет. Лаунчер убирает такие моды сам — если ошибка повторилась, уберите вручную Oculus, Iris, Embeddium, Sodium или OptiFine.'],
  [/only.*client|client.*side.*only|ClientOnly|is client-side only/i,
    'В сборке есть мод только для клиента — на сервере он падает. Уберите шейдеры, миникарты и подобное, либо создайте отдельную сборку для игры с другом.'],
  [/Missing or unsupported mandatory dependencies|requires .* but|Mod .* requires/i,
    'Какому-то моду не хватает зависимости. Посмотрите в консоли, какой мод и что просит.'],
  [/java\.lang\.UnsupportedClassVersionError|has been compiled by a more recent/i,
    'Нужна более новая Java. Сообщите — поправим версию для этой сборки.'],
  [/OutOfMemoryError|Could not reserve enough space/i,
    'Не хватило памяти серверу. Уменьшите число модов или дайте больше памяти.'],
  [/failed to bind to port|Address already in use|BindException/i,
    'Порт занят другой программой. Закройте второй лаунчер или свой сервер Minecraft.'],
  [/You need to agree to the EULA/i,
    'Не принято соглашение Minecraft — поставьте галочку и попробуйте снова.'],
];

function explain(tail) {
  const text = tail.join('\n');
  for (const [re, why] of REASONS) if (re.test(text)) return why;
  // ничего знакомого — отдаём последнюю строку про ошибку, она ближе всего к причине
  const hint = [...tail].reverse().find((s) => /error|exception|caused by/i.test(s));
  return hint ? hint.slice(0, 200) : 'Сервер закрылся на запуске. Подробности в консоли лаунчера.';
}

/*
 * Моды, которых на сервере быть не должно.
 *
 * Это средства отрисовки: шейдеры и ускорители картинки. Forge отсеивает те,
 * что честно помечены клиентскими, но такие моды тащат за собой графические
 * библиотеки (LWJGL), и сервер падает на них ещё до запуска — с сообщением
 * «Module org.lwjgl not found», по которому догадаться невозможно.
 *
 * Список нарочно короткий и состоит только из того, что рисует картинку.
 * Убрать мод с содержимым мира нельзя: без него мир не откроется.
 */
const CLIENT_ONLY = /^(oculus|iris|embeddium|rubidium|sodium|optifine|canvas|vulkanmod|nvidium|entityculling|immediatelyfast|betterfps)[-_.]/i;

const OFF = '.server-off';            // приписка, чтобы отличить от выключенных человеком

/** Прячет клиентские моды на время работы сервера. Возвращает, сколько убрал. */
function hideClientMods(dir) {
  const mods = path.join(dir, 'mods');
  let files;
  try { files = fs.readdirSync(mods); } catch { return []; }

  const hidden = [];
  for (const f of files) {
    if (!/\.jar$/i.test(f) || !CLIENT_ONLY.test(f)) continue;
    try {
      fs.renameSync(path.join(mods, f), path.join(mods, f + OFF));
      hidden.push(f);
    } catch { /* занят игрой — оставим как есть, сервер сам пожалуется */ }
  }
  return hidden;
}

/** Возвращает спрятанные моды на место. Вызывается и перед запуском: если
 *  лаунчер закрыли аварийно, они так и остались бы лежать выключенными. */
function restoreClientMods(dir) {
  const mods = path.join(dir, 'mods');
  let files;
  try { files = fs.readdirSync(mods); } catch { return 0; }

  let back = 0;
  for (const f of files) {
    if (!f.endsWith(OFF)) continue;
    try {
      fs.renameSync(path.join(mods, f), path.join(mods, f.slice(0, -OFF.length)));
      back += 1;
    } catch { /* вернём при следующем запуске */ }
  }
  return back;
}

let proc = null;
let ready = false;
let boundPort = null;
let serverDir = null;                 // куда возвращать моды после остановки

const state = () => ({ running: Boolean(proc), ready, port: boundPort });

/**
 * Поднимает сервер с миром сборки.
 * @param {object} inst сборка
 * @param {string} world название мира внутри saves
 * @param {object} opt port — на каком порту слушать, eula — согласие принято
 */
async function start(inst, world, opt = {}, onEvent = () => {}) {
  if (proc) throw new Error('Сервер уже запущен');
  if (!opt.eula) throw new Error('Нужно принять правила Minecraft (EULA)');
  if (!world) throw new Error('Не выбран мир');

  const dir = gameDir(inst.folder || inst.mc || inst.id);
  if (!fs.existsSync(path.join(dir, 'saves', world, 'level.dat'))) {
    throw new Error(`Мир «${world}» не найден`);
  }

  // моды могли остаться выключенными после аварийного закрытия лаунчера
  restoreClientMods(dir);

  await fsp.mkdir(jarDir(), { recursive: true });

  onEvent('progress', { stage: 'Проверка Java', percent: 10 });
  const major = java.requiredMajor(await versions.resolve(inst.versionId));
  const javaPath = await java.ensure(major, opt.javaPath, (p) => onEvent('progress', p));

  const args = await serverArgs(inst, dir, { ...opt, javaPath }, (p) => onEvent('progress', p));

  // Согласие спрашивает лаунчер, здесь только записываем ответ:
  // без файла сервер откажется стартовать и напишет об этом в консоль.
  await fsp.writeFile(path.join(dir, 'eula.txt'), 'eula=true\n');
  const port = Number(opt.port) > 0 ? Number(opt.port) : await freePort();
  await fsp.writeFile(
    path.join(dir, 'server.properties'),
    propertiesFor({ port, world: `saves/${world}`, motd: `${inst.name} — Plus Launcher` }),
  );

  const hidden = hideClientMods(dir);
  if (hidden.length) {
    onEvent('log', `[launcher] на время сервера убраны клиентские моды: ${hidden.join(', ')}`);
  }

  onEvent('progress', { stage: 'Запуск сервера', percent: 80 });
  ready = false;
  boundPort = port;                  // знаем заранее, журнал только подтвердит
  serverDir = dir;
  proc = spawn(javaPath, args, { cwd: dir, windowsHide: true });

  /*
   * Держим хвост журнала.
   *
   * Сервер, упавший на старте, снаружи выглядит точно так же, как медленный:
   * окно висит на «запускаю». Настоящая причина всегда в последних строках —
   * чаще всего это мод, который не работает на серверной стороне.
   */
  const tail = [];
  const line = (chunk) => {
    for (const s of String(chunk).split(/\r?\n/)) {
      if (!s.trim()) continue;
      tail.push(s);
      if (tail.length > 40) tail.shift();
      onEvent('log', s);
      const p = portFrom(s);
      if (p) boundPort = p;
      if (isReady(s)) { ready = true; onEvent('ready', state()); }
    }
  };
  proc.stdout.on('data', line);
  proc.stderr.on('data', line);
  proc.on('exit', (code) => {
    const never = !ready;              // не успел подняться — это падение, а не выход
    proc = null;
    ready = false;
    boundPort = null;
    if (serverDir) { restoreClientMods(serverDir); serverDir = null; }
    onEvent('exit', {
      code,
      failed: never,
      reason: never ? explain(tail) : null,
      log: tail.join('\n'),            // помощнику нужен сам журнал, а не пересказ
    });
  });

  return state();
}

/** Просит сервер выйти по-хорошему: иначе мир останется недосохранённым */
function stop() {
  if (!proc) return Promise.resolve(true);
  const child = proc;
  return new Promise((resolve) => {
    const kill = setTimeout(() => { try { child.kill(); } catch { /* уже мёртв */ } }, STOP_MS);
    child.once('exit', () => { clearTimeout(kill); resolve(true); });
    try { child.stdin.write('stop\n'); } catch { child.kill(); }
  });
}

module.exports = {
  start, stop, state, worlds, propertiesFor, isReady, portFrom, serverArgs, explain,
  hideClientMods, restoreClientMods,
};
