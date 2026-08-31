'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const rules = require('../src/main/lib/crash-rules.js');

/** Настоящий кусок журнала, на котором лаунчер советовал удалить мод */
const WILD_LOG = `
[09:31:14] [main/WARN]: Error loading class: ru/metaculture/protection/vnvNNVNU (java.lang.IllegalArgumentException: Unsupported class file major version 16983)
[09:31:14] [main/ERROR]: Minecraft has crashed!
java.lang.IllegalArgumentException: Unsupported class file major version 16983
	at org.objectweb.asm.ClassReader.<init>(ClassReader.java:200)
`;

const MIXIN_LOG = `
[09:27:31] [main/ERROR]: Mixin apply for mod wild failed wild_mixins.json:ScreenMixin from mod wild -> net.minecraft.class_442: org.spongepowered.asm.mixin.transformer.throwables.InvalidMixinException @Shadow field field_22789 was not located in the target class net.minecraft.class_442.
`;

const has = (log, id) => rules.match(log).some((f) => f.id === id);

describe('мод с java-агентом', () => {
  test('опознаётся, а не выдаётся за битый файл', () => {
    assert.ok(has(WILD_LOG, 'agent-missing'), 'причина не найдена');
  });

  test('совет — проверить агента, а не удалить мод', () => {
    const found = rules.match(WILD_LOG).find((f) => f.id === 'agent-missing');
    assert.ok(found.fix.join(' ').includes('agent'), 'про файл-агент не сказано');
    assert.ok(!found.fix.join(' ').match(/удалит|удали/i), 'всё ещё советует удалять мод');
  });

  test('называет класс, на котором споткнулись', () => {
    const found = rules.match(WILD_LOG).find((f) => f.id === 'agent-missing');
    assert.match(found.detail, /ru\.metaculture\.protection/);
  });

  test('настоящая нехватка Java с этим не путается', () => {
    // 65 — это Java 21, обычная версия класса, а не зашифрованный файл
    const real = 'java.lang.UnsupportedClassVersionError: class file version 65.0';
    assert.ok(!has(real, 'agent-missing'), 'принял обычную версию Java за агента');
    assert.ok(has(real, 'java-version'));
  });
});

describe('мод не под ту версию игры', () => {
  test('опознаётся по несовпавшему полю миксина', () => {
    assert.ok(has(MIXIN_LOG, 'mixin-version'));
  });

  test('называет виноватый мод', () => {
    const found = rules.match(MIXIN_LOG).find((f) => f.id === 'mixin-version');
    assert.equal(found.detail, 'мод wild');
  });

  test('без нейросети лаунчер отвечает сам', () => {
    const answer = rules.offlineAnswer(rules.match(MIXIN_LOG), { mc: '1.21.8', loader: 'fabric' });
    assert.match(answer, /другую версию Minecraft/);
    assert.match(answer, /1\.21\.8/);
  });
});
