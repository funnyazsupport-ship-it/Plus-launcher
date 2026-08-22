'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

const { useTempRoot, freshRequire } = require('./helpers');

/*
 * Поведение под Linux и macOS. Проверяем на подменённой платформе: часть кода
 * читает process.platform при загрузке модуля, поэтому его меняем до require.
 */
const realPlatform = process.platform;
const setPlatform = (value) => Object.defineProperty(process, 'platform', { value, configurable: true });

before(() => { useTempRoot(); });
after(() => setPlatform(realPlatform));

describe('запуск игры на Linux и macOS', () => {
  test('javaw не подставляется — он бывает только в Windows', () => {
    setPlatform('linux');
    const launch = freshRequire('../src/main/lib/launch.js');
    // функция не экспортируется, проверяем через исходник: на не-Windows выходим сразу
    const src = require('fs').readFileSync('src/main/lib/launch.js', 'utf8');
    assert.match(src, /process\.platform !== 'win32'\) return javaPath/);
    assert.ok(launch.launch, 'модуль загрузился под Linux');
  });

  test('разделитель classpath — двоеточие, а не точка с запятой', () => {
    setPlatform('linux');
    const src = require('fs').readFileSync('src/main/lib/launch.js', 'utf8');
    assert.match(src, /win32' \? ';' : ':'/);
  });
});

describe('поиск Java по дистрибутивам', () => {
  const rootsFor = (platform) => {
    setPlatform(platform);
    const java = freshRequire('../src/main/lib/java.js');
    // candidateRoots наружу не отдаётся — берём список из исходника модуля
    const src = require('fs').readFileSync('src/main/lib/java.js', 'utf8');
    const block = src.match(/} else \{([\s\S]*?)\n  \}/)[1];
    assert.ok(java.findAll, 'модуль загрузился');
    return block;
  };

  test('учтены места из разных дистрибутивов', () => {
    const block = rootsFor('linux');
    for (const p of ['/usr/lib/jvm', '/usr/lib64/jvm', '/usr/java', '/opt']) {
      assert.ok(block.includes(p), `не хватает ${p}`);
    }
  });

  test('SDKMAN и .jdks тоже просматриваются', () => {
    const block = rootsFor('linux');
    assert.ok(block.includes('.sdkman'));
    assert.ok(block.includes('.jdks'));
  });

  test('папка macOS на месте', () => {
    const block = rootsFor('darwin');
    assert.ok(block.includes('/Library/Java/JavaVirtualMachines'));
  });

  test('имя исполняемого файла Java без .exe вне Windows', () => {
    setPlatform('linux');
    freshRequire('../src/main/lib/java.js');
    const src = require('fs').readFileSync('src/main/lib/java.js', 'utf8');
    assert.match(src, /win32' \? 'java\.exe' : 'java'/);
  });
});

describe('обновление под каждую систему', () => {
  const platform = (value) => {
    setPlatform(value);
    return freshRequire('../src/main/lib/updater.js');
  };

  test('Linux ждёт свой файл описания и свои пакеты', () => {
    const u = platform('linux');
    const src = require('fs').readFileSync('src/main/lib/updater.js', 'utf8');
    assert.match(src, /latest-linux\.yml/);
    // пакеты популярных дистрибутивов должны узнаваться как установщики
    for (const ext of ['AppImage', 'deb', 'rpm']) {
      assert.ok(src.includes(ext), `updater не знает про ${ext}`);
    }
    assert.ok(u.cmpVersion, 'модуль загрузился под Linux');
  });

  test('сравнение версий работает одинаково на любой системе', () => {
    for (const p of ['linux', 'darwin', 'win32']) {
      const u = platform(p);
      assert.equal(u.cmpVersion('1.18.0', '1.17.1'), 1, p);
    }
  });
});

describe('настройка сборки под Linux', () => {
  const build = () => JSON.parse(require('fs').readFileSync('package.json', 'utf8')).build;

  test('собираются пакеты для популярных дистрибутивов', () => {
    const targets = build().linux.target.map((t) => t.target);
    for (const t of ['AppImage', 'deb', 'rpm', 'pacman', 'tar.gz']) {
      assert.ok(targets.includes(t), `нет цели ${t}`);
    }
  });

  test('у deb и rpm прописаны зависимости', () => {
    const b = build();
    assert.ok(b.deb.depends.includes('libgtk-3-0'));
    assert.ok(b.rpm.depends.includes('gtk3'));
  });

  test('файл сборки открывается двойным кликом и в Linux', () => {
    const b = build();
    // в Linux ассоциация идёт по типу MIME, одного расширения не хватает
    assert.equal(b.fileAssociations[0].mimeType, 'application/x-plus-modpack');
    assert.ok(b.linux.mimeTypes.includes('application/x-plus-modpack'));
    assert.match(b.linux.desktop.MimeType, /application\/x-plus-modpack/);
  });

  test('иконка ассоциации задана без расширения — каждой системе своя', () => {
    // .ico понимает только Windows; electron-builder сам возьмёт .png для Linux
    assert.equal(build().fileAssociations[0].icon, 'build/icon');
  });
});
