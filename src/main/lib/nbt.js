'use strict';

/*
 * Минимальный разбор и сборка NBT — формата, в котором Minecraft хранит данные.
 *
 * Нужен ровно для одного файла: servers.dat со списком серверов в игре.
 * Он лежит несжатым, поэтому распаковка не требуется. Поддержаны все типы
 * тегов, а не только строки: читать надо и чужие файлы, где может оказаться
 * что угодно, и не потерять это при обратной записи.
 *
 * Числа хранятся старшим байтом вперёд, строки — длина в два байта и UTF-8.
 */

const TAG = {
  END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6,
  BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12,
};

// ---------------- чтение ----------------

function reader(buf) {
  let at = 0;
  const need = (n) => { if (at + n > buf.length) throw new Error('файл обрывается на середине'); };

  const api = {
    get offset() { return at; },
    byte() { need(1); return buf.readInt8(at++); },
    short() { need(2); const v = buf.readInt16BE(at); at += 2; return v; },
    int() { need(4); const v = buf.readInt32BE(at); at += 4; return v; },
    long() { need(8); const v = buf.readBigInt64BE(at); at += 8; return v; },
    float() { need(4); const v = buf.readFloatBE(at); at += 4; return v; },
    double() { need(8); const v = buf.readDoubleBE(at); at += 8; return v; },
    string() {
      need(2);
      const len = buf.readUInt16BE(at); at += 2;
      need(len);
      const s = buf.toString('utf8', at, at + len); at += len;
      return s;
    },
    bytes(n) { need(n); const b = buf.subarray(at, at + n); at += n; return Buffer.from(b); },
  };
  return api;
}

function readPayload(r, type) {
  switch (type) {
    case TAG.BYTE: return r.byte();
    case TAG.SHORT: return r.short();
    case TAG.INT: return r.int();
    case TAG.LONG: return r.long();
    case TAG.FLOAT: return r.float();
    case TAG.DOUBLE: return r.double();
    case TAG.BYTE_ARRAY: return r.bytes(r.int());
    case TAG.STRING: return r.string();
    case TAG.LIST: {
      const itemType = r.byte();
      const count = r.int();
      const items = [];
      for (let i = 0; i < count; i++) items.push(readPayload(r, itemType));
      return { __list: itemType, items };
    }
    case TAG.COMPOUND: {
      const out = {};
      for (;;) {
        const t = r.byte();
        if (t === TAG.END) break;
        const name = r.string();
        out[name] = { __type: t, value: readPayload(r, t) };
      }
      return out;
    }
    case TAG.INT_ARRAY: {
      const n = r.int();
      const arr = [];
      for (let i = 0; i < n; i++) arr.push(r.int());
      return arr;
    }
    case TAG.LONG_ARRAY: {
      const n = r.int();
      const arr = [];
      for (let i = 0; i < n; i++) arr.push(r.long());
      return arr;
    }
    default: throw new Error(`неизвестный тег ${type}`);
  }
}

/** Разбирает файл NBT. @returns {{name: string, value: object}} корневой тег */
function parse(buf) {
  const r = reader(buf);
  const type = r.byte();
  if (type !== TAG.COMPOUND) throw new Error('это не файл NBT');
  const name = r.string();
  return { name, value: readPayload(r, TAG.COMPOUND) };
}

// ---------------- запись ----------------

function writer() {
  const parts = [];
  const api = {
    byte(v) { const b = Buffer.alloc(1); b.writeInt8(v); parts.push(b); },
    short(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); parts.push(b); },
    int(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); parts.push(b); },
    long(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); parts.push(b); },
    float(v) { const b = Buffer.alloc(4); b.writeFloatBE(v); parts.push(b); },
    double(v) { const b = Buffer.alloc(8); b.writeDoubleBE(v); parts.push(b); },
    string(s) {
      const t = Buffer.from(String(s), 'utf8');
      const b = Buffer.alloc(2); b.writeUInt16BE(t.length);
      parts.push(b, t);
    },
    raw(b) { parts.push(Buffer.from(b)); },
    done() { return Buffer.concat(parts); },
  };
  return api;
}

function writePayload(w, type, value) {
  switch (type) {
    case TAG.BYTE: return w.byte(value);
    case TAG.SHORT: return w.short(value);
    case TAG.INT: return w.int(value);
    case TAG.LONG: return w.long(value);
    case TAG.FLOAT: return w.float(value);
    case TAG.DOUBLE: return w.double(value);
    case TAG.BYTE_ARRAY: { w.int(value.length); return w.raw(value); }
    case TAG.STRING: return w.string(value);
    case TAG.LIST: {
      const itemType = value.__list ?? TAG.END;
      w.byte(itemType);
      w.int(value.items.length);
      for (const item of value.items) writePayload(w, itemType, item);
      return undefined;
    }
    case TAG.COMPOUND: {
      for (const [name, field] of Object.entries(value)) {
        w.byte(field.__type);
        w.string(name);
        writePayload(w, field.__type, field.value);
      }
      return w.byte(TAG.END);
    }
    case TAG.INT_ARRAY: {
      w.int(value.length);
      for (const v of value) w.int(v);
      return undefined;
    }
    case TAG.LONG_ARRAY: {
      w.int(value.length);
      for (const v of value) w.long(v);
      return undefined;
    }
    default: throw new Error(`неизвестный тег ${type}`);
  }
}

/** Собирает файл NBT обратно в байты */
function write(root) {
  const w = writer();
  w.byte(TAG.COMPOUND);
  w.string(root.name || '');
  writePayload(w, TAG.COMPOUND, root.value);
  return w.done();
}

module.exports = { TAG, parse, write };
