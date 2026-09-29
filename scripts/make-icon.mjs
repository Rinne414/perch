// Draws the app icon (build/icon.png, 256x256) without any image library:
// a dark glass tile, a mint ring, and an amber dot for "something is waiting on you".
// Run: node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const SIZE = 256
const SAMPLES = 4 // per axis, for anti-aliasing

const TOP = [36, 44, 64]
const BOTTOM = [13, 16, 25]
const RING = [110, 231, 176]
const DOT = [255, 207, 107]

const tile = (x, y) => {
  const r = 56
  const m = 8
  const cx = Math.min(Math.max(x, m + r), SIZE - m - r)
  const cy = Math.min(Math.max(y, m + r), SIZE - m - r)
  return Math.hypot(x - cx, y - cy) <= r
}
const ringAt = (x, y) => {
  const d = Math.hypot(x - 128, y - 132)
  return d <= 70 && d >= 48
}
const DOT_X = 128 + 70 * Math.cos(-Math.PI / 4) - 6
const DOT_Y = 132 + 70 * Math.sin(-Math.PI / 4) + 6
const dotAt = (x, y) => Math.hypot(x - DOT_X, y - DOT_Y) <= 22
const gapAt = (x, y) => Math.hypot(x - DOT_X, y - DOT_Y) <= 32

function pixel(px, py) {
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      const x = px + (sx + 0.5) / SAMPLES
      const y = py + (sy + 0.5) / SAMPLES
      if (!tile(x, y)) continue
      const t = y / SIZE
      let c = TOP.map((v, i) => v + (BOTTOM[i] - v) * t)
      // A faint sheen along the top edge, like light on glass.
      if (y < 40) c = c.map((v) => v + (40 - y) * 0.6)
      if (ringAt(x, y) && !gapAt(x, y)) c = RING
      if (dotAt(x, y)) c = DOT
      r += c[0]
      g += c[1]
      b += c[2]
      a += 1
    }
  }
  const n = SAMPLES * SAMPLES
  return a === 0 ? [0, 0, 0, 0] : [r / a, g / a, b / a, (a / n) * 255].map((v) => Math.round(Math.min(255, v)))
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) raw.set(pixel(x, y), y * (SIZE * 4 + 1) + 1 + x * 4)
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header[8] = 8 // bit depth
header[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png)
process.stdout.write(`build/icon.png ${png.length} bytes\n`)
