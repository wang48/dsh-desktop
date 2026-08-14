// 生成 build/icon.png —— 256x256 应用图标（渐变圆角方块 + 白色 "D"），纯 Node 实现，无第三方依赖
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 256
const RADIUS = 56

// ---------- PNG 基础设施 ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- 形状 ----------
// 圆角矩形覆盖度（点与内部矩形裁剪后的距离 <= r 则为内部）
function roundedRectCoverage(x, y, size, r) {
  const cx = Math.min(Math.max(x, r), size - r)
  const cy = Math.min(Math.max(y, r), size - r)
  const dx = x - cx
  const dy = y - cy
  return Math.hypot(dx, dy) <= r ? 1 : 0
}

// "D" 字形覆盖度：左竖条 + 右侧半圆环
function glyphDCoverage(x, y) {
  let cover = 0
  if (x >= 60 && x <= 94 && y >= 66 && y <= 190) cover = 1
  if (x >= 106 && y >= 52 && y <= 204) {
    const d = Math.hypot(x - 106, y - 128)
    if (d >= 44 && d <= 76) cover = Math.max(cover, 1)
  }
  return cover
}

// ---------- 逐像素绘制（2x2 超采样抗锯齿） ----------
const rgba = Buffer.alloc(SIZE * SIZE * 4)
const top = [37, 99, 235]    // #2563eb
const bottom = [7, 26, 77]   // #071a4d

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let bgCover = 0
    let glyphCover = 0
    for (const oy of [0.25, 0.75]) {
      for (const ox of [0.25, 0.75]) {
        const x = px + ox
        const y = py + oy
        bgCover += roundedRectCoverage(x, y, SIZE, RADIUS)
        glyphCover += glyphDCoverage(x, y)
      }
    }
    bgCover /= 4
    glyphCover /= 4
    if (bgCover <= 0) continue

    // 背景：垂直渐变 + 顶部轻微提亮
    const t = py / SIZE
    let r = top[0] + (bottom[0] - top[0]) * t
    let g = top[1] + (bottom[1] - top[1]) * t
    let b = top[2] + (bottom[2] - top[2]) * t
    const highlight = Math.max(0, 1 - t * 1.6) * 26
    r += highlight; g += highlight; b += highlight

    // 前景白色 D 与背景混合
    const idx = (py * SIZE + px) * 4
    rgba[idx] = Math.round(r + (255 - r) * glyphCover)
    rgba[idx + 1] = Math.round(g + (255 - g) * glyphCover)
    rgba[idx + 2] = Math.round(b + (255 - b) * glyphCover)
    rgba[idx + 3] = Math.round(255 * bgCover)
  }
}

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, encodePng(rgba, SIZE, SIZE))
console.log(`icon written: ${outPath}`)
