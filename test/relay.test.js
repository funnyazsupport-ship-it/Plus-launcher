'use strict';
const { test, describe, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { useTempRoot, freshRequire } = require('./helpers');

let relay, tunnel, share;
const running = [];
let dataFile;

before(() => {
  useTempRoot();
  relay = freshRequire('../server/relay.js');
  tunnel = freshRequire('../src/main/lib/tunnel.js');
  share = freshRequire('../src/main/lib/share.js');
});

beforeEach(() => {
  // учётки не должны перетекать из теста в тест
  dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-')), 'accounts.json');
});

afterEach(() => {
  tunnel.stop();
  share.stop();
  while (running.length) {
    const r = running.pop();
    try { r.close(); } catch { /* уже закрыт */ }
  }
});

/*
 * Свободный порт под будущий сервер.
 *
 * Просить порт у ядра (listen(0)) здесь нельзя: оно выдаёт его из того же
 * промежутка, откуда берутся порты исходящих соединений, и между закрытием
 * пробного сокета и настоящим прослушиванием система успевает отдать этот же
 * номер чужому соединению. На macOS так падали два теста подряд.
 * Поэтому пробуем номера из промежутка, который система сама не раздаёт.
 */
const freePort = async () => {
  for (let attempt = 0; attempt < 40; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 10000);
    const free = await new Promise((r) => {
      const s = net.createServer();
      s.once('error', () => r(false));
      s.listen(port, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (free) return port;
  }
  throw new Error('не нашлось свободного порта для теста');
};

/** «Игра»: отвечает на всё, что пришло, тем же с приставкой */
function fakeGame() {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => sock.on('data', (d) => sock.write(`эхо:${d}`)));
    srv.listen(0, '127.0.0.1', () => {
      running.push(srv);
      resolve(srv.address().port);
    });
  });
}

/** Подключается как друг и ждёт ответ */
function talk(port, text, wait = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { c.destroy(); reject(new Error('ответа нет')); }, wait);
    const c = net.connect(port, '127.0.0.1', () => c.write(text));
    c.on('data', (d) => { clearTimeout(timer); c.destroy(); resolve(String(d)); });
    c.on('error', (e) => { clearTimeout(timer); reject(e); });
    // до ответа закрыли — так выглядит отказ со стороны хозяина
    c.on('close', () => { clearTimeout(timer); reject(new Error('закрыто без ответа')); });
  });
}

/** Поднимает релей на свободных портах */
async function startRelay({ key = '', slots = 1 } = {}) {
  // порт мог занять кто-то между проверкой и запуском — пробуем другой
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await freePort();
    const pub = await freePort();
    try {
      const r = await new Promise((resolve, reject) => {
        const started = relay.start({ port, key, from: pub, to: pub + slots - 1, data: dataFile, onError: reject });
        started.server.once('listening', () => resolve(started));
      });
      running.push(r);
      return { host: '127.0.0.1', port, key, pub };
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error('релей не поднялся: все выбранные порты заняты');
}

/** Поднимает трубу и ждёт, пока она встанет или откажет */
function open(relayInfo, { nick, pass, local, pack }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('труба не ответила')), 8000);
    tunnel.start({ ...relayInfo, nick, pass, local, pack }, (st) => {
      if (!st.running && !st.error) return;
      clearTimeout(timer);
      resolve(st);
    });
  });
}

