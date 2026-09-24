'use strict'
const { createRequire } = require('node:module')
const { dirname, join } = require('node:path')

// Resolve from the CLI's dependency tree: npm may nest its packages when older
// desktop runtime peers remain installed at the root.
function dshPackagePath(name, relative, root = join(__dirname, '..')) {
  const desktopRequire = createRequire(join(root, 'package.json'))
  const dshRequire = createRequire(desktopRequire.resolve('@deepseek-ai/dsh/package.json'))
  return join(dirname(dshRequire.resolve(`${name}/package.json`)), relative)
}

module.exports = { dshPackagePath }
