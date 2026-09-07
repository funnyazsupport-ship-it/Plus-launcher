'use strict';
/*
 * Собирает build/icon.icns из build/icon.png.
 *
 * Под macOS electron-builder просит именно .icns и сам его не делает: сборка
 * падает на этом ещё до подписи. Готовые конвертеры есть только на самом
 * маке (iconutil), поэтому нужный файл кладём в репозиторий заранее.
 *
 * Запуск:  npx electron scripts/make-icns.js
 * Electron нужен ради nativeImage — он единственный умеет здесь менять размер.
 */
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const SRC = path.join(__dirname, '..', 'build', 'icon.png');
const OUT = path.join(__dirname, '..', 'build', 'icon.icns');

/*
 * Гнёзда icns. Каждое — свой размер, внутри обычный PNG.
 * Больше исходных 512 не делаем: растянутая картинка выглядит хуже, чем та,
 * которую macOS уменьшит из 512 сама.
 */
const SLOTS = [
  ['ic11', 32], ['ic12', 64],
  ['ic07', 128], ['ic13', 256],
  ['ic08', 256], ['ic14', 512], ['ic09', 512],
];

function build() {
  const src = nativeImage.createFromPath(SRC);
  if (src.isEmpty()) throw new Error(`не читается ${SRC}`);

  const parts = [];
  for (const [type, size] of SLOTS) {
    const png = src.resize({ width: size, height: size, quality: 'best' }).toPNG();
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);      // длина считается вместе с заголовком
    parts.push(head, png);
  }

  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);

  fs.writeFileSync(OUT, Buffer.concat([head, body]));
  console.log(`[icns] ${path.relative(process.cwd(), OUT)} — ${SLOTS.length} размеров, ${body.length + 8} байт`);
}

app.whenReady().then(() => {
  try { build(); } catch (e) { console.error(`[icns] ${e.message}`); process.exitCode = 1; }
  app.quit();
});