describe('учётки на релее', () => {
  test('ник заводится и получает свой постоянный порт', async () => {
    const r = await startRelay();
    const acc = await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });
    assert.equal(acc.nick, 'vanya');
    assert.equal(acc.port, r.pub);
  });

  test('занятый ник второй раз не отдаётся', async () => {
    const r = await startRelay({ slots: 2 });
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });
    await assert.rejects(
      () => tunnel.register({ ...r, nick: 'VANYA', pass: 'другой123' }),
      /занят/,
      'регистр букв не должен создавать второй такой же ник',
    );
  });

  test('короткий пароль и кривой ник не принимаются', async () => {
    const r = await startRelay();
    await assert.rejects(() => tunnel.register({ ...r, nick: 'ok', pass: 'длинныйпароль' }), /Ник/);
    await assert.rejects(() => tunnel.register({ ...r, nick: 'петя', pass: 'длинныйпароль' }), /Ник/);
    await assert.rejects(() => tunnel.register({ ...r, nick: 'petya', pass: '123' }), /Пароль/);
  });

  test('порт закреплён за ником: после перезапуска релея адрес тот же', async () => {
    const r = await startRelay();
    const acc = await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });

    running.pop().close();                       // релей перезапустили
    const again = relay.start({ port: r.port, key: r.key, from: r.pub, to: r.pub, data: dataFile });
    running.push(again);

    const found = await tunnel.lookup({ ...r, nick: 'vanya' });
    assert.equal(found.address, `127.0.0.1:${acc.port}`, 'адрес в списке серверов не должен протухать');
  });

  test('чужой ник ищется по имени, свой адрес называть не нужно', async () => {
    const r = await startRelay();
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });

    const found = await tunnel.lookup({ ...r, nick: 'Vanya' });
    assert.equal(found.nick, 'vanya');
    assert.equal(found.online, false, 'мир ещё не открыт');

    await assert.rejects(() => tunnel.lookup({ ...r, nick: 'кого-нет' }), /нет/);
  });

  test('«в сети» значит «мир открыт», а не «лаунчер запущен»', async () => {
    const r = await startRelay();
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });
    await open(r, { nick: 'vanya', pass: 'секрет123', local: 1 });

    // лаунчер на связи, но мир ещё не открыли: заходить некуда
    let found = await tunnel.lookup({ ...r, nick: 'vanya' });
    assert.equal(found.connected, true);
    assert.equal(found.online, false, 'иначе друг стучится туда, где его некому встретить');

    tunnel.setWorld(true);
    await new Promise((res) => setTimeout(res, 100));
    found = await tunnel.lookup({ ...r, nick: 'vanya' });
    assert.equal(found.online, true);

    tunnel.setWorld(false);
    await new Promise((res) => setTimeout(res, 100));
    found = await tunnel.lookup({ ...r, nick: 'vanya' });
    assert.equal(found.online, false, 'игру закрыли — снова не в сети');
  });

  test('сборка, не умеющая сообщать про мир, всё равно видна в сети', async () => {
    const r = await startRelay();
    const acc = await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });

    // так выглядит старый лаунчер: поздоровался и молчит про мир
    const sock = net.connect(r.port, '127.0.0.1');
    await new Promise((res, rej) => {
      sock.on('connect', () => sock.write(`${JSON.stringify({ t: 'hello', key: r.key, nick: 'vanya', pass: 'секрет123' })}\n`));
      sock.once('data', () => res());
      sock.on('error', rej);
      setTimeout(() => rej(new Error('молчит')), 5000);
    });
    running.push({ close: () => sock.destroy() });

    const found = await tunnel.lookup({ ...r, nick: 'vanya' });
    assert.equal(found.address, `127.0.0.1:${acc.port}`);
    assert.equal(found.online, true, 'иначе у старой сборки кнопка «играть» не загорится никогда');
  });

  test('вход проверяет пароль, а не только наличие ника', async () => {
    const r = await startRelay();
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });

    const acc = await tunnel.auth({ ...r, nick: 'VANYA', pass: 'секрет123' });
    assert.equal(acc.nick, 'vanya');

    // иначе зайти можно было бы под кем угодно, зная один только ник
    await assert.rejects(() => tunnel.auth({ ...r, nick: 'vanya', pass: 'мимо' }), /пароль/i);
    await assert.rejects(() => tunnel.auth({ ...r, nick: 'vanya', pass: '' }), /пароль/i);
    await assert.rejects(() => tunnel.auth({ ...r, nick: 'чужак', pass: 'секрет123' }), /нет/i);
  });

  test('без ключа сервера учётку не завести', async () => {
    const r = await startRelay({ key: 'ключ-сервера' });
    await assert.rejects(
      () => tunnel.register({ ...r, key: 'не тот', nick: 'vanya', pass: 'секрет123' }),
      /ключ/i,
    );
  });
});

