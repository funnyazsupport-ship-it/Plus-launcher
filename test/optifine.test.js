'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert');

const { useTempRoot, freshRequire } = require('./helpers');

let optifine;

before(() => {
  useTempRoot();
  optifine = freshRequire('../src/main/lib/optifine.js');
});

/*
 * Сеть здесь не трогаем: проверяем разбор имён файлов. Именно на нём всё и
 * держится — из имени берутся и версия игры, и издание, и имя будущей версии.
 */
describe('имена файлов OptiFine', () => {
  const parse = (f) => {
    const m = f.match(optifine.FILE);
    return m ? { mc: m[2], edition: m[3], preview: Boolean(m[1]) } : null;
  };

  test('обычная сборка разбирается', () => {
    assert.deepEqual(parse('OptiFine_1.21.11_HD_U_J9.jar'),
      { mc: '1.21.11', edition: 'HD_U_J9', preview: false });
  });

  test('пробная сборка помечается', () => {
    assert.deepEqual(parse('preview_OptiFine_26.1.2_HD_U_K1_pre2.jar'),
      { mc: '26.1.2', edition: 'HD_U_K1_pre2', preview: true });
  });

  test('старые версии игры с буквой в номере', () => {
    assert.equal(parse('OptiFine_1.8.9_HD_U_M6.jar').mc, '1.8.9');
    assert.equal(parse('OptiFine_1.12.2_HD_U_G5.jar').edition, 'HD_U_G5');
  });

  test('посторонние файлы не принимаются за сборку', () => {
    for (const f of ['OptiFine.jar', 'forge-1.20.1-installer.jar', 'OptiFine_1.20.1.jar', '']) {
      assert.equal(parse(f), null, f);
    }
  });

  test('имя будущей версии складывается из тех же частей', () => {
    // именно его лаунчер потом ищет в папке versions
    const p = parse('OptiFine_1.21.11_HD_U_J9.jar');
    assert.equal(`${p.mc}-OptiFine_${p.edition}`, '1.21.11-OptiFine_HD_U_J9');
  });
});
