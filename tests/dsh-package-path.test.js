'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { dshPackagePath } = require('../scripts/dsh-package-path.cjs')

for (const nested of [false, true]) {
  test(`patches resolve the DSH runtime package (${nested ? 'nested' : 'hoisted'})`, () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-package-path-')))
    const name = '@deepseek-ai/dsh-patch-fixture'
    function manifest(dir) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'package.json'), '{}')
    }
    try {
      manifest(root)
      const cli = path.join(root, 'node_modules/@deepseek-ai/dsh')
      manifest(cli)
      manifest(path.join(root, 'node_modules', name))
      const target = path.join(nested ? cli : root, 'node_modules', name)
      manifest(target)
      assert.equal(dshPackagePath(name, 'lib/index.js', root), path.join(target, 'lib/index.js'))
      assert.throws(() => dshPackagePath('@deepseek-ai/missing-patch-fixture', 'lib/index.js', root), { code: 'MODULE_NOT_FOUND' })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}
