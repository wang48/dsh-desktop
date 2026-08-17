'use strict'

/**
 * 桌面外壳的自有设置（userData/settings.json）。
 * 与 DSH_HOME、profile、cordis 配置完全隔离——外壳配置，不触碰上游。
 */
const fs = require('node:fs')

const DEFAULTS = Object.freeze({
  web: Object.freeze({
    enabled: true,  // WebUI 开关：false 时不拉起 dsh web 子进程
    host: '0.0.0.0', // 监听地址：'0.0.0.0' = 局域网可访问；'127.0.0.1' = 仅本机
    port: 0,        // 0 = 自动选择空闲端口；正整数 = 固定监听端口
  }),
  updates: Object.freeze({
    auto: true,    // 启动后自动检查更新；false 时仍可手动"检查更新"
  }),
})

// 上游 webserver 的 schema 只接受这两个字面量（z.union），其他值会在启动时校验失败
const WEB_HOSTS = ['0.0.0.0', '127.0.0.1']

function normalize(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const web = raw.web && typeof raw.web === 'object' ? raw.web : {}
  let enabled = DEFAULTS.web.enabled
  if (typeof web.enabled === 'boolean') enabled = web.enabled
  let host = DEFAULTS.web.host
  if (WEB_HOSTS.includes(web.host)) host = web.host
  let port = DEFAULTS.web.port
  if (Number.isInteger(web.port) && web.port >= 0 && web.port <= 65535) port = web.port
  const updates = raw.updates && typeof raw.updates === 'object' ? raw.updates : {}
  let auto = DEFAULTS.updates.auto
  if (typeof updates.auto === 'boolean') auto = updates.auto
  return { web: { enabled, host, port }, updates: { auto } }
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

module.exports = { DEFAULTS, WEB_HOSTS, normalize, load, save }
