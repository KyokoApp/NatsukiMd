'use strict';
// CRC-32 (IEEE 802.3) incremental implementation, used by the zip writer.
const fs = require('fs');

const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

class CRC32 {
  constructor() {
    this.crc = -1;
    this.size = 0;
  }
  update(buf) {
    let c = this.crc;
    for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    this.crc = c;
    this.size += buf.length;
    return this;
  }
  digest() {
    return (this.crc ^ -1) >>> 0;
  }
}

function crc32File(file, onProgress) {
  return new Promise((resolve, reject) => {
    const h = new CRC32();
    const stream = fs.createReadStream(file, { highWaterMark: 1 << 20 });
    stream.on('data', (chunk) => {
      h.update(chunk);
      if (onProgress) onProgress(h.size);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve({ crc: h.digest(), size: h.size }));
  });
}

function crc32Buffer(buf) {
  return new CRC32().update(buf).digest();
}

module.exports = { CRC32, crc32File, crc32Buffer };
