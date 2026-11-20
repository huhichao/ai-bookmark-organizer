import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZES = [16, 48, 128];
const ICONS_DIR = path.resolve('icons');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const pad = Math.max(1, Math.round(size * 0.04));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Rounded rect distance check
      const rx0 = pad + radius;
      const rx1 = size - pad - radius;
      const ry0 = pad + radius;
      const ry1 = size - pad - radius;
      const cx = Math.min(Math.max(x + 0.5, rx0), rx1);
      const cy = Math.min(Math.max(y + 0.5, ry0), ry1);
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);

      if (x + 0.5 < pad || x + 0.5 > size - pad || y + 0.5 < pad || y + 0.5 > size - pad || dist > radius) {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
        continue;
      }

      // Gradient background (#2563EB -> #4F46E5)
      const t = (x + y) / (2 * size);
      let r = Math.round(37 + (79 - 37) * t);
      let g = Math.round(99 + (70 - 99) * t);
      let b = Math.round(235 + (229 - 235) * t);

      // Draw crisp white bookmark ribbon silhouette in center
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const inRibbonBody = nx >= 0.30 && nx <= 0.70 && ny >= 0.20 && ny <= 0.78;
      const notchY = 0.78 - (0.20 - Math.abs(nx - 0.50)) * 0.75;
      if (inRibbonBody && ny <= notchY) {
        r = 255;
        g = 255;
        b = 255;
      }

      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

fs.mkdirSync(ICONS_DIR, { recursive: true });
for (const size of SIZES) {
  const out = path.join(ICONS_DIR, `icon-${size}.png`);
  fs.writeFileSync(out, drawIcon(size));
  console.log(`Generated ${out} (${size}x${size})`);
}
