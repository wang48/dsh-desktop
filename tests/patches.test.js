'use strict'
// postinstall 补丁回归测试：对当前 node_modules 里的上游包跑一遍三个补丁脚本，
// 断言补丁成功、标记落盘、且重复执行幂等（升级上游后若锚点失配，这里会先炸）。
const { test } = require('node:test')
const assert = require('node:assert')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const CASES = {
  'patch-picker-worker.mjs': {
    file: 'node_modules/@deepseek-ai/dsh-host-directory-picker-native/lib/worker.cjs',
    marker: 'dsh-desktop patch: koffi.view is unsupported under Electron',
  },
  'patch-acl-runner-window.mjs': {
    file: 'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/types-CNjZgO4h.js',
    marker: 'dsh-desktop patch: STARTF_USESHOWWINDOW + SW_HIDE for restricted-token children',
  },
  'patch-secure-context.mjs': {
    file: 'node_modules/@deepseek-ai/dsh-client-modules/lib/index.js',
    marker: 'dsh-desktop patch: insecure-context crypto.randomUUID',
  },
}

for (const [script, { file, marker }] of Object.entries(CASES)) {
  test(`${script} applies cleanly and is idempotent`, () => {
    const run = () => spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
      cwd: root,
      stdio: 'ignore',
    })
    const first = run()
    assert.strictEqual(first.status, 0, `${script} first run exited ${first.status}`)
    const second = run()
    assert.strictEqual(second.status, 0, `${script} re-run (idempotency) exited ${second.status}`)
    const content = fs.readFileSync(path.join(root, file), 'utf8')
    assert.ok(content.includes(marker), `${script}: marker missing in ${file} — patch did not land`)
  })
}
