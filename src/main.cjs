'use strict'

/**
 * DSH-Desktop — DeepSeek Harness 桌面版 Electron 主进程
 *
 * 职责：
 *  1. 单实例锁（失败时降级继续运行）
 *  2. 立即打开窗口显示加载页，避免启动期"有进程无界面"
 *  3. 在 userData/home 下建立独立的 DSH_HOME（与命令行版数据隔离）
 *  4. 按设置（WebUI 开关 / 固定端口）用 ELECTRON_RUN_AS_NODE 模式拉起内置 `dsh web`
 *  5. 轮询 HTTP 等服务就绪，然后把窗口切换到 http://127.0.0.1:<port>
 *  6. 出错时把错误与最近日志显示在窗口内（可打开日志/重试）；设置页可开关 WebUI
 *  7. GitHub Release 自动升级（electron-updater，便携版/macOS 降级为打开下载页）
 *  8. 退出时杀掉服务进程树
 */

const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron')
const { autoUpdater } = require('electron-updater')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const http = require('node:http')
const settingsStore = require('./settings.cjs')

const APP_ID = 'com.deepseek.dsh.desktop'
const APP_NAME = 'DSH-Desktop'
const READY_TIMEOUT_MS = 180_000
const POLL_INTERVAL_MS = 400

// 单实例锁：拿不到锁说明已有实例在跑（由已有实例把窗口带到前台，本进程退出）。
// 失败时降级为继续运行——锁只是优化，不是功能必需。
let gotLock = false
try {
  gotLock = app.requestSingleInstanceLock()
} catch {
  gotLock = true
}
if (!gotLock) {
  app.quit()
} else {
  main()
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]))
}

