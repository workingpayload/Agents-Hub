// Generates the PWA, favicon and desktop tray icons as PNGs (no image dependencies needed).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webIcons = path.resolve(here, '../public/icons');
const desktopBuild = path.resolve(here, '../../desktop/build');

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
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([header, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (v) => Math.max(0, Math.min(1, v));
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function roundedBoxDist(px, py, half, r) {
  const qx = Math.abs(px) - half + r;
  const qy = Math.abs(py) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Draws the hub mark: a central node connected to four agent nodes.
 * opts.padding shrinks the glyph (maskable icons), opts.background toggles the tile, opts.dot adds an alert dot.
 */
function render(size, opts = {}) {
  const { padding = 0, background = true, mono = false, dot = false } = opts;
  const buf = Buffer.alloc(size * size * 4);
  const s = size;
  const glyphScale = 1 - padding * 2;
  const nodes = [
    [0.5, 0.24],
    [0.76, 0.5],
    [0.5, 0.76],
    [0.24, 0.5],
  ];
  const colors = mono
    ? [[255, 255, 255], [255, 255, 255], [255, 255, 255], [255, 255, 255]]
    : [[168, 85, 247], [251, 146, 60], [52, 211, 153], [96, 165, 250]];
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / s;
      const v = (y + 0.5) / s;
      let r = 0, g = 0, b = 0, a = 0;
      const over = (cr, cg, cb, alpha) => {
        r = cr * alpha + r * (1 - alpha);
        g = cg * alpha + g * (1 - alpha);
        b = cb * alpha + b * (1 - alpha);
        a = alpha + a * (1 - alpha);
      };
      const aa = 1 / s;
      if (background) {
        const d = roundedBoxDist(u - 0.5, v - 0.5, 0.5, padding > 0 ? 0 : 0.22);
        const cov = clamp(0.5 - d / aa);
        const t = v;
        over(15 + 20 * t, 23 + 10 * t, 42 + 40 * t, cov);
      }
      const gx = (u - 0.5) / glyphScale + 0.5;
      const gy = (v - 0.5) / glyphScale + 0.5;
      const gaa = aa / glyphScale;
      for (const [nx, ny] of nodes) {
        const d = segDist(gx, gy, 0.5, 0.5, nx, ny) - 0.035;
        over(226, 232, 240, clamp(0.5 - d / gaa) * 0.85);
      }
      nodes.forEach(([nx, ny], i) => {
        const d = Math.hypot(gx - nx, gy - ny) - 0.095;
        const [cr, cg, cb] = colors[i];
        over(cr, cg, cb, clamp(0.5 - d / gaa));
      });
      const dc = Math.hypot(gx - 0.5, gy - 0.5) - 0.13;
      over(mono ? 255 : 99, mono ? 255 : 102, mono ? 255 : 241, clamp(0.5 - dc / gaa));
      const dci = Math.hypot(gx - 0.5, gy - 0.5) - 0.06;
      if (!mono) over(224, 231, 255, clamp(0.5 - dci / gaa));
      if (dot) {
        const dd = Math.hypot(u - 0.8, v - 0.2) - 0.2;
        over(239, 68, 68, clamp(0.5 - dd / aa));
      }
      const i = (y * s + x) * 4;
      buf[i] = a > 0 ? Math.round(r / a) : 0;
      buf[i + 1] = a > 0 ? Math.round(g / a) : 0;
      buf[i + 2] = a > 0 ? Math.round(b / a) : 0;
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return png(size, buf);
}

const outputs = [
  [path.join(webIcons, 'icon-192.png'), 192, {}],
  [path.join(webIcons, 'icon-512.png'), 512, {}],
  [path.join(webIcons, 'maskable-512.png'), 512, { padding: 0.12 }],
  [path.join(webIcons, 'apple-touch-icon.png'), 180, { padding: 0.04 }],
  [path.join(webIcons, 'favicon-32.png'), 32, {}],
  [path.join(webIcons, 'badge-72.png'), 72, { background: false, mono: true }],
  [path.join(desktopBuild, 'icon.png'), 512, {}],
  [path.join(desktopBuild, 'tray.png'), 32, {}],
  [path.join(desktopBuild, 'tray-alert.png'), 32, { dot: true }],
];

let wrote = 0;
for (const [file, size, opts] of outputs) {
  if (fs.existsSync(file) && !process.argv.includes('--force')) continue;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, render(size, opts));
  wrote++;
}
console.log(`icons: ${wrote} written, ${outputs.length - wrote} up to date`);
