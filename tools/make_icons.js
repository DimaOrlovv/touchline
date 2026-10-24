import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const INK = [11, 17, 21], WHITE = [255, 255, 255], ACCENT = [232, 0, 64];

const pentagonR = (ang, R) => {
  const seg = (2 * Math.PI) / 5;
  const a = (((ang + Math.PI / 2) % seg) + seg) % seg - seg / 2;
  return (R * Math.cos(seg / 2)) / Math.cos(a);
};

function draw(scale = 1) {
  return (x, y, size) => {
    const cx = size / 2, cy = size / 2;
    const dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy);
    const ringR = 0.293 * size * scale;
    const ringW = 0.045 * size * scale;
    const pentR = 0.12 * size * scale;
    const spokeW = 0.035 * size * scale;
    const ang = Math.atan2(dy, dx);
    if (Math.abs(r - ringR) <= ringW / 2) return WHITE;
    if (r <= pentagonR(ang, pentR)) return ACCENT;
    for (let k = 0; k < 5; k++) {
      const dir = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
      const along = dx * Math.cos(dir) + dy * Math.sin(dir);
      const perp = Math.abs(-dx * Math.sin(dir) + dy * Math.cos(dir));
      if (along > pentR * 0.9 && along < ringR * 1.02 && perp <= spokeW / 2) return WHITE;
    }
    return INK;
  };
}

mkdirSync('icons', { recursive: true });
for (const [file, size, scale] of [
  ['icons/app-icon-192.png', 192, 1],
  ['icons/app-icon-512.png', 512, 1],
  ['icons/app-icon-maskable-512.png', 512, 0.72],
]) {
  writeFileSync(file, png(size, draw(scale)));
  console.log('→', file);
}
