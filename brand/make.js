// Рисует водяные знаки в PNG с прозрачным фоном.
//
// Окно одно и размер у него не меняется: и повторная загрузка страницы,
// и setContentSize на прозрачном окне подвешивали снимок. Поэтому берём
// заведомо большое окно, а лишние прозрачные поля срезаем сами.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const PAGE = path.join(__dirname, 'page.html');
// размер знака измерен заранее: 711x200, плашке нужен ещё пиксель на рамку
const W = 760;
const H = 250;
// Windows оставляет мусор на самой кромке прозрачного окна — срезаем её до обрезки
const EDGE = 4;

const VARIANTS = [
  { cls: 'light', file: 'watermark-svetlyy.png', note: 'для тёмного видео' },
  { cls: 'dark', file: 'watermark-tyomnyy.png', note: 'для светлого видео' },
  { cls: 'plate', file: 'watermark-plashka.png', note: 'на подложке, читается везде' },
];

/** Срезает прозрачные поля вокруг знака */
function trim(png) {
  const img = nativeImage.createFromBuffer(png);
  const { width, height } = img.getSize();
  const bmp = img.toBitmap();                       // BGRA, 4 байта на точку
  let top = height; let left = width; let right = -1; let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bmp[(y * width + x) * 4 + 3] > 6) {       // альфа выше порога — есть что показывать
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (right < 0 || bottom < 0) return png;          // пусто — отдаём как есть

  const pad = 3;
  const x = Math.max(0, left - pad);
  const y = Math.max(0, top - pad);
  return img.crop({
    x,
    y,
    width: Math.min(width - x, right - left + 1 + pad * 2),
    height: Math.min(height - y, bottom - top + 1 + pad * 2),
  }).toPNG();
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true,
    show: false, frame: false, resizable: false, hasShadow: false,
    transparent: true, backgroundColor: '#00000000',
  });

  await win.loadFile(PAGE);
  // Electron помнит масштаб для адреса между запусками: без сброса страница
  // рисуется увеличенной и вылезает за окно вместе с полосами прокрутки.
  win.webContents.setZoomFactor(1);
  await new Promise((r) => setTimeout(r, 500));     // шрифты

  for (const v of VARIANTS) {
    await win.webContents.executeJavaScript(`document.body.className = ${JSON.stringify(v.cls)}; true`);
    await new Promise((r) => setTimeout(r, 300));

    // сначала срезаем кромку окна, потом уже обрезаем по содержимому
    const shot = nativeImage.createFromBuffer((await win.webContents.capturePage()).toPNG());
    const s0 = shot.getSize();
    const inner = shot.crop({
      x: EDGE, y: EDGE, width: s0.width - EDGE * 2, height: s0.height - EDGE * 2,
    });
    const png = trim(inner.toPNG());
    fs.writeFileSync(path.join(OUT, v.file), png);

    const s = nativeImage.createFromBuffer(png).getSize();
    console.log(`${v.file.padEnd(26)} ${s.width}x${s.height}  ${Math.round(png.length / 1024)} КБ  — ${v.note}`);
  }

  win.destroy();
  app.quit();
});
