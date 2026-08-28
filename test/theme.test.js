'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const theme = require('../src/renderer/theme.js');

describe('разбор цвета', () => {
  test('понимает короткую и длинную запись', () => {
    assert.deepEqual(theme.toRgb('#fff'), [255, 255, 255]);
    assert.deepEqual(theme.toRgb('74c045'), [116, 192, 69]);
    assert.deepEqual(theme.toRgb('#74C045'), [116, 192, 69]);
  });

  test('мусор не притворяется цветом', () => {
    for (const v of ['', null, '#12', 'красный', '#gggggg', '#1234567']) {
      assert.equal(theme.toRgb(v), null, String(v));
    }
  });
});

describe('оттенки акцента из одного цвета', () => {
  test('получается весь набор переменных', () => {
    const p = theme.paletteFrom('#74c045');
    for (const k of ['--accent', '--accent-2', '--accent-hi', '--accent-dim', '--accent-line', '--on-accent', '--glow']) {
      assert.ok(p[k], `нет ${k}`);
    }
    assert.equal(p['--accent'], '#74c045');
  });

  test('тёмный оттенок темнее исходного, светлый светлее', () => {
    const p = theme.paletteFrom('#74c045');
    const l = (hex) => theme.luma(theme.toRgb(hex));
    assert.ok(l(p['--accent-2']) < l('#74c045'), 'accent-2 должен быть темнее');
    assert.ok(l(p['--accent-hi']) > l('#74c045'), 'accent-hi должен быть светлее');
  });

  test('текст поверх акцента читается при любом цвете', () => {
    // на светлом акценте белые буквы пропадают, на тёмном — чёрные
    for (const hex of ['#ffe000', '#0b1d5c', '#74c045', '#ffffff', '#000000']) {
      const p = theme.paletteFrom(hex);
      const diff = Math.abs(theme.luma(theme.toRgb(p['--on-accent'])) - theme.luma(theme.toRgb(hex)));
      assert.ok(diff > 0.35, `${hex}: текст сливается с фоном (разница ${diff.toFixed(2)})`);
    }
  });

  test('негодный цвет откатывается к обычному, а не ломает интерфейс', () => {
    assert.equal(theme.paletteFrom('чепуха')['--accent'], theme.DEFAULTS.accent);
  });
});

describe('акцент под тему', () => {
  const l = (hex) => theme.luma(theme.toRgb(hex));

  test('на светлой теме светлый цвет притемняется — иначе подписи не видно', () => {
    for (const hex of ['#ffe000', '#8fe3a0', '#ffffff', '#a0e8ff']) {
      const got = theme.paletteFrom(hex, 'light')['--accent'];
      assert.ok(l(got) <= 0.47, `${hex} -> ${got}: слишком светлый для белого фона (${l(got).toFixed(2)})`);
    }
  });

  test('на тёмной теме тёмный цвет осветляется', () => {
    for (const hex of ['#0b1d5c', '#000000', '#2a1240']) {
      const got = theme.paletteFrom(hex, 'dark')['--accent'];
      assert.ok(l(got) >= 0.25, `${hex} -> ${got}: тонет в тёмном фоне (${l(got).toFixed(2)})`);
    }
  });

  test('оттенок при этом сохраняется — цвет остаётся тем, что выбрали', () => {
    // синий не должен стать зелёным от подгонки яркости
    const [r, g, b] = theme.toRgb(theme.paletteFrom('#0b1d5c', 'dark')['--accent']);
    assert.ok(b > r && b > g, `получилось rgb(${r}, ${g}, ${b}) — синева потерялась`);
  });

  test('нормальные цвета обе темы оставляют как есть', () => {
    assert.equal(theme.paletteFrom('#74c045', 'dark')['--accent'], '#74c045');
    assert.equal(theme.paletteFrom('#4e9c22', 'light')['--accent'], '#4e9c22');
  });

  test('заливка на светлой теме слабее — иначе выглядит грязью', () => {
    const light = theme.paletteFrom('#74c045', 'light')['--accent-dim'];
    const dark = theme.paletteFrom('#74c045', 'dark')['--accent-dim'];
    assert.ok(parseFloat(light.split(',').pop()) < parseFloat(dark.split(',').pop()));
  });
});

describe('починка настроек', () => {
  test('пустые настройки дают значения по умолчанию', () => {
    assert.deepEqual(theme.normalize({}), theme.DEFAULTS);
  });

  test('значения за пределами обрезаются', () => {
    assert.equal(theme.normalize({ radius: 999 }).radius, 20);
    assert.equal(theme.normalize({ radius: -5 }).radius, 0);
    assert.equal(theme.normalize({ bgDim: 200 }).bgDim, 92);
    assert.equal(theme.normalize({ bgBlur: -1 }).bgBlur, 0);
  });

  test('незнакомые шрифт и плотность заменяются на обычные', () => {
    assert.equal(theme.normalize({ font: 'comic-sans' }).font, 'system');
    assert.equal(theme.normalize({ density: 'огромно' }).density, 'normal');
  });

  test('нечисловое скругление не превращается в NaN', () => {
    // иначе в CSS уехало бы «NaNpx» и все углы стали бы квадратными
    assert.equal(theme.normalize({ radius: 'много' }).radius, theme.DEFAULTS.radius);
  });
});

describe('переменные для CSS', () => {
  test('скругления считаются от одного числа', () => {
    const v = theme.varsFrom({ radius: 10 });
    assert.equal(v['--r'], '10px');
    assert.equal(v['--r-sm'], '7px');
    assert.equal(v['--r-pill'], '22px');
  });

  test('плотность меняет размер шрифта и отступы', () => {
    assert.notEqual(theme.varsFrom({ density: 'compact' })['--ui-size'], theme.varsFrom({ density: 'roomy' })['--ui-size']);
    assert.equal(theme.varsFrom({ density: 'compact' })['--ui-pad'], '0.8');
  });

  test('затемнение фона уходит готовым цветом, а не процентами', () => {
    // в CSS оно подмешивается градиентом: считать color-mix на каждой
    // перерисовке дорого, поэтому цвет собирается заранее
    assert.equal(theme.varsFrom({ bgDim: 55 }, 'dark')['--bg-veil'], 'rgba(10, 11, 14, 0.55)');
  });

  test('на светлой теме фон затемняется белым, а не чёрным', () => {
    assert.match(theme.varsFrom({ bgDim: 40 }, 'light')['--bg-veil'], /^rgba\(255, 255, 255,/);
  });

  test('в наборе нет color-mix — он считался бы браузером заново', () => {
    for (const [k, v] of Object.entries(theme.varsFrom({}))) {
      assert.ok(!String(v).includes('color-mix'), `${k} = ${v}`);
    }
  });

  test('в наборе нет пустых значений — иначе CSS молча их проглотит', () => {
    for (const [k, v] of Object.entries(theme.varsFrom({}))) {
      assert.ok(v !== '' && v != null && !String(v).includes('NaN'), `${k} = ${v}`);
    }
  });
});
