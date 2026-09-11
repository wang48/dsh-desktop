import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Launch the actual Electron executable, not DSH under the system Node binary.
// Each launch uses fresh, isolated user data and keeps authentication enabled.
assert.equal(process.platform, 'win32', 'This smoke test must run on Windows')
const executable = resolve(process.argv[2] || 'dist/win-unpacked/DSH-Desktop.exe')
assert.ok(existsSync(executable), `Missing executable: ${executable}`)
for (const host of ['127.0.0.1', '0.0.0.0']) {
  const home = mkdtempSync(join(tmpdir(), 'dsh smoke 测试 '))
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ web: { enabled: true, host, port: 0 }, updates: { auto: false } }))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DSH_|ELECTRON_|NODE_OPTIONS$)/i.test(key)))
  const child = spawn(executable, [], { env: { ...env, DSH_DESKTOP_USERDATA: home }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let spawnError
  child.on('error', error => { spawnError = error })
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-24000) })
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-24000) })
  let log = ''
  try {
    const deadline = Date.now() + 210000
    let baseUrl
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      const logFile = join(home, 'server.log')
      if (existsSync(logFile)) log = readFileSync(logFile, 'utf8')
      baseUrl = log.match(/server ready: (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
      if (baseUrl && (!process.argv.includes('--require-rendered') || log.includes('desktop Web UI loaded'))) break
      if (child.exitCode !== null || child.signalCode || /boot failed:|child spawn error:/.test(log)) break
      await delay(1000)
    }
    assert.ok(baseUrl, `Packaged desktop did not become ready (host=${host}, exit=${child.exitCode})`)
    if (process.argv.includes('--require-rendered')) assert.match(log, /desktop Web UI loaded/, 'Electron window must load the Web UI')
    assert.doesNotMatch(log, /desktop page load failed:|desktop renderer exited:/)
    const launchUrl = log.match(/^dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/m)?.[1]
    assert.ok(launchUrl, 'Missing authenticated startup URL')
    const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) })
    assert.equal((await request(baseUrl)).status, 401)
    const exchange = await request(launchUrl, { redirect: 'manual' })
    assert.equal(exchange.status, 303)
    const cookie = exchange.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie, 'Authentication cookie missing')
    const response = await request(baseUrl, { headers: { cookie } })
    assert.equal(response.status, 200)
    assert.match(await response.text(), /__ModuleLoader__/)
    console.log(`Packaged Windows desktop boot and authenticated Web UI passed (${host})`)
  } catch (error) {
    // Never publish access tokens from the isolated server to the CI log.
    console.error((log + '\n' + output).replace(/token=[A-Za-z0-9_-]+/g, 'token=REDACTED').slice(-24000))
    throw error
  } finally {
    if (child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 15000 })
    // A desktop error dialog can outlive its DSH child; stop the whole tree first.
    await delay(1000)
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}
