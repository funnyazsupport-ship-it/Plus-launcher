'use strict';
/*
 * Оформление под себя.
 *
 * Все цвета интерфейса живут в переменных CSS. Здесь из одного выбранного цвета
 * выводится весь набор оттенков акцента, а из остальных настроек — скругления,
 * плотность, шрифт и фон. Правила в styles.css при этом не трогаются вовсе:
 * добавить настройку значит добавить переменную, а не переписывать вёрстку.
 *
 * Файл обычный, без модулей: его подключают и окна лаунчера, и тесты.
 */

const PRESETS = [
  { id: 'green', name: 'Трава', color: '#74c045' },
  { id: 'sky', name: 'Небо', color: '#4aa3e0' },
  { id: 'lava', name: 'Лава', color: '#e2703a' },
  { id: 'amethyst', name: 'Аметист', color: '#9b6ade' },
  { id: 'redstone', name: 'Редстоун', color: '#d0484b' },
  { id: 'gold', name: 'Золото', color: '#e0b33a' },
  { id: 'diamond', name: 'Алмаз', color: '#3fc7c0' },
  { id: 'rose', name: 'Роза', color: '#e06a9c' },
];

const FONTS = {
  system: { name: 'Обычный', stack: 'system-ui, "Segoe UI", Roboto, sans-serif' },
  rounded: { name: 'Округлый', stack: '"Segoe UI Variable Display", "Nunito", system-ui, sans-serif' },
  serif: { name: 'С засечками', stack: 'Georgia, "Times New Roman", serif' },
  mono: { name: 'Моноширинный', stack: '"Cascadia Mono", Consolas, monospace' },
};

const DENSITY = {
  compact: { name: 'Плотно', pad: 0.8, font: 13 },
  normal: { name: 'Обычно', pad: 1, font: 14 },
  roomy: { name: 'Просторно', pad: 1.25, font: 15 },
};

const DEFAULTS = {
  accent: '#74c045',
  radius: 9,
  density: 'normal',
  font: 'system',
  animations: true,
  bgDim: 55,
  bgBlur: 0,
};

// ---------------- цвета ----------------

