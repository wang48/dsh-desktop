'use strict'
// 局域网机制集成测试：用与主进程相同的参数（--patch 在应用参数之前）在临时
// DSH_HOME 里拉起内置 dsh web，断言它绑定 0.0.0.0 并在启动日志打印 LAN 地址。
const { test } = require('node:test')
const assert = require('node:assert')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { createLaunchUrlReader, isReadyResponse } = require('../src/launch-url.cjs')

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

// Exercise the shipped Electron runtime too: native DSH loader compatibility
// depends on its exact Node/V8 fingerprint, not just the system Node version.
for (const runtime of [
  { name: 'Node', executable: process.execPath, args: [], env: {} },
  { name: 'Electron', executable: require('electron'), args: ['--expose-internals'], env: { ELECTRON_RUN_AS_NODE: '1' } },
]) {
test(`${runtime.name}: dsh web binds 0.0.0.0 and authenticates the LAN homepage`, { timeout: BOOT_TIMEOUT_MS + 30000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(__dirname, '.tmp-lan-'))
  const home = path.join(tmp, 'home')
  fs.mkdirSync(home, { recursive: true })
  const patchFile = path.join(tmp, 'lan.patch.yml')
  fs.writeFileSync(patchFile, LAN_PATCH)
  const logFile = path.join(tmp, 'boot.log')
  const fd = fs.openSync(logFile, 'w')
  const env = { ...process.env, ...runtime.env, DSH_HOME: home }
  const child = spawn(runtime.executable, [...runtime.args, dshBin, 'web', '--patch', patchFile, '--port', '0', '--no-open'], {
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
    // Newer DSH releases append the LAN access token to the advertised URL.
    assert.match(lanUrl, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/?(?:\?token=[A-Za-z0-9_-]+)?$/, `unexpected LAN URL ${lanUrl}`)
    // Verify the actual desktop entry page, not just the startup log.
    const baseUrl = `http://127.0.0.1:${new URL(lanUrl).port}`
    const launch = createLaunchUrlReader(baseUrl)
    launch.push(fs.readFileSync(logFile, 'utf8'))
    assert.ok(launch.url, 'desktop must capture the authenticated startup URL')
    const anonymous = await fetch(baseUrl, { signal: AbortSignal.timeout(15000) })
    assert.equal(anonymous.status, 401, 'upstream authentication must stay enabled')
    const exchange = await fetch(launch.url, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
    assert.equal(exchange.status, 303, 'launch token must exchange for a browser cookie')
    const cookie = exchange.headers.get('set-cookie')
    assert.ok(cookie, 'launch response must set a session cookie')
    assert.equal(isReadyResponse(exchange.status, {
      location: exchange.headers.get('location'),
      'set-cookie': exchange.headers.getSetCookie(),
    }), true, 'desktop readiness must recognize the actual upstream auth response')
    const response = await fetch(baseUrl, { headers: { cookie: cookie.split(';')[0] }, signal: AbortSignal.timeout(15000) })
    assert.equal(response.status, 200, 'desktop entry page must load')
    const html = await response.text()
    assert.ok(html.includes('dsh-desktop patch: insecure-context crypto.randomUUID'), 'LAN UUID polyfill must reach the browser')
    assert.ok(html.includes('__ModuleLoader__'), 'upstream web bootstrap must be present')
  } finally {
    killTree(child)
    try { fs.closeSync(fd) } catch { /* already closed */ }
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch { /* 受限环境下 junction（profiles/node_modules）可能删不掉，留待外部清理 */ }
  }
})
}
