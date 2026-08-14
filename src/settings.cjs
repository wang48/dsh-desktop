'use strict'

/**
 * 桌面外壳的自有设置（userData/settings.json）。
 * 与 DSH_HOME、profile、cordis 配置完全隔离——外壳配置，不触碰上游。
 */
const fs = require('node:fs')

const DEFAULTS = Object.freeze({
  web: Object.freeze({
    enabled: true, // WebUI 开关：false 时不拉起 dsh web 子进程
    port: 0,       // 0 = 自动选择空闲端口；正整数 = 固定监听端口（127.0.0.1）
  }),
})

function normalize(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const web = raw.web && typeof raw.web === 'object' ? raw.web : {}
  let enabled = DEFAULTS.web.enabled
  if (typeof web.enabled === 'boolean') enabled = web.enabled
  let port = DEFAULTS.web.port
  if (Number.isInteger(web.port) && web.port >= 0 && web.port <= 65535) port = web.port
  return { web: { enabled, port } }
}

function load(file) {
  try {
    return normalize(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return normalize(null)
  }
}

function save(file, settings) {
  const data = normalize(settings)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  fs.renameSync(tmp, file)
  return data
}

module.exports = { DEFAULTS, normalize, load, save }
