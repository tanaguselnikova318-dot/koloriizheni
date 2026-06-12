// Generates PWA icons using only Node.js built-ins (no extra packages)
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// CRC-32 for PNG chunks
const CRC_TABLE = new Int32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  CRC_TABLE[i] = c
}

function crc32(buf, s, e) {
  let c = -1
  for (let i = s; i < e; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(4 + 4 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out, 4, 8 + data.length), 8 + data.length)
  return out
}

function createPNG(size) {
  const cx = size / 2, cy = size / 2
  const stride = 1 + size * 4   // filter byte + RGBA per row
  const raw = Buffer.alloc(size * stride)

  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0          // filter: None
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / (size * 0.5)
      const dy = (y - cy) / (size * 0.5)
      const d  = Math.min(Math.sqrt(dx * dx + dy * dy) / 1.41, 1)

      // Indigo glow: #6366f1 centre → #0d0d1f edges
      let r = Math.round(99  * (1 - d) + 13 * d)
      let g = Math.round(102 * (1 - d) + 13 * d)
      let b = Math.round(241 * (1 - d) + 31 * d)

      // Violet shimmer top-left
      const v = Math.max(0, 0.35 - x / size * 0.5 - y / size * 0.5)
      r = Math.min(255, r + Math.round(60  * v))
      g = Math.min(255, g + Math.round(10  * v))
      b = Math.min(255, b + Math.round(30  * v))

      // Flame hotspot — bright orange blob (bottom-centre)
      const fdx = (x - cx) / (size * 0.18)
      const fdy = (y - size * 0.62) / (size * 0.22)
      const fd  = Math.sqrt(fdx * fdx + fdy * fdy)
      if (fd < 1) {
        const ft = 1 - fd
        r = Math.min(255, r + Math.round(156 * ft))
        g = Math.min(255, g + Math.round(30  * ft))
        b = Math.max(0,   b - Math.round(120 * ft))
      }

      const i = y * stride + 1 + x * 4
      raw[i] = r; raw[i+1] = g; raw[i+2] = b; raw[i+3] = 255
    }
  }

  const IHDR = Buffer.alloc(13)
  IHDR.writeUInt32BE(size, 0)
  IHDR.writeUInt32BE(size, 4)
  IHDR[8] = 8; IHDR[9] = 6   // 8-bit RGBA

  const SIG = Buffer.from([137,80,78,71,13,10,26,10])
  return Buffer.concat([SIG, chunk('IHDR', IHDR), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const dir = join(__dirname, '..', 'public', 'icons')
mkdirSync(dir, { recursive: true })

for (const size of [192, 512]) {
  writeFileSync(join(dir, `icon-${size}.png`), createPNG(size))
  console.log(`✓  icon-${size}.png`)
}
console.log('Icons ready!')
