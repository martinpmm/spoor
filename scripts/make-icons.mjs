// Generates the extension icons (no dependencies): a rounded square with a "record" dot and a trail.
// Usage: node scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'extension', 'public', 'icon');

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Supersampled shape coverage for smooth edges.
function coverage(fn, x, y, size, n = 4) {
  let c = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) if (fn(x - 0.5 + (i + 0.5) / n, y - 0.5 + (j + 0.5) / n, size)) c++;
  return c / (n * n);
}
const roundedSquare = (x, y, s) => {
  const r = s * 0.22;
  const cx = Math.min(Math.max(x, r), s - r);
  const cy = Math.min(Math.max(y, r), s - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const dot = (x, y, s) => (x - s * 0.62) ** 2 + (y - s * 0.5) ** 2 <= (s * 0.2) ** 2;
const trail = (x, y, s) => {
  const dots = [
    [0.22, 0.5, 0.055],
    [0.34, 0.5, 0.075],
  ];
  return dots.some(([cx, cy, r]) => (x - s * cx) ** 2 + (y - s * cy) ** 2 <= (s * r) ** 2);
};

const BG = [194, 65, 12];
const FG = [255, 255, 255];
fs.mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const buf = png(size, (x, y) => {
    const bg = coverage(roundedSquare, x, y, size);
    if (!bg) return [0, 0, 0, 0];
    const fg = Math.max(coverage(dot, x, y, size), coverage(trail, x, y, size) * 0.85);
    const mix = (i) => Math.round(BG[i] * (1 - fg) + FG[i] * fg);
    return [mix(0), mix(1), mix(2), Math.round(255 * bg)];
  });
  fs.writeFileSync(path.join(OUT, `${size}.png`), buf);
}
console.log(`icons written to ${OUT}`);
