'use strict';
/*
 * Выполняется в <head> до отрисовки. Ставит тему сразу, иначе при светлой теме
 * окно на долю секунды мигает тёмным. В localStorage лежит уже вычисленная тема
 * (dark или light) — config.json читается позже, уже после первого кадра.
 */
(function applyTheme() {
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch { /* приватный режим */ }
  document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : 'dark');
})();
