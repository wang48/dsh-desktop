// electron-builder 26.15.3 mistakenly passes the certificate password to
// set-key-partition-list. That command needs the randomly generated keychain
// password used by create-keychain, not the PKCS#12 import password.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const target = fileURLToPath(new URL('../node_modules/app-builder-lib/out/codeSign/macCodeSign.js', import.meta.url))
const marker = 'dsh-desktop patch: use keychain password for partition list'
const source = readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
if (source.includes(marker)) {
  console.log('[patch-mac-keychain] already patched, skip')
} else {
  const replacements = [
    ['return await importCerts(keychainFile, certPaths, cscPasswords);',
      'return await importCerts(keychainFile, certPaths, cscPasswords, keychainPassword);'],
    ['async function importCerts(keychainFile, paths, keyPasswords) {',
      'async function importCerts(keychainFile, paths, keyPasswords, keychainPassword) {'],
    ['["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, keychainFile]',
      '["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychainFile]'],
  ]
  for (const [original] of replacements) {
    if (source.split(original).length !== 2) {
      throw new Error(`[patch-mac-keychain] expected unique upstream block not found: ${original}`)
    }
  }
  let patched = source
  for (const [original, replacement] of replacements) patched = patched.replace(original, replacement)
  writeFileSync(target, `// ${marker}\n${patched}`)
  console.log('[patch-mac-keychain] patched:', target)
}
