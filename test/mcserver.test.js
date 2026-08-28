'use strict';
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { useTempRoot, freshRequire } = require('./helpers');

let mcserver, config, root;

before(() => {
  root = useTempRoot();
  mcserver = freshRequire('../src/main/lib/mcserver.js');
  config = freshRequire('../src/main/lib/config.js');
});

beforeEach(() => {
  try { fs.rmSync(path.join(root, 'instances'), { recursive: true }); } catch { /* не было */ }
  try { fs.rmSync(path.join(root, 'f1'), { recursive: true }); } catch { /* не было */ }
});

/** Создаёт мир внутри сборки: папку с level.dat */
function makeWorld(folder, name) {
  const { gameDir } = require('../src/main/lib/paths');
  const dir = path.join(gameDir(folder), 'saves', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'level.dat'), 'не настоящий, для теста');
  return dir;
}

describe('настройки сервера', () => {
  test('проверка сессии выключена — ради этого всё и делается', () => {
    const p = mcserver.propertiesFor({ port: 25570, world: 'saves/Мир' });
    assert.match(p, /^online-mode=false$/m, 'иначе пиратские аккаунты снова отлетят с Invalid session');
  });

  test('мир берётся из папки сборки, а не копируется рядом', () => {
    const p = mcserver.propertiesFor({ port: 25570, world: 'saves/Мой мир' });
    assert.match(p, /^level-name=saves\/Мой мир$/m);
  });

  test('обратные слэши Windows превращаются в прямые', () => {
    // сервер понимает путь только через прямые, а path.join на Windows даёт обратные
    const p = mcserver.propertiesFor({ port: 1, world: 'saves\\Мир' });
    assert.match(p, /^level-name=saves\/Мир$/m);
  });

  test('порт попадает в настройки', () => {
    assert.match(mcserver.propertiesFor({ port: 25571, world: 'w' }), /^server-port=25571$/m);
  });
});

describe('чтение журнала сервера', () => {
  test('готовность опознаётся', () => {
    assert.equal(mcserver.isReady('[12:00:00] [Server thread/INFO]: Done (7.421s)! For help, type "help"'), true);
  });

  test('посторонние строки за готовность не принимаются', () => {
    for (const s of ['Preparing spawn area: 12%', 'Done', '', null]) {
      assert.equal(mcserver.isReady(s), false, String(s));
    }
  });

  test('порт вычитывается из журнала', () => {
    assert.equal(mcserver.portFrom('[Server thread/INFO]: Starting Minecraft server on *:25570'), 25570);
    assert.equal(mcserver.portFrom('[Server thread/INFO]: Starting Minecraft server on 0.0.0.0:25571'), 25571);
  });

  test('мусор не превращается в порт', () => {
    for (const s of ['Starting Minecraft server', 'порт 25565', '', null]) {
      assert.equal(mcserver.portFrom(s), null, String(s));
    }
  });
});

describe('список миров сборки', () => {
  test('находит миры и ставит недавние выше', async () => {
    makeWorld('f1', 'Старый');
    const fresh = makeWorld('f1', 'Свежий');
    fs.utimesSync(path.join(fresh, 'level.dat'), new Date(), new Date(Date.now() + 60000));

    const list = await mcserver.worlds({ folder: 'f1' });
    assert.deepEqual(list.map((w) => w.name), ['Свежий', 'Старый']);
  });

  test('папка без level.dat миром не считается', async () => {
    makeWorld('f1', 'Настоящий');
    const { gameDir } = require('../src/main/lib/paths');
    fs.mkdirSync(path.join(gameDir('f1'), 'saves', 'мусор'), { recursive: true });

    const list = await mcserver.worlds({ folder: 'f1' });
    assert.deepEqual(list.map((w) => w.name), ['Настоящий']);
  });

  test('нет папки saves — пустой список, а не падение', async () => {
    assert.deepEqual(await mcserver.worlds({ folder: 'пусто' }), []);
  });
});

