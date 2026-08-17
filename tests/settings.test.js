'use strict'
// 设置存储单元测试：默认值、host/port 校验、load/save 往返。
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const settings = require('../src/settings.cjs')

const tmpRoot = path.join(__dirname, '.tmp')
fs.mkdirSync(tmpRoot, { recursive: true })

test('defaults: enabled=true, host=0.0.0.0, port=0, auto=true', () => {
  assert.deepStrictEqual(settings.normalize(null), {
    web: { enabled: true, host: '0.0.0.0', port: 0 },
    updates: { auto: true },
  })
})

test('normalize accepts only the two upstream host literals', () => {
  assert.strictEqual(settings.normalize({ web: { host: '0.0.0.0' } }).web.host, '0.0.0.0')
  assert.strictEqual(settings.normalize({ web: { host: '127.0.0.1' } }).web.host, '127.0.0.1')
  // 其他值（具体局域网 IP、域名、空串）一律回落到默认 0.0.0.0
  for (const bad of ['192.168.1.5', 'localhost', '', '::1', 42]) {
    assert.strictEqual(settings.normalize({ web: { host: bad } }).web.host, '0.0.0.0', `host ${bad} should fall back`)
  }
})

test('normalize clamps port to 0-65535 integers', () => {
  assert.strictEqual(settings.normalize({ web: { port: 0 } }).web.port, 0)
  assert.strictEqual(settings.normalize({ web: { port: 3022 } }).web.port, 3022)
  assert.strictEqual(settings.normalize({ web: { port: 65535 } }).web.port, 65535)
  for (const bad of [-1, 70000, '3022', 1.5, NaN]) {
    assert.strictEqual(settings.normalize({ web: { port: bad } }).web.port, 0, `port ${bad} should fall back`)
  }
})

test('updates.auto accepts booleans and defaults to true', () => {
  assert.strictEqual(settings.normalize({ updates: { auto: false } }).updates.auto, false)
  assert.strictEqual(settings.normalize({ updates: { auto: 'no' } }).updates.auto, true)
  assert.strictEqual(settings.normalize({ updates: null }).updates.auto, true)
})

test('save/load round-trips and tolerates a corrupt file', () => {
  const file = path.join(tmpRoot, `settings-${Date.now()}.json`)
  const saved = settings.save(file, { web: { host: '127.0.0.1', port: 8080 }, updates: { auto: false } })
  const loaded = settings.load(file)
  assert.deepStrictEqual(loaded, saved)
  fs.writeFileSync(file, '{not json')
  assert.deepStrictEqual(settings.load(file), settings.normalize(null))
  fs.rmSync(file, { force: true })
})
