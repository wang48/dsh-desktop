// 下载 electron win32-x64 zip（GitHub 优先，npmmirror 兜底，带重试与长超时）
// 用法: node scripts/fetch-electron.mjs <version> <outZip>
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const version = process.argv[2]
const outZip = process.argv[3]
if (!version || !outZip) {
  console.error('usage: node fetch-electron.mjs <version> <outZip>')
  process.exit(2)
}
const tmpZip = outZip + '.part'

const urls = [
  `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-win32-x64.zip`,
  `https://npmmirror.com/mirrors/electron/v${version}/electron-v${version}-win32-x64.zip`,
]

async function tryOnce(url, attempt) {
  const t0 = Date.now()
  console.log(`[attempt ${attempt}] GET ${url}`)
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(600_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  console.log(`[attempt ${attempt}] got ${bytes.length} bytes in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  mkdirSync(dirname(outZip), { recursive: true })
  writeFileSync(tmpZip, bytes)
  renameSync(tmpZip, outZip)
  return true
}

let lastError
for (let attempt = 1; attempt <= 8; attempt++) {
  for (const url of urls) {
    try {
      if (await tryOnce(url, attempt)) {
        console.log(`DONE -> ${outZip}`)
        process.exit(0)
      }
    } catch (error) {
      lastError = error
      console.log(`[attempt ${attempt}] ${error.cause?.code || ''} ${error.cause?.message || error.message}`)
      if (existsSync(tmpZip)) { try { writeFileSync(tmpZip, Buffer.alloc(0)) } catch {} }
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
}
console.error('FAILED:', lastError?.cause?.message || lastError?.message || lastError)
process.exit(1)
