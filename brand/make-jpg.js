'use strict';
/*
 * Те же знаки, но в JPG — для случаев, когда PNG неудобен: отправить картинкой
 * в мессенджер, поставить обложкой. Прозрачности в JPG нет по устройству формата,
 * поэтому каждому знаку подбирается фон, на котором он читается.
 *
 * Для наложения на видео берите PNG: у JPG вокруг знака будет виден прямоугольник.
 *
 * Запуск:  npx electron brand/make-jpg.js
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const PAGE = path.join(__dirname, 'page.html');
const W = 760;
const H = 250;
const EDGE = 4;               // кромку окна срезаем, там бывает мусор
const QUALITY = 92;

const VARIANTS = [
  { cls: 'light', bg: '#0d0e11', file: 'znak-na-tyomnom.jpg', note: 'светлый знак на тёмном' },
  { cls: 'dark', bg: '#ffffff', file: 'znak-na-belom.jpg', note: 'тёмный знак на белом' },
  { cls: 'plate', bg: '#7a8391', file: 'znak-plashka.jpg', note: 'плашка на сером' },
];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true,
    show: false, frame: false, resizable: false, hasShadow: false,
  });

  await win.loadFile(PAGE);
  // масштаб Electron запоминает для адреса между запусками — сбрасываем,
  // иначе страница нарисуется увеличенной и не влезет в окно
  win.webContents.setZoomFactor(1);
  await new Promise((r) => setTimeout(r, 500));

  for (const v of VARIANTS) {
    await win.webContents.executeJavaScript(`
      document.body.className = ${JSON.stringify(v.cls)};
      document.documentElement.style.background = ${JSON.stringify(v.bg)};
      document.body.style.background = ${JSON.stringify(v.bg)};
      true;
    `);
    await new Promise((r) => setTimeout(r, 300));

    const shot = nativeImage.createFromBuffer((await win.webContents.capturePage()).toPNG());
    const s = shot.getSize();
    const inner = shot.crop({
      x: EDGE, y: EDGE, width: s.width - EDGE * 2, height: s.height - EDGE * 2,
    });
    const jpg = inner.toJPEG(QUALITY);
    fs.writeFileSync(path.join(OUT, v.file), jpg);

    const size = inner.getSize();
    console.log(`${v.file.padEnd(22)} ${size.width}x${size.height}  ${Math.round(jpg.length / 1024)} КБ  — ${v.note}`);
  }

  win.destroy();
  app.quit();
});
