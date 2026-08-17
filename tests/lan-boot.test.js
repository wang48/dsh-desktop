'use strict'
// 局域网机制集成测试：用与主进程相同的参数（--patch 在应用参数之前）在临时
// DSH_HOME 里拉起内置 dsh web，断言它绑定 0.0.0.0 并在启动日志打印 LAN 地址。
const { test } = require('node:test')
const assert = require('node:assert')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const dshBin = path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const LAN_PATCH = '- id: webserver\n  config:\n    host: 0.0.0.0\n    port: !!js ctx.webStartup.port ?? 3080\n'
const BOOT_TIMEOUT_MS = 220000

function killTree(child) {
  if (child.exitCode !== null) return
  try {
    // 直接 TerminateProcess，不依赖 taskkill 的 spawn（受限环境可能 EPERM）
    child.kill('SIGKILL')
  } catch { /* already gone */ }
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 8000 })
    }
  } catch { /* best effort */ }
}

test('dsh web binds 0.0.0.0 via --patch and prints the LAN URL', { timeout: BOOT_TIMEOUT_MS + 30000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(__dirname, '.tmp-lan-'))
  const home = path.join(tmp, 'home')
  fs.mkdirSync(home, { recursive: true })
  const patchFile = path.join(tmp, 'lan.patch.yml')
  fs.writeFileSync(patchFile, LAN_PATCH)
  const logFile = path.join(tmp, 'boot.log')
  const fd = fs.openSync(logFile, 'w')
  const env = { ...process.env, DSH_HOME: home }
  const child = spawn(process.execPath, [dshBin, 'web', '--patch', patchFile, '--port', '0'], {
    cwd: home,
    env,
    stdio: ['ignore', fd, fd],
  })
  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    let lanUrl = null
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break
      const text = fs.readFileSync(logFile, 'utf8')
      const match = text.match(/\(LAN: (http:\/\/[^\s)]+)\)/)
      if (match) {
        lanUrl = match[1]
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const tail = fs.readFileSync(logFile, 'utf8').slice(-800)
    assert.ok(lanUrl !== null, `no LAN URL in boot log; child exit=${child.exitCode}; log tail:\n${tail}`)
    assert.match(lanUrl, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/, `unexpected LAN URL ${lanUrl}`)
  } finally {
    killTree(child)
    try { fs.closeSync(fd) } catch { /* already closed */ }
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch { /* 受限环境下 junction（profiles/node_modules）可能删不掉，留待外部清理 */ }
  }
})
