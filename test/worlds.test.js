'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const nbt = require('../src/main/lib/nbt');
const worlds = require('../src/main/lib/worlds');

/** level.dat, как его пишет игра: gzip поверх NBT с разделом Data */
function makeLevel(dir, name) {
  const root = {
    name: '',
    value: {
      Data: {
        __type: nbt.TAG.COMPOUND,
        value: {
          LevelName: { __type: nbt.TAG.STRING, value: name },
          RandomSeed: { __type: nbt.TAG.LONG, value: -8123456789012345678n },
          SpawnX: { __type: nbt.TAG.INT, value: -412 },
          BorderSize: { __type: nbt.TAG.DOUBLE, value: 59999968.0 },
          hardcore: { __type: nbt.TAG.BYTE, value: 1 },
          ServerBrands: {
            __type: nbt.TAG.LIST,
            value: { __list: nbt.TAG.STRING, items: ['fabric', 'vanilla'] },
          },
          WanderingTraderId: { __type: nbt.TAG.INT_ARRAY, value: [1, 2, 3, 4] },
        },
      },
      DataVersion: { __type: nbt.TAG.INT, value: 3953 },
    },
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'level.dat'), zlib.gzipSync(nbt.write(root)));
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plus-worlds-'));

test('название мира', async (t) => {
  await t.test('читается из level.dat', () => {
    const dir = path.join(tmp(), 'Мир');
    makeLevel(dir, 'Наш мир');
    assert.equal(worlds.levelName(dir), 'Наш мир');
  });

  await t.test('папка без level.dat названия не даёт', () => {
    assert.equal(worlds.levelName(tmp()), null);
  });

  await t.test('переписывается, остальные поля переживают запись', () => {
    const dir = path.join(tmp(), 'Мир');
    makeLevel(dir, 'Старое');
    worlds.setLevelName(dir, 'Новое имя');

    assert.equal(worlds.levelName(dir), 'Новое имя');

    // важное: переписав одно поле, мы не должны потерять всё остальное
    const buf = zlib.gunzipSync(fs.readFileSync(path.join(dir, 'level.dat')));
    const data = nbt.parse(buf).value.Data.value;
    assert.equal(data.RandomSeed.value, -8123456789012345678n);
    assert.equal(data.SpawnX.value, -412);
    assert.equal(data.BorderSize.value, 59999968.0);
    assert.equal(data.hardcore.value, 1);
    assert.deepEqual(data.ServerBrands.value.items, ['fabric', 'vanilla']);
    assert.deepEqual(data.WanderingTraderId.value, [1, 2, 3, 4]);
  });

  await t.test('прежний файл остаётся рядом копией', () => {
    const dir = path.join(tmp(), 'Мир');
    makeLevel(dir, 'Старое');
    worlds.setLevelName(dir, 'Новое');

    const bak = zlib.gunzipSync(fs.readFileSync(path.join(dir, 'level.dat.plus-bak')));
    assert.equal(nbt.parse(bak).value.Data.value.LevelName.value, 'Старое');
  });

  await t.test('мир без раздела с названием не трогаем', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'level.dat'), zlib.gzipSync(nbt.write({ name: '', value: {} })));
    assert.throws(() => worlds.setLevelName(dir, 'Что-то'), /названием/);
  });
});

test('имя папки мира', async (t) => {
  await t.test('кириллицу оставляем как есть', () => {
    assert.equal(worlds.safeFolder('Мой мир'), 'Мой мир');
  });

  await t.test('запрещённые в именах файлов символы заменяются', () => {
    assert.equal(worlds.safeFolder('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
  });

  await t.test('точка в конце убирается — Windows такое имя не хранит', () => {
    assert.equal(worlds.safeFolder('мир...'), 'мир');
  });

  await t.test('выход наверх невозможен', () => {
    // «..» превратилось бы в путь к соседней папке
    assert.throws(() => worlds.safeFolder('..'), /не подойдёт/);
    assert.throws(() => worlds.safeFolder('   '), /не подойдёт/);
    // разделители пути пропадают, подняться на уровень выше уже нечем
    assert.equal(worlds.safeFolder('../../saves'), '..-..-saves');
  });

  await t.test('длинное имя обрезается', () => {
    assert.equal(worlds.safeFolder('м'.repeat(200)).length, 60);
  });
});
