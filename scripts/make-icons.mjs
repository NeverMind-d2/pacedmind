// Draws the Organizer logo (the sidebar's indigo square with a dark "O") and writes the icon files:
//   desktop/icon.ico, desktop/icon.png  – app, window, tray and shortcut icon
//   src/app/favicon.ico                 – browser tab
// Run with: npm run icons
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");

const TOP = [154, 157, 248];
const BOTTOM = [122, 125, 236];
const RING = [10, 10, 14];

function insideRoundedRect(x, y, lo, hi, r) {
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + r), hi - r);
  const cy = Math.min(Math.max(y, lo + r), hi - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

/** RGBA pixels, drawn with 8×8 supersampling so small sizes stay smooth. */
function render(size) {
  const ss = 8;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let inRect = 0;
      let inRing = 0;
      let ySum = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          if (!insideRoundedRect(x, y, 0.03, 0.97, 0.22)) continue;
          inRect++;
          ySum += y;
          const d = Math.hypot(x - 0.5, y - 0.5);
          if (d <= 0.27 && d >= 0.155) inRing++;
        }
      }
      if (!inRect) continue;
      const t = ySum / inRect;
      const f = inRing / inRect;
      const o = (py * size + px) * 4;
      for (let i = 0; i < 3; i++) {
        const bg = TOP[i] + (BOTTOM[i] - TOP[i]) * t;
        out[o + i] = Math.round(bg * (1 - f) + RING[i] * f);
      }
      out[o + 3] = Math.round((255 * inRect) / (ss * ss));
    }
  }
  return out;
}

function png(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A 32-bit BMP icon image (bottom-up BGRA plus an AND mask), the most compatible form for small sizes. */
function bmp(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4, 20);
  const pixels = Buffer.alloc(size * size * 4);
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size);
  for (let y = 0; y < size; y++) {
    const srcRow = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const s = (srcRow * size + x) * 4;
      const d = (y * size + x) * 4;
      pixels[d] = rgba[s + 2];
      pixels[d + 1] = rgba[s + 1];
      pixels[d + 2] = rgba[s];
      pixels[d + 3] = rgba[s + 3];
      if (rgba[s + 3] === 0) mask[y * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, pixels, mask]);
}

function ico(sizes) {
  const images = sizes.map((size) => {
    const rgba = render(size);
    return { size, data: size >= 128 ? png(size, rgba) : bmp(size, rgba) };
  });
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = head.length + dir.length;
  images.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([head, dir, ...images.map((im) => im.data)]);
}

const write = (rel, data) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`wrote ${rel} (${data.length} bytes)`);
};

write("desktop/icon.ico", ico([16, 20, 24, 32, 40, 48, 64, 128, 256]));
write("desktop/icon.png", png(256, render(256)));
write("src/app/favicon.ico", ico([16, 32, 48]));
