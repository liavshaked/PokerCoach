import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// Dependency-free raster app icons. The spade stays inside a maskable safe area.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
function insideSpade(x, y) {
  const body =
    (y >= 0.25 && y < 0.54 && Math.abs(x - 0.5) < (y - 0.25) * 0.85) ||
    ((x - 0.401) / 0.136) ** 2 + ((y - 0.505) / 0.122) ** 2 < 1 ||
    ((x - 0.599) / 0.136) ** 2 + ((y - 0.505) / 0.122) ** 2 < 1;
  const stem =
    y > 0.52 && y < 0.715 && Math.abs(x - 0.5) < 0.025 + ((y - 0.52) / 0.195) ** 2 * 0.065;
  return body || stem;
}
function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let coverage = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++)
          coverage += insideSpade((x + (dx + 0.5) / 2) / size, (y + (dy + 0.5) / 2) / size)
            ? 0.25
            : 0;
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      const background = [19, 37, 30],
        foreground = [194, 228, 186];
      for (let c = 0; c < 3; c++)
        raw[offset + c] = Math.round(background[c] * (1 - coverage) + foreground[c] * coverage);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
mkdirSync('public', { recursive: true });
for (const [name, size] of [
  ['apple-touch-icon.png', 180],
  ['pwa-192x192.png', 192],
  ['pwa-512x512.png', 512],
  ['pwa-maskable-512x512.png', 512],
])
  writeFileSync(`public/${name}`, png(size));
console.log('Generated Apple touch and PWA icons.');
