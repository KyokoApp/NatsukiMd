'use strict';
// Minimal ZIP writer (STORE method, no compression) with ZIP64 support.
// Written from scratch so the app needs zero npm dependencies.
// Limitations: no compression (assets are already compressed), no encryption,
// no streaming output (files are written to a temp zip on disk, then served).
//
// NOTE: we never load a whole entry into memory: each file is hashed first
// (pass 1) and then piped into the archive (pass 2), so multi-GB output
// folders are safe.

const fs = require('fs');
const path = require('path');
const { crc32File } = require('./crc32.js');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;

const U32_MAX = 0xffffffffn;
const U16_MAX = 0xffff;

function msdosDateTime(date) {
  const d = date || new Date();
  const year = Math.max(1980, d.getFullYear());
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const dateVal = ((year - 1980) << 9) | (month << 5) | day;
  return { time: time & 0xffff, date: dateVal & 0xffff };
}

/** Normalise an entry name so it can never escape the archive root. */
function safeEntryName(name) {
  const parts = String(name)
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..' && !/^[a-zA-Z]:$/.test(p));
  return parts.join('/') || 'file';
}

function concat(writer, bufs) {
  for (const b of bufs) writer.write(b);
}

class Writer {
  constructor(fd) {
    this.fd = fd;
    this.pos = 0n;
    this.pending = [];
  }
  write(buf) {
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
    this.pending.push(buf);
    this.pos += BigInt(buf.length);
    if (this.pending.length > 64) this.flush();
  }
  writeU16(v) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v >>> 0, 0);
    this.write(b);
  }
  writeU32(v) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(Number(BigInt(v) & 0xffffffffn), 0);
    this.write(b);
  }
  writeU64(v) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(v), 0);
    this.write(b);
  }
  flush() {
    for (const b of this.pending) fs.writeSync(this.fd, b);
    this.pending = [];
  }
  async pipeFile(file, onProgress) {
    this.flush();
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(file, { highWaterMark: 1 << 20 });
      rs.on('data', (chunk) => {
        fs.writeSync(this.fd, chunk);
        this.pos += BigInt(chunk.length);
        if (onProgress) onProgress(chunk.length);
      });
      rs.on('error', reject);
      rs.on('end', resolve);
    });
  }
}

/**
 * Build a zip archive.
 * @param {{src:string,name:string}[]} entries files to add (order preserved)
 * @param {string} outPath zip destination
 * @param {(p:{stage:string,index:number,total:number,bytes:number,totalBytes:number,current:string})=>void} [onProgress]
 * @param {()=>boolean} [isCanceled] return true to abort
 */
