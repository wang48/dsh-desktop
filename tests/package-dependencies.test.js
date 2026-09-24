'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { dshPackagePath } = require('../scripts/dsh-package-path.cjs')
const { TmpDir } = require('temp-file')
const { NpmNodeModulesCollector } = require('app-builder-lib/out/node-module-collector/npmNodeModulesCollector')

test('builder packages runtime peers but excludes build-only dependencies', { timeout: 120000 }, async () => {
  const tmp = new TmpDir()
  try {
    const collector = new NpmNodeModulesCollector(path.join(__dirname, '..'), tmp)
    const { nodeModules } = await collector.getNodeModules({ packageName: 'dsh-desktop' })
    const names = new Set()
    const versions = new Set()
    const visit = entries => {
      for (const entry of entries) {
        names.add(entry.name)
        versions.add(`${entry.name}@${entry.version}`)
        visit(entry.dependencies || [])
      }
    }
    visit(nodeModules)
    const dshVersion = require('../package.json').dependencies['@deepseek-ai/dsh']
    assert.ok(versions.has(`@deepseek-ai/dsh@${dshVersion}`), 'expected DSH CLI must be packaged')
    for (const name of ['dsh-client-modules', 'dsh-host-directory-picker-native', 'dsh-win32-process']) {
      const manifest = JSON.parse(fs.readFileSync(dshPackagePath(`@deepseek-ai/${name}`, 'package.json'), 'utf8'))
      assert.ok(versions.has(`${manifest.name}@${manifest.version}`), `Missing CLI runtime dependency: ${manifest.name}@${manifest.version}`)
    }
    for (const name of ['dsh-attachment', 'dsh-session-persistence', 'dsh-session-query', 'dsh-util-time']) {
      assert.ok(names.has(`@deepseek-ai/${name}`), `Missing runtime peer: ${name}`)
    }
    for (const name of ['electron', 'electron-builder', 'app-builder-lib']) assert.ok(!names.has(name), `Build-only dependency shipped: ${name}`)
  } finally {
    await tmp.cleanup()
  }
})