function main() {
  app.setAppUserModelId(APP_ID)

  // 测试/开发时允许把 userData 重定向到任意目录（打包后的正常使用不需要）
  if (process.env.DSH_DESKTOP_USERDATA) {
    app.setPath('userData', process.env.DSH_DESKTOP_USERDATA)
  }

  const userData = app.getPath('userData')
  const dshHome = path.join(userData, 'home')
  const logFile = path.join(userData, 'server.log')

  // 产品更名后的一次性数据迁移：DeepSeek Harness → DSH-Desktop（Windows）
  if (process.platform === 'win32' && !fs.existsSync(userData)) {
    try {
      const legacyUserData = path.join(app.getPath('appData'), 'DeepSeek Harness')
      if (fs.existsSync(legacyUserData)) fs.renameSync(legacyUserData, userData)
    } catch { /* 迁移失败不影响启动 */ }
  }

  fs.mkdirSync(dshHome, { recursive: true })

  // DSH 会在 $DSH_HOME/profiles/node_modules 里为每个包建 junction 指向安装处的
  // node_modules，因此必须从 app.asar.unpacked 的真实磁盘路径拉起服务，
  // 否则 junction 目标会指向 asar 文件内部、OS 层面无法解析。
  const appBase = app.isPackaged
    ? app.getAppPath().replace(/[\\/]app\.asar$/, '$&.unpacked')
    : app.getAppPath()
  const dshBin = path.join(appBase, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const loadingPage = path.join(app.getAppPath(), 'src', 'loading.html')
  const controlPage = path.join(app.getAppPath(), 'src', 'control.html')
  const preloadPath = path.join(app.getAppPath(), 'src', 'preload.cjs')
  const settingsPath = path.join(userData, 'settings.json')
  let settings = settingsStore.load(settingsPath)
  const isPortable = process.env.PORTABLE_EXECUTABLE_DIR !== undefined

  // 内置上游 DSH 版本（打包树内 @deepseek-ai/dsh 的 package.json）
  let dshVersion = 'unknown'
  try {
    dshVersion = JSON.parse(fs.readFileSync(path.join(appBase, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version
  } catch { /* 保持 unknown */ }
  if (!fs.existsSync(dshBin)) {
    dialog.showErrorBox('DSH-Desktop 启动失败', `找不到内置 DSH 运行时：\n${dshBin}`)
    app.quit()
    return
  }

  const logStream = fs.createWriteStream(logFile, { flags: 'a' })
  const lastLines = []
  function logMain(message) {
    const line = `[main ${new Date().toISOString()}] ${message}\n`
    logStream.write(line)
    for (const part of message.split(/\r?\n/)) {
      if (part.trim()) {
        lastLines.push(`[main] ${part}`)
        if (lastLines.length > 80) lastLines.shift()
      }
    }
  }
  function writeLog(chunk) {
    const text = String(chunk)
    logStream.write(text)
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) {
        lastLines.push(line)
        if (lastLines.length > 80) lastLines.shift()
      }
    }
  }
  logMain(`app start, packaged=${app.isPackaged}, dshHome=${dshHome}`)
  logMain(`dshBin=${dshBin}`)

  let server = null
  let win = null
  let quitting = false
  let booting = false

  function errorPage(message) {
    const detail = lastLines.length > 0
      ? lastLines.slice(-25).map(escapeHtml).join('\n')
      : '(暂无日志)'
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>启动失败</title><style>
html,body{height:100%;margin:0}body{background:#151517;color:#adb2b8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif;padding:40px}
h1{font-size:16px;font-weight:500;color:#f25a5a;margin:0 0 14px}
p{font-size:13px;color:#f9fafb;margin:0 0 10px}
pre{background:#232324;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:14px;font-size:12px;line-height:1.5;color:#adb2b8;overflow:auto;max-height:46vh}
.hint{font-size:12px;color:#81858c;margin-top:12px}</style></head><body>
<h1>DSH-Desktop 启动失败</h1>
<p>${escapeHtml(message)}</p>
<pre>${detail}</pre>
<p class="hint">完整日志：${escapeHtml(logFile)}（菜单"帮助 → 打开服务日志"可直接查看；"文件 → 重试启动"可重新启动服务）</p>
</body></html>`
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  }

  function showErrorInWindow(message) {
    logMain(`boot failed: ${message}`)
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.loadURL(errorPage(message))
    } else {
      dialog.showErrorBox('DSH-Desktop 启动失败', `${message}\n\n完整日志：${logFile}`)
      app.quit()
    }
  }

  function getFreePort() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer()
      srv.unref()
      srv.on('error', reject)
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address()
        srv.close(() => resolve(port))
      })
    })
  }

  /** 固定端口预检：被占用时返回错误描述，空闲返回 null。 */
  function probePort(port) {
    return new Promise((resolve) => {
      const srv = net.createServer()
      srv.unref()
      srv.on('error', (error) => {
        resolve(error.code === 'EADDRINUSE' || error.code === 'EACCES'
          ? `端口 ${port} 已被占用（可能其他 DSH 实例或其他程序正在使用）。请换一个端口，或改为 0（自动选择空闲端口）。`
          : `端口 ${port} 不可用：${error.message}`)
      })
      srv.listen(port, '127.0.0.1', () => {
        srv.close(() => resolve(null))
      })
    })
  }

  async function startServer() {
    // 固定端口按设置；0 = 自动选择空闲端口（与原版 DSH / 其他实例天然不冲突）
    const port = settings.web.port !== 0 ? settings.web.port : await getFreePort()
    const env = {}
    for (const [key, value] of Object.entries(process.env)) {
      // 不把外层 DSH 会话的环境变量漏进桌面版服务
      if (key.startsWith('DSH_') || key.startsWith('ELECTRON_') || key === 'NODE_OPTIONS') continue
      env[key] = value
    }
    env.DSH_HOME = dshHome
    env.ELECTRON_RUN_AS_NODE = '1'

    // --expose-internals：HMR 服务需要访问 Node 内部 ESM loader。
    // 系统 node 下有 node-addon-require-builtin 原生插件兜底，但 Electron 内置
    // Node 的 ABI 与该插件不匹配，必须显式传此标志走纯 JS 路径。
    logMain(`spawning dsh web on port ${port}`)
    const child = spawn(process.execPath, ['--expose-internals', dshBin, 'web', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: dshHome,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    logMain(`dsh child pid=${child.pid}`)
    child.stdout.on('data', writeLog)
    child.stderr.on('data', writeLog)
    child.on('error', (error) => {
      logMain(`child spawn error: ${error.message}`)
      if (!quitting && server && server.child === child) showErrorInWindow(`无法启动内置 DSH 服务：${error.message}`)
    })
    child.on('exit', (code, signal) => {
      logMain(`child exited code=${code} signal=${signal}`)
      if (!quitting && server && server.child === child) showErrorInWindow(`DSH 服务进程意外退出（code=${code} signal=${signal}）`)
    })
    return { child, port, baseUrl: `http://127.0.0.1:${port}` }
  }

  function waitReady(baseUrl, child) {
    return new Promise((resolve, reject) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (quitting) { clearInterval(timer); return }
        if (child.exitCode !== null) {
          clearInterval(timer)
          return reject(new Error('服务进程提前退出'))
        }
        const req = http.get(`${baseUrl}/`, { timeout: 3000 }, (res) => {
          res.resume()
          if (res.statusCode && res.statusCode < 500) {
            clearInterval(timer)
            resolve()
          } else {
            req.destroy()
          }
        })
        req.on('error', () => {})
        req.on('timeout', () => req.destroy())
        if (Date.now() - started > READY_TIMEOUT_MS) {
          clearInterval(timer)
          reject(new Error(`等待服务就绪超时（${READY_TIMEOUT_MS / 1000}s）`))
        }
      }, POLL_INTERVAL_MS)
    })
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 620,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#0b0f17',
      title: APP_NAME,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        preload: preloadPath,
      },
    })
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      win = null
      shutdown()
    })

    // 新窗口/外站链接一律交给系统默认浏览器
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      const local = url.startsWith('file://') || url.startsWith('data:') || /^http:\/\/127\.0\.0\.1:\d+/.test(url)
      if (!local) {
        event.preventDefault()
        if (/^https?:/i.test(url)) shell.openExternal(url)
      }
    })

    // 标题栏右键：弹出应用菜单（替代常驻菜单栏）
    win.on('system-context-menu', (event) => {
      event.preventDefault()
      titleBarMenu.popup({ window: win })
    })

    win.loadFile(loadingPage)
  }

  function killTree() {
    if (!server) return
    const { child } = server
    if (child.exitCode === null && !child.killed) {
      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        } catch {
          try { child.kill() } catch { /* already gone */ }
        }
      } else {
        try { child.kill('SIGTERM') } catch { /* already gone */ }
        setTimeout(() => {
          try { child.kill('SIGKILL') } catch { /* already gone */ }
        }, 3000).unref?.()
      }
    }
  }

  /**
   * 停止当前服务并等待子进程真正退出（最长 3s）。
   * 重启/改端口时必须等待，否则新实例探测端口时旧实例还占着端口，
   * 造成"自己跟自己"的假端口冲突。
   */
  function stopServer() {
    return new Promise((resolve) => {
      const current = server
      server = null
      if (!current) { resolve(); return }
      const { child } = current
      if (child.exitCode !== null || child.killed) { resolve(); return }
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* already gone */ }
        resolve()
      }, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        } catch {
          try { child.kill() } catch { /* already gone */ }
        }
      } else {
        try { child.kill('SIGTERM') } catch { /* already gone */ }
      }
    })
  }

  async function runBoot() {
    if (booting) return
    booting = true
    try {
      settings = settingsStore.load(settingsPath)
      if (!settings.web.enabled) {
        // WebUI 关闭：停掉服务，窗口停留设置页
        logMain('--- web disabled, stopping server ---')
        await stopServer()
        if (win && !win.isDestroyed()) {
          win.loadFile(controlPage)
          if (win.isMinimized()) win.restore()
          win.show()
        }
        return
      }
      // 目标端口与当前实例一致：复用现有实例，不重启、不产生第二个实例
      if (server && server.child.exitCode === null && (settings.web.port === 0 || settings.web.port === server.port)) {
        logMain(`server already running on target port ${server.port}, reusing`)
        if (win && !win.isDestroyed()) {
          win.loadURL(`${server.baseUrl}/`)
          if (win.isMinimized()) win.restore()
          win.show()
        }
        return
      }
      // 先真正停掉旧实例（等待退出），再探测/占用端口
      await stopServer()
      if (settings.web.port !== 0) {
        const busy = await probePort(settings.web.port)
        if (busy !== null) {
          showErrorInWindow(busy)
          return
        }
      }
      logMain('--- boot start ---')
      if (win && !win.isDestroyed()) {
        win.loadFile(loadingPage)
        if (win.isMinimized()) win.restore()
        win.show()
      }
      server = await startServer()
      await waitReady(server.baseUrl, server.child)
      logMain(`server ready: ${server.baseUrl}`)
      if (win && !win.isDestroyed()) win.loadURL(`${server.baseUrl}/`)
    } catch (error) {
      showErrorInWindow(error.message)
    } finally {
      booting = false
    }
  }

  function shutdown() {
    if (quitting) return
    quitting = true
    killTree()
    app.quit()
  }

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    logMain('app quit')
    killTree()
  })
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  // ---------- 设置页 IPC ----------
  let updateStatus = 'idle'
  function updateNote() {
    if (!app.isPackaged) return '开发模式下不可用（打包后可通过 GitHub Release 自动更新）'
    if (isPortable) return '便携版不支持自动更新，检查到新版本后将引导到下载页。'
    if (process.platform === 'darwin') return 'macOS 未签名版本不支持自动更新，检查到新版本后将引导到下载页。'
    if (process.platform === 'linux' && !process.env.APPIMAGE) return 'deb 版本请通过系统包管理器更新。'
    return '安装版支持自动下载更新（重启应用后生效）。'
  }
  function updateEnabled() {
    return app.isPackaged && !isPortable && process.platform !== 'darwin'
      && !(process.platform === 'linux' && !process.env.APPIMAGE)
  }
  function sendUpdateStatus(text) {
    updateStatus = text
    if (win && !win.isDestroyed()) win.webContents.send('dsh:update-status', text)
  }

  ipcMain.handle('dsh:get-state', () => ({
    version: app.getVersion(),
    dshVersion,
    runtime: {
      electron: process.versions.electron ?? '',
      node: process.versions.node ?? '',
      chrome: process.versions.chrome ?? '',
    },
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    portable: isPortable,
    settings,
    updateStatus,
    updateEnabled: updateEnabled(),
    updateNote: updateNote(),
  }))
  ipcMain.handle('dsh:save-settings', async (_event, next) => {
    settings = settingsStore.save(settingsPath, next)
    logMain(`settings saved: ${JSON.stringify(settings)}`)
    // 正在运行实例的端口不算占用：同端口保存 = 复用现有实例，不重启
    const currentPort = server && server.child.exitCode === null ? server.port : null
    if (settings.web.port !== 0 && settings.web.port !== currentPort) {
      const busy = await probePort(settings.web.port)
      if (busy !== null) return { error: busy }
    }
    return { ok: true }
  })
  ipcMain.handle('dsh:restart-web', () => {
    runBoot()
    return { ok: true }
  })
  ipcMain.handle('dsh:open-log', () => shell.openPath(logFile))
  ipcMain.handle('dsh:open-data-dir', () => shell.openPath(userData))
  async function checkForUpdates() {
    if (!app.isPackaged) return '开发模式下不可用'
    if (isPortable || process.platform === 'darwin' || (process.platform === 'linux' && !process.env.APPIMAGE)) {
      shell.openExternal('https://github.com/wang48/dsh-desktop/releases')
      return '已打开下载页'
    }
    try {
      await autoUpdater.checkForUpdates()
      return '检查已开始'
    } catch (error) {
      sendUpdateStatus(`检查失败：${error.message}`)
      return `检查失败：${error.message}`
    }
  }
  ipcMain.handle('dsh:check-updates', () => checkForUpdates())

  // ---------- 自动升级（electron-updater） ----------
  if (updateEnabled()) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => sendUpdateStatus('正在检查更新…'))
    autoUpdater.on('update-available', (info) => sendUpdateStatus(`发现新版本 v${info.version}，正在下载…`))
    autoUpdater.on('update-not-available', () => sendUpdateStatus('已是最新版本'))
    autoUpdater.on('download-progress', (progress) => sendUpdateStatus(`正在下载 ${Math.floor(progress.percent)}%`))
    autoUpdater.on('update-downloaded', (info) => {
      sendUpdateStatus(`新版本 v${info.version} 已下载，重启应用后生效`)
      const options = {
        type: 'info',
        title: '更新已就绪',
        message: `DSH-Desktop v${info.version} 已下载完成`,
        detail: '立即重启安装，还是稍后退出时自动安装？',
        buttons: ['立即重启', '稍后'],
        defaultId: 0,
        cancelId: 1,
      }
      const choice = win && !win.isDestroyed()
        ? dialog.showMessageBoxSync(win, options)
        : dialog.showMessageBoxSync(options)
      if (choice === 0) {
        quitting = true
        autoUpdater.quitAndInstall()
      }
    })
    autoUpdater.on('error', (error) => {
      logMain(`updater error: ${error.message}`)
      sendUpdateStatus(`更新失败：${error.message}`)
    })
  }

  function showAbout() {
    dialog.showMessageBox({
      type: 'info',
      title: '关于',
      message: `${APP_NAME} v${app.getVersion()}`,
      detail: [
        `内置 DeepSeek Harness：@deepseek-ai/dsh v${dshVersion}`,
        `运行时：Electron ${process.versions.electron} · Node ${process.versions.node} · Chromium ${process.versions.chrome}`,
        `平台：${process.platform} ${process.arch}${isPortable ? '（便携版）' : app.isPackaged ? '（打包版）' : '（开发模式）'}`,
        `数据目录：${userData}`,
      ].join('\n'),
    })
  }

  const menu = Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        { label: '设置', click: () => { if (win && !win.isDestroyed()) win.loadFile(controlPage) } },
        { label: '重试启动', click: () => runBoot() },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '重置缩放', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新', click: () => { checkForUpdates() } },
        { label: '打开数据目录', click: () => shell.openPath(userData) },
        { label: '打开服务日志', click: () => shell.openPath(logFile) },
        {
          label: `关于 ${APP_NAME}`,
          click: () => showAbout(),
        },
      ],
    },
  ])
  Menu.setApplicationMenu(menu)

  // 标题栏右键菜单：菜单栏不常驻，右键标题栏弹出应用入口 + 窗口控制
  const titleBarMenu = Menu.buildFromTemplate([
    { label: '设置', click: () => { if (win && !win.isDestroyed()) win.loadFile(controlPage) } },
    { label: '重试启动', click: () => runBoot() },
    { type: 'separator' },
    { label: '检查更新', click: () => { checkForUpdates() } },
    { label: '打开数据目录', click: () => shell.openPath(userData) },
    { label: '打开服务日志', click: () => shell.openPath(logFile) },
    { label: `关于 ${APP_NAME}`, click: () => showAbout() },
    { type: 'separator' },
    { label: '最小化', role: 'minimize' },
    { label: '最大化', role: 'maximize' },
    { label: '关闭', role: 'close' },
  ])

  app.whenReady().then(() => {
    createWindow()
    runBoot()
    // 启动后延迟静默检查更新（仅支持自动更新的形态）
    if (updateEnabled()) {
      setTimeout(() => {
        if (!quitting) autoUpdater.checkForUpdates().catch((error) => logMain(`updater check failed: ${error.message}`))
      }, 15_000).unref?.()
    }
  })
}