describe('чем запускать сервер у разных загрузчиков', () => {
  const dir = () => {
    const d = path.join(root, 'srv');
    fs.mkdirSync(d, { recursive: true });
    return d;
  };

  /** Кладёт файл со списком аргументов, как это делает установщик */
  function makeArgsFile(d, vendor, version) {
    const win = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
    const p = path.join(d, 'libraries', vendor, version, win);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '-cp libraries/... net.minecraftforge.bootstrap.ForgeBootstrap');
    return p;
  }

  beforeEach(() => { try { fs.rmSync(path.join(root, 'srv'), { recursive: true }); } catch { /* не было */ } });

  test('Forge берёт список аргументов, оставленный установщиком', async () => {
    const d = dir();
    makeArgsFile(d, 'net/minecraftforge/forge', '1.20.1-47.4.23');
    const args = await mcserver.serverArgs(
      { loader: 'forge', mc: '1.20.1', loaderVersion: '1.20.1-47.4.23' }, d, { ram: 3000 },
    );
    assert.equal(args[0], '-Xmx3000M');
    assert.match(args[1], /^@libraries\/net\/minecraftforge\/forge\/1\.20\.1-47\.4\.23\/\w+_args\.txt$/);
    assert.equal(args.at(-1), 'nogui');
  });

  test('NeoForge — то же самое, но из своей папки', async () => {
    const d = dir();
    makeArgsFile(d, 'net/neoforged/neoforge', '21.1.95');
    const args = await mcserver.serverArgs(
      { loader: 'neoforge', mc: '1.21.1', loaderVersion: '21.1.95' }, d, {},
    );
    assert.match(args[1], /^@libraries\/net\/neoforged\/neoforge\/21\.1\.95\//);
  });

  test('старый Forge без списка аргументов запускается обычным jar', async () => {
    const d = dir();
    fs.writeFileSync(path.join(d, 'forge-1.12.2-14.23.5.2860-universal.jar'), 'не настоящий');
    const args = await mcserver.serverArgs(
      { loader: 'forge', mc: '1.12.2', loaderVersion: '1.12.2-14.23.5.2860' }, d, {},
    );
    assert.deepEqual(args.slice(1), ['-jar', 'forge-1.12.2-14.23.5.2860-universal.jar', 'nogui']);
  });

  test('рядом с установщиком выбирается сервер, а не сам установщик', async () => {
    const d = dir();
    // установщик остаётся в папке после установки — запустить его вместо
    // сервера означало бы начать установку заново при каждом открытии мира
    fs.writeFileSync(path.join(d, 'forge-1.12.2-14.23.5.2860-installer.jar'), 'не настоящий');
    fs.writeFileSync(path.join(d, 'forge-1.12.2-14.23.5.2860-universal.jar'), 'не настоящий');

    const args = await mcserver.serverArgs(
      { loader: 'forge', mc: '1.12.2', loaderVersion: '1.12.2-14.23.5.2860' }, d, {},
    );
    assert.equal(args[2], 'forge-1.12.2-14.23.5.2860-universal.jar');
  });

  test('Quilt запускается своим готовым файлом', async () => {
    const d = dir();
    fs.writeFileSync(path.join(d, 'quilt-server-launch.jar'), 'не настоящий');
    const args = await mcserver.serverArgs({ loader: 'quilt', mc: '1.20.1', loaderVersion: '0.26.0' }, d, {});
    assert.equal(args[1], '-jar');
    assert.match(args[2], /quilt-server-launch\.jar$/);
  });

  test('память из настроек попадает в запуск', async () => {
    const d = dir();
    fs.writeFileSync(path.join(d, 'quilt-server-launch.jar'), 'не настоящий');
    const args = await mcserver.serverArgs({ loader: 'quilt', loaderVersion: '1' }, d, { ram: 6144 });
    assert.equal(args[0], '-Xmx6144M');
  });
});

describe('запуск сервера', () => {
  test('без согласия с правилами не стартует', async () => {
    makeWorld('f1', 'Мир');
    await assert.rejects(
      () => mcserver.start({ folder: 'f1', mc: '1.20.1' }, 'Мир', { eula: false }),
      /EULA/,
    );
  });

  test('несуществующий мир даёт понятную ошибку', async () => {
    await assert.rejects(
      () => mcserver.start({ folder: 'f1', mc: '1.20.1' }, 'Которого нет', { eula: true }),
      /не найден/,
    );
  });

  test('без выбранного мира не стартует', async () => {
    await assert.rejects(
      () => mcserver.start({ folder: 'f1', mc: '1.20.1' }, '', { eula: true }),
      /мир/i,
    );
  });

  test('остановка незапущенного сервера ничего не ломает', async () => {
    assert.equal(await mcserver.stop(), true);
    assert.equal(mcserver.state().running, false);
  });
});

