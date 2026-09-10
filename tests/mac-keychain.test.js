'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('certificate imports and partition lists use their respective passwords', async () => {
  const source = fs.readFileSync(require.resolve('app-builder-lib/out/codeSign/macCodeSign.js'), 'utf8')
  // Exercise the installed builder functions with a fake security command;
  // no real certificates, keychains, or user credentials are accessed.
  const functions = source.slice(source.indexOf('async function createKeychain('), source.indexOf('async function sign('))
  const commands = []
  const context = {
    process: { env: {} },
    path,
    crypto_1: require('node:crypto'),
    os_1: { tmpdir: () => '/tmp' },
    bundledCertKeychainAdded: { value: Promise.resolve() },
    removeKeychain: async () => {},
    listUserKeychains: async () => [],
    codesign_1: { importCertificate: async (link) => link },
    builder_util_1: { exec: async (bin, args) => { commands.push(args) } },
  }
  vm.createContext(context)
  vm.runInContext(functions, context)
  await context.createKeychain({
    tmpDir: {}, currentDir: '/test/app',
    cscLink: '/test/app.p12', cscKeyPassword: 'app-certificate-password',
    cscILink: '/test/installer.p12', cscIKeyPassword: 'installer-certificate-password',
  })
  const keychainPassword = commands.find(args => args[0] === 'create-keychain')[2]
  const imports = commands.filter(args => args[0] === 'import')
  assert.equal(imports.length, 2)
  assert.equal(imports[0][imports[0].indexOf('-P') + 1], 'app-certificate-password')
  assert.equal(imports[1][imports[1].indexOf('-P') + 1], 'installer-certificate-password')
  const partitions = commands.filter(args => args[0] === 'set-key-partition-list')
  assert.equal(partitions.length, 2)
  for (const args of partitions) {
    assert.equal(args[args.indexOf('-k') + 1], keychainPassword)
  }
  assert.notEqual(keychainPassword, 'app-certificate-password')
})
