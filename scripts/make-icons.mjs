// アプリのアイコン(PNG)を作る。依存なし: 図形を描いて、zlib で PNG に書き出す。
// 使い方: node scripts/make-icons.mjs   → public/icons/ に出力
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const BG = [42, 120, 214];
const BOWL = [255, 255, 255];
const RICE = [249, 249, 247];
const STEAM = [27, 175, 122];

/** 座標 (x, y) は 0〜1。maskable のときは図形を小さめにして安全領域に収める */
function colorAt(x, y, maskable, rounded) {
  const s = maskable ? 0.78 : 1;
  const cx = 0.5;
  const u = (x - cx) / s + cx;
  const v = (y - 0.5) / s + 0.5;
  // 背景(角丸。maskable と apple-touch-icon は全面)
  if (rounded) {
    const r = 0.22;
    const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
    const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
    if (dx * dx + dy * dy > r * r) return null;
  }
  // 茶わん(下半分の円)
  const by = 0.52;
  const br = 0.3;
  const inBowl = v >= by && (u - cx) ** 2 + (v - by) ** 2 <= br * br;
  // 高台
  const inFoot = v >= 0.8 && v <= 0.86 && Math.abs(u - cx) <= 0.1;
  // ごはん(上の楕円)
  const inRice = v < by + 0.005 && ((u - cx) / 0.27) ** 2 + ((v - by) / 0.16) ** 2 <= 1;
  // 湯気(緑の点3つ)
  const steam = [
    [0.4, 0.25],
    [0.5, 0.2],
    [0.6, 0.25],
  ].some(([sx, sy]) => (u - sx) ** 2 + (v - sy) ** 2 <= 0.028 ** 2);
  if (inBowl || inFoot) return BOWL;
  if (inRice) return RICE;
  if (steam) return STEAM;
  return BG;
}

function render(size, { maskable = false, rounded = false } = {}) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = colorAt((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, maskable, rounded);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 255;
          }
        }
      }
      const n = ss * ss;
      const i = (py * size + px) * 4;
      const cover = a / 255;
      buf[i] = cover ? Math.round(r / cover) : 0;
      buf[i + 1] = cover ? Math.round(g / cover) : 0;
      buf[i + 2] = cover ? Math.round(b / cover) : 0;
      buf[i + 3] = Math.round(a / n);
    }
  }
  return png(size, buf);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/apple-touch-icon-180.png', render(180));
writeFileSync('public/icons/icon-192.png', render(192, { rounded: true }));
writeFileSync('public/icons/icon-512.png', render(512, { rounded: true }));
writeFileSync('public/icons/icon-512-maskable.png', render(512, { maskable: true }));
console.log('public/icons/ にアイコンを書き出しました');