async function buildZip(entries, outPath, onProgress, isCanceled) {
  const totalBytes = entries.reduce((a, e) => a + (e.size || 0), 0);
  let bytesDone = 0;

  // pass 1 – know every size + crc before writing anything
  const prepared = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (isCanceled && isCanceled()) throw new Error('canceled');
    const st = await fs.promises.stat(e.src);
    const { crc, size } = await crc32File(e.src, (b) => {
      if (onProgress && (b % (32 << 20) < (1 << 20))) {
        onProgress({
          stage: 'hash',
          index: i + 1,
          total: entries.length,
          bytes: bytesDone + b,
          totalBytes,
          current: e.name,
        });
      }
    });
    prepared.push({ ...e, crc, size: size || st.size, mtime: st.mtime });
    bytesDone += size || st.size;
  }

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  const fd = fs.openSync(outPath, 'w');
  const w = new Writer(fd);
  const central = [];
  let wrote = 0;

  try {
    for (let i = 0; i < prepared.length; i++) {
      const e = prepared[i];
      if (isCanceled && isCanceled()) throw new Error('canceled');
      const name = safeEntryName(e.name);
      const nameBuf = Buffer.from(name, 'utf8');
      const { time, date } = msdosDateTime(e.mtime);
      const need64 = e.size > 0xffffffff || e.crc > 0xffffffff || w.pos > U32_MAX;

      const extra = [];
      if (e.size > 0xffffffff) {
        const x = Buffer.alloc(4 + 8);
        x.writeUInt16LE(0x0001, 0);
        x.writeUInt16LE(8, 2);
        x.writeBigUInt64LE(BigInt(e.size), 4);
        extra.push(x);
      }
      const extraBuf = Buffer.concat(extra);

      const localOffset = w.pos;
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(SIG_LOCAL, 0);
      lh.writeUInt16LE(need64 ? 45 : 20, 4);
      lh.writeUInt16LE(0x0800, 6); // UTF-8 names
      lh.writeUInt16LE(0, 8); // store
      lh.writeUInt16LE(time, 10);
      lh.writeUInt16LE(date, 12);
      lh.writeUInt32LE(e.crc, 14);
      lh.writeUInt32LE(e.size > 0xffffffff ? 0xffffffff : e.size, 18);
      lh.writeUInt32LE(e.size > 0xffffffff ? 0xffffffff : e.size, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      lh.writeUInt16LE(extraBuf.length, 28);
      w.write(lh);
      w.write(nameBuf);
      if (extraBuf.length) w.write(extraBuf);

      await w.pipeFile(e.src, (n) => {
        wrote += n;
        if (onProgress && wrote % (64 << 20) < (1 << 20)) {
          onProgress({
            stage: 'write',
            index: i + 1,
            total: prepared.length,
            bytes: wrote,
            totalBytes,
            current: name,
          });
        }
      });

      central.push({
        name,
        nameBuf,
        crc: e.crc,
        size: e.size,
        offset: localOffset,
        time,
        date,
        need64,
      });
    }

    const cdStart = w.pos;
    for (const c of central) {
      const extra = [];
      let sizeField = c.size;
      let offsetField = c.offset;
      if (c.need64) {
        const parts = [];
        if (c.size > 0xffffffff) parts.push({ v: BigInt(c.size), sz: 8 });
        if (c.offset > U32_MAX) parts.push({ v: BigInt(c.offset), sz: 8 });
        const len = parts.reduce((a, p) => a + p.sz, 0);
        const x = Buffer.alloc(4 + len);
        x.writeUInt16LE(0x0001, 0);
        x.writeUInt16LE(len, 2);
        let off = 4;
        for (const p of parts) {
          x.writeBigUInt64LE(p.v, off);
          off += 8;
        }
        extra.push(x);
        if (c.size > 0xffffffff) sizeField = 0xffffffff;
        if (c.offset > U32_MAX) offsetField = 0xffffffff;
      }
      const extraBuf = Buffer.concat(extra);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(SIG_CENTRAL, 0);
      ch.writeUInt16LE((3 << 8) | 45, 4); // made by unix, 4.5
      ch.writeUInt16LE(c.need64 ? 45 : 20, 6);
      ch.writeUInt16LE(0x0800, 8);
      ch.writeUInt16LE(0, 10);
      ch.writeUInt16LE(c.time, 12);
      ch.writeUInt16LE(c.date, 14);
      ch.writeUInt32LE(c.crc, 16);
      ch.writeUInt32LE(Number(BigInt(sizeField) & 0xffffffffn), 20);
      ch.writeUInt32LE(Number(BigInt(sizeField) & 0xffffffffn), 24);
      ch.writeUInt16LE(c.nameBuf.length, 28);
      ch.writeUInt16LE(extraBuf.length, 30);
      ch.writeUInt16LE(0, 32); // comment
      ch.writeUInt16LE(0, 34); // disk
      ch.writeUInt16LE(0, 36); // internal attrs
      ch.writeUInt32LE(0o644 << 16, 38); // external attrs (unix mode)
      ch.writeUInt32LE(Number(BigInt(offsetField) & 0xffffffffn), 42);
      w.write(ch);
      w.write(c.nameBuf);
      if (extraBuf.length) w.write(extraBuf);
    }
    const cdSize = w.pos - cdStart;

    const needZip64 = central.length > U16_MAX || cdSize > U32_MAX || cdStart > U32_MAX;
    if (needZip64) {
      const z64 = Buffer.alloc(56);
      z64.writeUInt32LE(SIG_EOCD64, 0);
      z64.writeBigUInt64LE(44n, 4);
      z64.writeUInt16LE((3 << 8) | 45, 12);
      z64.writeUInt16LE(45, 14);
      z64.writeUInt32LE(0, 16);
      z64.writeUInt32LE(0, 20);
      z64.writeBigUInt64LE(BigInt(central.length), 24);
      z64.writeBigUInt64LE(BigInt(central.length), 32);
      z64.writeBigUInt64LE(cdSize, 40);
      z64.writeBigUInt64LE(cdStart, 48);
      w.write(z64);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(SIG_LOCATOR64, 0);
      loc.writeUInt32LE(0, 4);
      loc.writeBigUInt64LE(w.pos - 56n, 8);
      loc.writeUInt32LE(1, 16);
      w.write(loc);
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(Math.min(central.length, U16_MAX), 8);
    eocd.writeUInt16LE(Math.min(central.length, U16_MAX), 10);
    eocd.writeUInt32LE(Number(cdSize > U32_MAX ? U32_MAX : cdSize), 12);
    eocd.writeUInt32LE(Number(cdStart > U32_MAX ? U32_MAX : cdStart), 16);
    eocd.writeUInt16LE(0, 20);
    w.write(eocd);
    w.flush();
  } finally {
    fs.closeSync(fd);
  }

  const st = await fs.promises.stat(outPath);
  return { path: outPath, size: st.size, entries: prepared.length };
}

module.exports = { buildZip, safeEntryName };
