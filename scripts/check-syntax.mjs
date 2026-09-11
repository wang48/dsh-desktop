import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// cmd.exe does not expand wildcards, and node --check accepts only one file.
const root = fileURLToPath(new URL('..', import.meta.url))
let count = 0
for (const directory of ['src', 'scripts', 'tests']) {
  for (const file of readdirSync(resolve(root, directory)).sort()) {
    if (!/\.(?:cjs|mjs|js)$/.test(file)) continue
    const result = spawnSync(process.execPath, ['--check', resolve(root, directory, file)], { stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
    count++
  }
}
console.log(`Syntax checked ${count} JavaScript files`)
