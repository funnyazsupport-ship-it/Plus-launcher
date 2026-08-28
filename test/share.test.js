'use strict';
const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const net = require('net');

const { useTempRoot, freshRequire } = require('./helpers');

let share;

before(() => {
  useTempRoot();
  share = freshRequire('../src/main/lib/share.js');
});

afterEach(() => share.stop());

/** Поднимает «игру»: отвечает на всё, что пришло, тем же с приставкой */
function fakeGame() {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      sock.on('data', (d) => sock.write(`эхо:${d}`));
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/** Подключается к перенаправителю и ждёт ответ */
function talk(port, text) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { c.destroy(); reject(new Error('ответа нет')); }, 4000);
    const c = net.connect(port, '127.0.0.1', () => c.write(text));
    c.on('data', (d) => { clearTimeout(timer); c.destroy(); resolve(String(d)); });
    c.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

const freePort = () => new Promise((r) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

describe('порт открытого мира из журнала игры', () => {
  test('обе формулировки Minecraft понимаются', () => {
    assert.equal(share.lanPortFrom('[Server thread/INFO]: Local game hosted on port 54321'), 54321);
    assert.equal(share.lanPortFrom('[Server thread/INFO]: Started serving on 25566'), 25566);
  });

  test('посторонние строки не принимаются за порт', () => {
    for (const line of ['Loading Sodium', 'port', '', null, 'hosted on port abc']) {
      assert.equal(share.lanPortFrom(line), null, String(line));
    }
  });

  test('несуществующий номер порта отбрасывается', () => {
    assert.equal(share.lanPortFrom('Local game hosted on port 999999'), null);
  });
});

describe('перенаправитель до игры', () => {
  test('переливает данные в обе стороны', async () => {
    const game = await fakeGame();
    const port = await freePort();

    await share.start(port);
    share.setTarget(game.port);

    const answer = await talk(port, 'привет');
    assert.equal(answer, 'эхо:привет');

    game.srv.close();
  });

  test('пока мир не открыт, подключение просто закрывается', async () => {
    const port = await freePort();
    await share.start(port);              // цель не задана

    await assert.rejects(() => talk(port, 'кто там'), /ответа нет|ECONNRESET|EPIPE/);
  });

  test('после смены порта мира соединения идут в новый', async () => {
    const first = await fakeGame();
    const second = await fakeGame();
    const port = await freePort();

    await share.start(port);
    share.setTarget(first.port);
    assert.equal(await talk(port, 'раз'), 'эхо:раз');

    // игру перезапустили — порт мира стал другим
    share.setTarget(second.port);
    assert.equal(await talk(port, 'два'), 'эхо:два');

    first.srv.close();
    second.srv.close();
  });

  test('слушает только свою машину', async () => {
    /*
     * Труба до сервера друзей подключается через 127.0.0.1. Слушать все сетевые
     * платы значило бы пустить в мир всю местную сеть мимо выключателя
     * «пускать друзей» — а он проверяется именно здесь.
     */
    const game = await fakeGame();
    const st = await share.start(0);
    share.setTarget(game.port);

    const outside = Object.values(require('os').networkInterfaces()).flat()
      .find((i) => i.family === 'IPv4' && !i.internal);
    if (!outside) return;                     // одна петля — снаружи и так не достучаться

    await assert.rejects(
      () => new Promise((res, rej) => {
        const c = net.connect(st.port, outside.address);
        c.on('connect', () => { c.destroy(); res(); });
        c.on('error', rej);
        setTimeout(() => { c.destroy(); rej(new Error('не достучались')); }, 2000);
      }),
      /ECONNREFUSED|не достучались|ETIMEDOUT/,
      'порт виден из местной сети',
    );
    game.srv.close();
  });

  test('порт 0 — любой свободный, и он не спорит с занятым 25565', async () => {
    const game = await fakeGame();
    const busy = net.createServer();
    const port = await freePort();
    await new Promise((r) => busy.listen(port, '0.0.0.0', r));

    // так работает связь через сервер друзей: свой порт неважен
    const st = await share.start(0);
    assert.ok(st.port > 0, 'система должна была выдать настоящий порт, а не 0');
    assert.notEqual(st.port, port);

    share.setTarget(game.port);
    assert.equal(await talk(st.port, 'привет'), 'эхо:привет');

    busy.close();
    game.srv.close();
  });

  test('занятый порт даёт понятную ошибку, а не молчание', async () => {
    const busy = net.createServer();
    const port = await freePort();
    // занимаем ту же петлю: перенаправитель слушает только её, и с чужой
    // сетевой платой он бы не столкнулся
    await new Promise((r) => busy.listen(port, '127.0.0.1', r));

    await assert.rejects(() => share.start(port), /уже занят/);
    busy.close();
  });

  test('остановка закрывает порт — его можно занять снова', async () => {
    const port = await freePort();
    await share.start(port);
    assert.equal(share.state().running, true);

    share.stop();
    assert.equal(share.state().running, false);

    // если бы порт остался занят, второй запуск не прошёл бы
    await share.start(port);
    assert.equal(share.state().running, true);
  });
});
