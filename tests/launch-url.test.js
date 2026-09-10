'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createLaunchUrlReader, lanLaunchUrl } = require('../src/launch-url.cjs')

test('captures a split authenticated startup URL and shares the same token on LAN', () => {
  const reader = createLaunchUrlReader('http://127.0.0.1:3080')
  reader.push('plugin log\ndsh web: http://127.0.0.1:3080/?tok')
  assert.equal(reader.url, null)
  reader.push('en=test-token (LAN: http://192.168.1.2:3080/?token=test-token)\r\n')
  assert.equal(reader.url, 'http://127.0.0.1:3080/?token=test-token')
  assert.equal(lanLaunchUrl('192.168.1.3', 3080, reader.url), 'http://192.168.1.3:3080/?token=test-token')
})

test('ignores mismatched origins, ports and invalid or absent tokens', () => {
  const reader = createLaunchUrlReader('http://127.0.0.1:3080')
  for (const url of [
    'http://example.com:3080/?token=test', 'http://127.0.0.1:9999/?token=test',
    'http://127.0.0.1:3080/', 'http://127.0.0.1:3080/?token=a&token=b',
    'http://user:pass@127.0.0.1:3080/?token=test',
  ]) reader.push(`dsh web: ${url}\n`)
  assert.equal(reader.url, null)
  assert.equal(lanLaunchUrl('192.168.1.3', 3080, null), null)
})
