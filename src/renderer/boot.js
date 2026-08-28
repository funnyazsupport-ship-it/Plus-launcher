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

/*
 * То же самое для оформления: цвет, скругления, шрифт. Без этого окно сначала
 * рисуется зелёным и только потом перекрашивается в выбранный цвет — заметно.
 * Здесь только уже посчитанные переменные, разбор настроек делает theme.js.
 */
(function applyUi() {
  let raw = null;
  try { raw = localStorage.getItem('ui-vars'); } catch { /* приватный режим */ }
  if (raw) {
    try {
      const vars = JSON.parse(raw);
      for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
    } catch { /* испорчено — нарисуем обычным, настройки применятся чуть позже */ }
  }
  // переходы отключаются классом: успеть до отрисовки важнее всего именно здесь,
  // иначе окно один раз проедет анимацией, которую человек как раз и выключил
  try {
    if (localStorage.getItem('ui-anim') === 'off') document.documentElement.classList.add('no-anim');
  } catch { /* приватный режим */ }
})();