/** Разбирает #rgb и #rrggbb, иначе null — чужому значению доверять нельзя */
function toRgb(hex) {
  const s = String(hex || '').trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** Смешивает цвет с белым (t > 0) или чёрным (t < 0) */
const mix = (rgb, t) => rgb.map((v) => (t >= 0 ? v + (255 - v) * t : v * (1 + t)));

/**
 * Насколько цвет светлый с точки зрения глаза.
 * Зелёный воспринимается ярче синего при тех же числах, поэтому доли разные.
 */
const luma = (rgb) => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;

const rgba = (rgb, a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;

/*
 * Подгоняет цвет под тему, сохраняя оттенок.
 *
 * Акцент служит и фоном кнопок, и цветом подписей. На белом фоне светло-жёлтая
 * подпись не читается, на тёмном — тёмно-синяя. Поэтому слишком светлые цвета
 * на светлой теме притемняются, слишком тёмные на тёмной — осветляются.
 * Человек выбирает оттенок, а насколько он яркий, решаем мы.
 */
function fitToTheme(rgb, theme) {
  const l = luma(rgb);
  // Границы подобраны так, чтобы привычные цвета тем лаунчера проходили без
  // изменений: зелёный светлой темы сидит на 0.51 и трогать его не надо.
  if (theme === 'light') return l > 0.56 ? mix(rgb, -(l - 0.45) / Math.max(l, 0.01)) : rgb;
  return l < 0.26 ? mix(rgb, (0.33 - l) / Math.max(1 - l, 0.01)) : rgb;
}

/**
 * Весь набор оттенков акцента из одного цвета.
 * Текст поверх акцента выбирается по яркости: на светлом акценте белые буквы
 * не читаются, на тёмном — чёрные.
 */
function paletteFrom(hex, theme = 'dark') {
  const picked = toRgb(hex) || toRgb(DEFAULTS.accent);
  const rgb = fitToTheme(picked, theme);
  const light = luma(rgb) > 0.55;
  // на белом фоне заливка той же плотности выглядит грязью, поэтому слабее
  const dim = theme === 'light' ? 0.12 : 0.14;
  const line = theme === 'light' ? 0.34 : 0.38;
  return {
    '--accent': toHex(rgb),
    '--accent-2': toHex(mix(rgb, -0.18)),
    '--accent-hi': toHex(mix(rgb, 0.14)),
    '--accent-dim': rgba(rgb, dim),
    '--accent-line': rgba(rgb, line),
    '--on-accent': light ? toHex(mix(rgb, -0.82)) : toHex(mix(rgb, 0.92)),
    '--glow': `0 3px 14px ${rgba(rgb, theme === 'light' ? 0.22 : 0.26)}`,
  };
}

// ---------------- всё оформление ----------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v)));

/** Дополняет настройки значениями по умолчанию и чинит негодные */
function normalize(ui = {}) {
  const out = { ...DEFAULTS, ...ui };
  out.accent = toRgb(out.accent) ? out.accent : DEFAULTS.accent;
  out.radius = Number.isFinite(Number(out.radius)) ? clamp(out.radius, 0, 20) : DEFAULTS.radius;
  out.density = DENSITY[out.density] ? out.density : DEFAULTS.density;
  out.font = FONTS[out.font] ? out.font : DEFAULTS.font;
  out.animations = out.animations !== false;
  out.bgDim = Number.isFinite(Number(out.bgDim)) ? clamp(out.bgDim, 0, 92) : DEFAULTS.bgDim;
  out.bgBlur = Number.isFinite(Number(out.bgBlur)) ? clamp(out.bgBlur, 0, 24) : DEFAULTS.bgBlur;
  return out;
}

/**
 * Переменные CSS для выбранного оформления.
 * @param {string} theme dark или light — от него зависит, чем затемнять фон
 */
function varsFrom(ui, theme = 'dark') {
  const u = normalize(ui);
  const d = DENSITY[u.density];
  return {
    ...paletteFrom(u.accent, theme),
    '--r': `${u.radius}px`,
    '--r-sm': `${Math.max(0, Math.round(u.radius * 0.66))}px`,
    '--r-pill': `${Math.max(0, Math.round(u.radius * 2.2))}px`,
    '--ui-font': FONTS[u.font].stack,
    '--ui-size': `${d.font}px`,
    '--ui-pad': String(d.pad),
    // затемнение и полупрозрачность панелей считаем здесь, а не в CSS:
    // color-mix в правилах пересчитывался бы на каждой перерисовке
    '--bg-veil': `rgba(${theme === 'light' ? '255, 255, 255' : '10, 11, 14'}, ${u.bgDim / 100})`,
    '--panel-glass': `rgba(${theme === 'light' ? '255, 255, 255' : '21, 23, 27'}, .86)`,
    '--bg-blur': `${u.bgBlur}px`,
  };
}

/** Раскладывает оформление по документу */
function applyUi(ui, doc = document) {
  const u = normalize(ui);
  const root = doc.documentElement;
  for (const [k, v] of Object.entries(varsFrom(u, root.getAttribute('data-theme') || 'dark'))) {
    root.style.setProperty(k, v);
  }
  root.classList.toggle('no-anim', !u.animations);
  root.classList.toggle('has-bg', Boolean(u.background));
  // размытие держим отдельным классом: слой с filter стоит дорого даже при нуле
  root.classList.toggle('bg-blur', Boolean(u.background) && u.bgBlur > 0);
  return u;
}

/** Ставит фоновую картинку. Пусто — убирает. */
function applyBackground(dataUrl, doc = document) {
  const root = doc.documentElement;
  if (dataUrl) {
    root.style.setProperty('--bg-image', `url("${dataUrl}")`);
    root.classList.add('has-bg');
  } else {
    root.style.removeProperty('--bg-image');
    root.classList.remove('has-bg');
  }
}

const API = {
  PRESETS, FONTS, DENSITY, DEFAULTS,
  toRgb, toHex, luma, paletteFrom, normalize, varsFrom, applyUi, applyBackground,
};

// Обычный скрипт: объявленные через const имена в window сами не попадают
if (typeof window !== 'undefined') window.theme = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
