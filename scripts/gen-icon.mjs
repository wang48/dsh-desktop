// 生成 build/icon.png —— 512x512 应用图标（黑灰白单色：深灰圆角方块 + 灰色描边 + 白色 "D"，Ollama 式极简），
// 纯 Node 实现，无第三方依赖
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 512
const RADIUS = 112
const S = SIZE / 256 // 256 基准设计坐标的缩放系数

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

// "D" 字形覆盖度：左竖条 + 右侧半圆环（坐标按 256 基准设计，乘以 S 缩放）。
// 几何：竖条 71–105，圆环圆心 (117,128)（外半径 76、内半径 44、右半侧），
// 组合质心落在 256 瓦片中心 x=128 上，视觉居中。
function glyphDCoverage(x, y) {
  const bx = x / S
  const by = y / S
  let cover = 0
  if (bx >= 71 && bx <= 105 && by >= 66 && by <= 190) cover = 1
  if (bx >= 117 && by >= 52 && by <= 204) {
    const d = Math.hypot(bx - 117, by - 128)
    if (d >= 44 && d <= 76) cover = Math.max(cover, 1)
  }
  return cover
}

// 圆角描边环：在外轮廓之内、向内收缩 t 之后的内轮廓之外的区域
function roundedRectRing(x, y, size, r, t) {
  const outer = roundedRectCoverage(x, y, size, r)
  const inner = roundedRectCoverage(x - t, y - t, size - 2 * t, r - t)
  return Math.max(0, outer - inner)
}

// ---------- 逐像素绘制（2x2 超采样抗锯齿） ----------
const rgba = Buffer.alloc(SIZE * SIZE * 4)
const RING_T = 2 * S // 描边宽度（256 基准 2 单位 → 512px 下 4px）
const bg = [16, 16, 16] // 深灰底
const ring = [64, 64, 64] // 灰色描边

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let bgCover = 0
    let glyphCover = 0
    let ringCover = 0
    for (const oy of [0.25, 0.75]) {
      for (const ox of [0.25, 0.75]) {
        const x = px + ox
        const y = py + oy
        bgCover += roundedRectCoverage(x, y, SIZE, RADIUS)
        glyphCover += glyphDCoverage(x, y)
        ringCover += roundedRectRing(x, y, SIZE, RADIUS, RING_T)
      }
    }
    bgCover /= 4
    glyphCover /= 4
    ringCover /= 4
    if (bgCover <= 0) continue

    // 深灰底 → 灰描边 → 白色 D 依次叠加
    const idx = (py * SIZE + px) * 4
    let r = bg[0] + (ring[0] - bg[0]) * ringCover
    let g = bg[1] + (ring[1] - bg[1]) * ringCover
    let b = bg[2] + (ring[2] - bg[2]) * ringCover
    r += (255 - r) * glyphCover
    g += (255 - g) * glyphCover
    b += (255 - b) * glyphCover
    rgba[idx] = Math.round(r)
    rgba[idx + 1] = Math.round(g)
    rgba[idx + 2] = Math.round(b)
    rgba[idx + 3] = Math.round(255 * bgCover)
  }
}

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, encodePng(rgba, SIZE, SIZE))
console.log(`icon written: ${outPath}`)
