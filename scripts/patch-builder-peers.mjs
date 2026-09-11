// electron-builder 26.15.3's npm collector only follows _dependencies and drops
// runtime peerDependencies installed by npm. DSH plugins import these at startup.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const target = fileURLToPath(new URL('../node_modules/app-builder-lib/out/node-module-collector/npmNodeModulesCollector.js', import.meta.url))
const marker = 'dsh-desktop patch: include installed runtime peer dependencies'
const source = readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
const original = 'return ((_a = tree._dependencies) === null || _a === void 0 ? void 0 : _a[packageName]) != null;'
if (source.includes(marker)) {
  console.log('[patch-builder-peers] already patched, skip')
} else {
  if (source.split(original).length !== 2) throw new Error('[patch-builder-peers] expected unique npm collector predicate not found')
  const replacement = `// ${marker}\n        return ${original.slice(7, -1)} || tree.peerDependencies?.[packageName] != null;`
  writeFileSync(target, source.replace(original, replacement))
  console.log('[patch-builder-peers] patched:', target)
}
