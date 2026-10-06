// Generates the PWA icons (PNG + SVG) procedurally: a little aurora of glyph blocks.
// No third-party art. Run with: npm run icons
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 9; // cells per side
function cellValue(cx, cy) {
  const x = cx / (N - 1), y = cy / (N - 1);
  const edge = 0.62 + 0.12 * Math.sin(x * 5.2 + 0.6) + 0.05 * Math.sin(x * 11);
  const d = edge - y;
  const curtain = d < 0 ? Math.exp(d * 14) : Math.exp(-d * 2.4);
  const ray = 0.55 + 0.45 * Math.sin(x * 17 + 1.3) ** 2;
  return Math.min(1, curtain * ray * 1.15);
}
function color(v, y) {
  // violet high up, green at the curtain's lower edge
  const t = Math.min(1, Math.max(0, y));
  const g = [93, 255, 168], p = [154, 79, 208];
  const c = g.map((gv, i) => gv * t + p[i] * (1 - t));
  return c.map((cv) => Math.round(cv * v));
}

function png(size) {
  const px = new Uint8Array(size * size * 4);
  const cell = size / N;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      px[i] = 1; px[i + 1] = 3; px[i + 2] = 9; px[i + 3] = 255;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const lx = x / cell - cx, ly = y / cell - cy;
      const v = cellValue(cx, cy);
      // Each cell is a block glyph sized by brightness, with a small gutter.
      const s = 0.12 + 0.78 * v;
      const m = (1 - s) / 2;
      if (v > 0.06 && lx > m && lx < 1 - m && ly > m && ly < 1 - m) {
        const [r, g, b] = color(0.35 + 0.65 * v, cy / (N - 1));
        px[i] = r; px[i + 1] = g; px[i + 2] = b;
      }
    }
  }
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    raw.set(px.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), Buffer.from(data)]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return c ^ -1;
}

function svg() {
  const cell = 64 / N;
  let rects = '';
  for (let cy = 0; cy < N; cy++) {
    for (let cx = 0; cx < N; cx++) {
      const v = cellValue(cx, cy);
      if (v <= 0.06) continue;
      const s = (0.12 + 0.78 * v) * cell;
      const [r, g, b] = color(0.35 + 0.65 * v, cy / (N - 1));
      rects += `<rect x="${(cx * cell + (cell - s) / 2).toFixed(2)}" y="${(cy * cell + (cell - s) / 2).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" fill="rgb(${r},${g},${b})"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#010309"/>${rects}</svg>\n`;
}

writeFileSync('public/icon-192.png', png(192));
writeFileSync('public/icon-512.png', png(512));
writeFileSync('public/icon.svg', svg());
console.log('icons written');