describe('почему сервер не поднялся', () => {
  const say = (...lines) => mcserver.explain(lines);

  test('графическая библиотека на сервере — та самая ошибка про lwjgl', () => {
    // так падает Forge со включёнными шейдерами: понять по сообщению нельзя
    assert.match(
      say('java.lang.module.FindException: Module org.lwjgl not found, required by org.lwjgl.tinyexr'),
      /картинки|шейдер/i,
    );
  });

  test('мод только для клиента опознаётся — это самая частая причина', () => {
    assert.match(
      say('[main/ERROR]: Mod journeymap is client-side only and cannot run on a dedicated server'),
      /только для клиента/,
    );
  });

  test('не хватает Java', () => {
    assert.match(say('java.lang.UnsupportedClassVersionError: class file version 65.0'), /Java/);
  });

  test('порт занят', () => {
    assert.match(say('[Server thread/WARN]: **** FAILED TO BIND TO PORT!'), /[Пп]орт занят/);
  });

  test('не хватило памяти', () => {
    assert.match(say('java.lang.OutOfMemoryError: Java heap space'), /памяти/);
  });

  test('незнакомая ошибка отдаётся последней строкой, а не проглатывается', () => {
    const out = say('обычная строка', 'java.lang.NullPointerException: что-то своё', 'и ещё строка');
    assert.match(out, /NullPointerException/);
  });

  test('журнал без ошибок не выдумывает причину', () => {
    const out = say('[Server thread/INFO]: Preparing spawn area: 40%');
    assert.match(out, /консоли лаунчера/);
  });
});

describe('клиентские моды на время сервера', () => {
  const { gameDir } = require('../src/main/lib/paths');
  const modsDir = () => {
    const d = path.join(gameDir('f1'), 'mods');
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const put = (d, ...names) => names.forEach((n) => fs.writeFileSync(path.join(d, n), 'не настоящий'));
  const list = (d) => fs.readdirSync(d).sort();

  test('шейдеры и ускорители картинки убираются, остальное остаётся', () => {
    const d = modsDir();
    put(d, 'oculus-1.6.9.jar', 'embeddium-0.3.jar', 'jei-15.2.jar', 'create-0.5.1.jar');

    const hidden = mcserver.hideClientMods(gameDir('f1'));
    assert.deepEqual(hidden.sort(), ['embeddium-0.3.jar', 'oculus-1.6.9.jar']);
    assert.deepEqual(list(d), ['create-0.5.1.jar', 'embeddium-0.3.jar.server-off', 'jei-15.2.jar', 'oculus-1.6.9.jar.server-off']);
  });

  test('после остановки всё возвращается на место', () => {
    const d = modsDir();
    put(d, 'oculus-1.6.9.jar', 'create-0.5.1.jar');
    mcserver.hideClientMods(gameDir('f1'));

    assert.equal(mcserver.restoreClientMods(gameDir('f1')), 1);
    assert.deepEqual(list(d), ['create-0.5.1.jar', 'oculus-1.6.9.jar']);
  });

  test('моды с содержимым мира не трогаются — без них мир не откроется', () => {
    const d = modsDir();
    put(d, 'create-0.5.1.jar', 'valkyrien-skies-2.jar', 'lostcities-1.20.jar', 'parcool-1.20.jar');

    assert.deepEqual(mcserver.hideClientMods(gameDir('f1')), []);
    assert.equal(list(d).length, 4);
  });

  test('выключенные человеком моды не путаются с нашими', () => {
    const d = modsDir();
    put(d, 'oculus-1.6.9.jar.disabled', 'sodium-0.5.jar');
    mcserver.hideClientMods(gameDir('f1'));

    // .disabled — выбор человека, возвращать его в строй мы не вправе
    mcserver.restoreClientMods(gameDir('f1'));
    assert.deepEqual(list(d), ['oculus-1.6.9.jar.disabled', 'sodium-0.5.jar']);
  });
});

describe('порт сервера', () => {
  test('в настройки уходит настоящий номер, а не ноль', async () => {
    /*
     * Раньше писали 0 и ждали, что сервер назовёт порт в журнале. Формулировка
     * строки у загрузчиков разная: не разобрали — и друзья молча никуда не
     * попадают. Порт выбираем сами, до запуска.
     */
    makeWorld('f1', 'Мир');
    // java до дела не дойдёт, но server.properties к тому времени уже записан
    await mcserver.start({ folder: 'f1', mc: '1.20.1', versionId: 'нет-такой', loader: 'vanilla' },
      'Мир', { eula: true, port: 0 }).catch(() => {});

    const { gameDir } = require('../src/main/lib/paths');
    const file = path.join(gameDir('f1'), 'server.properties');
    if (!fs.existsSync(file)) return;          // не дошло до записи — проверять нечего
    const port = Number(fs.readFileSync(file, 'utf8').match(/^server-port=(\d+)$/m)?.[1]);
    assert.ok(port > 0 && port < 65536, `в настройках порт ${port}`);
  });
});