describe('сборка друга', () => {
  const pack = {
    format: 'plus.modpack', formatVersion: 2, name: 'Техномагия', mc: '1.20.1',
    loader: 'fabric', loaderVersion: '0.15.11', mods: [{ id: 'sodium' }], bundled: [],
  };

  test('чем играет хозяин, видно по нику ещё до захода', async () => {
    const r = await startRelay();
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });
    await open(r, { nick: 'vanya', pass: 'секрет123', local: 1, pack });

    const found = await tunnel.lookup({ ...r, nick: 'vanya' });
    assert.equal(found.pack.name, 'Техномагия');
    assert.equal(found.pack.mc, '1.20.1');
    assert.equal(found.pack.mods, 1, 'в списке показываем только счётчик, не сами моды');
  });

  test('сборка забирается целиком и переживает перезапуск релея', async () => {
    const r = await startRelay();
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });
    await open(r, { nick: 'vanya', pass: 'секрет123', local: 1, pack });
    tunnel.stop();

    running.pop().close();
    running.push(relay.start({ port: r.port, key: r.key, from: r.pub, to: r.pub, data: dataFile }));

    const got = await tunnel.pack({ ...r, nick: 'vanya' });
    assert.equal(got.name, 'Техномагия');
    assert.equal(got.loader, 'fabric');
    assert.deepEqual(got.mods, pack.mods);
  });

  test('файлы модов по этой дороге не ездят', async () => {
    const r = await startRelay();
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });
    // хозяин мог прислать список вложенных файлов — самих файлов у нас нет,
    // и обещать другу то, чего не будет, нельзя
    await open(r, { nick: 'vanya', pass: 'секрет123', local: 1, pack: { ...pack, bundled: [{ file: 'my.jar' }] } });

    const got = await tunnel.pack({ ...r, nick: 'vanya' });
    assert.deepEqual(got.bundled, []);
  });

  test('без сборки друг получает понятный отказ, а не пустоту', async () => {
    const r = await startRelay();
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });
    await assert.rejects(() => tunnel.pack({ ...r, nick: 'vanya' }), /не поделился/);
  });

  test('раздутая сборка не попадает в файл учёток', async () => {
    const r = await startRelay();
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });
    const huge = { ...pack, mods: Array.from({ length: 400 }, (_, i) => ({ id: `x${i}`.padEnd(600, 'y') })) };
    await open(r, { nick: 'vanya', pass: 'секрет123', local: 1, pack: huge });

    // связь при этом рваться не должна: не пустить друзей из-за списка модов было бы глупо
    assert.equal(tunnel.state().running, true);
    await assert.rejects(() => tunnel.pack({ ...r, nick: 'vanya' }), /не поделился/);
  });
});

describe('труба до релея', () => {
  test('друг доходит до игры, зная только ник', async () => {
    const gamePort = await fakeGame();
    const local = await freePort();
    await share.start(local);
    share.setTarget(gamePort);

    const r = await startRelay({ key: 'ключ-сервера' });
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });

    const st = await open(r, { nick: 'vanya', pass: 'секрет123', local });
    assert.equal(st.running, true, st.error || '');
    tunnel.setWorld(true);                 // в игре нажали «Открыть для сети»
    await new Promise((res) => setTimeout(res, 100));

    // друг спрашивает адрес по нику — руками его никто не вводил
    const found = await tunnel.lookup({ ...r, nick: 'vanya' });
    assert.equal(found.online, true);
    assert.equal(found.address, st.address);

    const [, port] = found.address.split(':');
    assert.equal(await talk(Number(port), 'привет'), 'эхо:привет');
  });

  test('с неверным паролем труба не поднимается', async () => {
    const r = await startRelay();
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });

    const st = await open(r, { nick: 'vanya', pass: 'мимо', local: 1 });
    assert.equal(st.running, false);
    assert.match(st.error, /пароль/i);
  });

  test('незнакомый ник не пускается', async () => {
    const r = await startRelay();
    const st = await open(r, { nick: 'чужак', pass: 'секрет123', local: 1 });
    assert.equal(st.running, false);
    assert.match(st.error, /нет/i);
  });

  test('второй друг не мешает первому', async () => {
    const gamePort = await fakeGame();
    const local = await freePort();
    await share.start(local);
    share.setTarget(gamePort);

    const r = await startRelay();
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });
    const st = await open(r, { nick: 'vanya', pass: 'секрет123', local });

    const port = Number(st.address.split(':')[1]);
    const [a, b] = await Promise.all([talk(port, 'раз'), talk(port, 'два')]);
    assert.equal(a, 'эхо:раз');
    assert.equal(b, 'эхо:два');
  });

  test('пока мир не открыт, друг не висит без ответа', async () => {
    const local = await freePort();
    await share.start(local);            // цель не задана — мир закрыт

    const r = await startRelay();
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });
    const st = await open(r, { nick: 'vanya', pass: 'секрет123', local });

    // отказ должен прийти сразу, а не после долгого ожидания:
    // иначе в игре это выглядит как вечное «Connecting…»
    const port = Number(st.address.split(':')[1]);
    await assert.rejects(() => talk(port, 'кто там', 1500), /закрыто без ответа|ECONNRESET|EPIPE/);
  });

  test('после ухода хозяина порт освобождается', async () => {
    const r = await startRelay();
    await tunnel.register({ ...r, nick: 'vanya', pass: 'секрет123' });
    await open(r, { nick: 'vanya', pass: 'секрет123', local: 1 });

    tunnel.stop();

    // порт должен вернуться в оборот — иначе после перезапуска игры не зайти
    const freed = await new Promise((resolve) => {
      let left = 30;
      const tick = () => {
        const s = net.createServer();
        s.once('error', () => { left -= 1; left ? setTimeout(tick, 100) : resolve(false); });
        s.listen(r.pub, '0.0.0.0', () => s.close(() => resolve(true)));
      };
      tick();
    });
    assert.equal(freed, true);
  });
});
