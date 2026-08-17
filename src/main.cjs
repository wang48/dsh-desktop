'use strict'

/**
 * DSH Desktop - DeepSeek Harness 桌面版 Electron 主进程
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

const { app, BrowserWindow, Menu, dialog, shell, ipcMain, nativeTheme } = require('electron')
const { autoUpdater } = require('electron-updater')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const http = require('node:http')
const settingsStore = require('./settings.cjs')

const APP_ID = 'com.deepseek.dsh.desktop'
const APP_NAME = 'DSH Desktop'
const READY_TIMEOUT_MS = 180_000
const POLL_INTERVAL_MS = 400

// 测试/开发时允许把 userData 重定向到任意目录（打包后的正常使用不需要）。
// 必须在 requestSingleInstanceLock 之前执行：单实例锁基于 userData 路径，
// 不提前重定向的话，测试实例会与已安装实例（默认 userData）抢同一把锁而退出。
if (process.env.DSH_DESKTOP_USERDATA) {
  app.setPath('userData', process.env.DSH_DESKTOP_USERDATA)
}

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
    dialog.showErrorBox('DSH Desktop 启动失败', `找不到内置 DSH 运行时：\n${dshBin}`)
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

  // Windows：给主进程分配一个隐藏控制台。子进程默认继承父进程的控制台，
  // 只要整棵进程树共享一个隐藏控制台，DSH spawn 的任何工具进程都不会新开
  // 可见的 CMD 窗口——包括无法用 CREATE_NO_WINDOW 的 ACL 受限令牌 runner、
  // 以及 pwsh 内部再 spawn 的命令（父进程无控制台时，每个控制台子程序都会
  // 各自弹一个窗口，这正是"命令行窗口弹一下又消失"的根因）。
  let hiddenConsole = false
  if (process.platform === 'win32') {
    try {
      const koffi = require('koffi')
      const kernel32 = koffi.load('kernel32.dll')
      const user32 = koffi.load('user32.dll')
      const GetConsoleWindow = kernel32.func('void * GetConsoleWindow()')
      const AllocConsole = kernel32.func('int32 AllocConsole()')
      const ShowWindow = user32.func('int32 ShowWindow(void * hwnd, int32 nCmdShow)')
      if (GetConsoleWindow()) {
        // 已有控制台（例如从终端启动的 dev 模式），子进程继承它即可
        hiddenConsole = true
      } else if (AllocConsole() !== 0) {
        const hwnd = GetConsoleWindow()
        if (hwnd) ShowWindow(hwnd, 0) // SW_HIDE
        hiddenConsole = true
        logMain('allocated hidden console for child processes')
      }
    } catch (error) {
      logMain(`hidden console unavailable, fallback to CREATE_NO_WINDOW: ${error.message}`)
    }
  }

  let server = null
  let win = null
  let quitting = false
  let booting = false

  function errorPage(message) {
    const detail = lastLines.length > 0
      ? lastLines.slice(-25).map(escapeHtml).join('\n')
      : '(暂无日志)'
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>启动失败</title><style>
html,body{height:100%;margin:0}body{background:#000000;color:#b3b3b3;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif;padding:40px}
h1{font-size:16px;font-weight:600;color:#e05555;margin:0 0 14px}
p{font-size:13px;color:#fafafa;margin:0 0 10px}
pre{background:#0d0d0d;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:14px;font-size:12px;line-height:1.5;color:#b3b3b3;overflow:auto;max-height:46vh}
.hint{font-size:12px;color:#888888;margin-top:12px}
@media (prefers-color-scheme:light){body{background:#ffffff;color:#555}p{color:#1a1a1a}pre{background:#f4f4f4;border-color:rgba(0,0,0,0.12);color:#555}h1{color:#c62828}.hint{color:#8a8a8a}}</style></head><body>
<h1>DSH Desktop 启动失败</h1>
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
      dialog.showErrorBox('DSH Desktop 启动失败', `${message}\n\n完整日志：${logFile}`)
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
      // 有隐藏控制台时让子进程继承它（子进程的工具进程也一起继承，不再弹窗）；
      // 没有控制台时退回 CREATE_NO_WINDOW（保持现状）。
      windowsHide: !hiddenConsole,
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

  /**
   * 解析 DSH 最终生效的主题：读取 DSH 自己的 settings.yaml 里
   * ui-theme.preference（dark/light/system），system 或读不到时跟随 OS。
   * 与 DSH 客户端主题注册表的行为保持一致。
   */
  function resolveTheme() {
    let preference = null
    try {
      const text = fs.readFileSync(path.join(dshHome, 'settings.yaml'), 'utf8')
      const match = text.match(/ui-theme:\s*\n\s*preference:\s*['"]?(dark|light|system)['"]?/)
      if (match) preference = match[1]
    } catch { /* 读不到按 system 处理 */ }
    if (preference !== 'dark' && preference !== 'light') {
      preference = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    }
    return preference
  }

  /**
   * 让渲染进程的 prefers-color-scheme 与 DSH 最终主题一致。
   * DSH 的首帧主题由 prefers-color-scheme 解析（启动脚本先按 system 绘制，
   * 之后才应用持久化偏好），从 themeSource 源头对齐后首帧即最终主题，
   * 彻底消除启动/返回时的白闪（或深闪）。
   */
  function applyThemeSource() {
    nativeTheme.themeSource = resolveTheme()
  }

  /**
   * 与最终主题一致的页面底色（注入用，兜底覆盖 dom-ready 前已提交的亮色画布）。
   * dark = DSH 深色主题 bg-base（neutral-bluish-950）；light = 白。
   */
  function resolveWebBaseColor() {
    return resolveTheme() === 'dark' ? '#151517' : '#ffffff'
  }

  function createWindow() {
    // 打包版图标已内嵌进 exe，无需指定；dev 模式指定 PNG 便于预览图标效果
    // （否则窗口/任务栏显示 electron.exe 的通用图标，看不到 build/icon.png）
    const devIcon = app.isPackaged ? undefined : path.join(app.getAppPath(), 'build', 'icon.png')
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 620,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: resolveTheme() === 'dark' ? '#000000' : '#ffffff',
      title: APP_NAME,
      icon: devIcon,
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

    // 锁定窗口标题：无论加载哪个页面（加载页 / 设置页 / DSH WebUI），
    // 标题始终显示 DSH Desktop，避免上游页面标题（如旧版带的 "… — DeepSeek Harness"）覆盖。
    win.on('page-title-updated', (event) => {
      event.preventDefault()
      if (win && !win.isDestroyed()) win.setTitle(APP_NAME)
    })

    // DSH WebUI 的首帧按"系统解析"的主题绘制（主题 JS 未跑前），再应用持久化
    // 偏好，二者不一致时会出现白闪/深闪。themeSource 已在源头对齐最终主题；
    // 此处再注入同色底色兜底覆盖已提交的默认画布。
    win.webContents.on('dom-ready', () => {
      try {
        applyThemeSource()
        win.webContents.insertCSS(`html, body { background-color: ${resolveWebBaseColor()} !important; }`)
      } catch { /* 注入失败不影响使用 */ }
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
  /** 平台/形态是否支持自动更新（macOS 已签名公证，自 0.2.4 起纳入）。 */
  function updaterSupported() {
    return app.isPackaged && !isPortable
      && !(process.platform === 'linux' && !process.env.APPIMAGE)
  }
  /** 自动更新是否生效：平台支持 + 用户开关。 */
  function updateEnabled() {
    return updaterSupported() && settings.updates.auto !== false
  }
  function updateNote() {
    if (!app.isPackaged) return '开发模式下不可用（打包后可通过 GitHub Release 自动更新）'
    if (isPortable) return '便携版不支持自动更新，检查到新版本后将引导到下载页。'
    if (process.platform === 'linux' && !process.env.APPIMAGE) return 'deb 版本请通过系统包管理器更新。'
    if (!settings.updates.auto) return '自动检查已关闭；仍可手动"检查更新"。'
    return '安装版支持自动下载更新（重启应用后生效）。'
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
    theme: resolveTheme(),
    settings,
    updateStatus,
    updateSupported: updaterSupported(),
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
  ipcMain.handle('dsh:back-to-web', () => {
    if (server && server.child.exitCode === null) {
      applyThemeSource()
      if (win && !win.isDestroyed()) win.loadURL(`${server.baseUrl}/`)
      return { ok: true }
    }
    return { error: 'WebUI 服务未运行。请先启用 WebUI 并点击"保存并重启"启动服务。' }
  })
  ipcMain.handle('dsh:open-log', () => shell.openPath(logFile))
  ipcMain.handle('dsh:open-data-dir', () => shell.openPath(userData))
  async function checkForUpdates() {
    if (!app.isPackaged) return '开发模式下不可用'
    if (!updaterSupported()) {
      shell.openExternal('https://github.com/wang48/dsh-desktop/releases')
      return '当前形态不支持自动更新，已打开下载页'
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
  if (updaterSupported()) {
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
        message: `DSH Desktop v${info.version} 已下载完成`,
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

  // 菜单属于操作系统界面，标签跟随系统语言：中文系统用中文，其余用英文
  // （例如英文 macOS 的菜单栏应显示 Paste ⌘V，而不是「粘贴」）
  const uiZh = String((app.getPreferredSystemLanguages() || [])[0] || app.getLocale() || '').toLowerCase().startsWith('zh')
  const L = (zh, en) => (uiZh ? zh : en)

  const menu = Menu.buildFromTemplate([
    {
      label: L('文件', 'File'),
      submenu: [
        { label: L('设置', 'Settings'), click: () => { if (win && !win.isDestroyed()) win.loadFile(controlPage) } },
        { label: L('重试启动', 'Retry Startup'), click: () => runBoot() },
        { type: 'separator' },
        { label: L('退出', 'Quit'), role: 'quit' },
      ],
    },
    {
      label: L('编辑', 'Edit'),
      // macOS 的 Cmd+C/V/X/A/Z 通过应用菜单的 role 分发，缺少编辑菜单时
      // 页面里完全无法复制粘贴（Windows/Linux 由 Chromium 原生处理，不受影响）。
      submenu: [
        { label: L('撤销', 'Undo'), role: 'undo' },
        { label: L('重做', 'Redo'), role: 'redo' },
        { type: 'separator' },
        { label: L('剪切', 'Cut'), role: 'cut' },
        { label: L('复制', 'Copy'), role: 'copy' },
        { label: L('粘贴', 'Paste'), role: 'paste' },
        { label: L('全选', 'Select All'), role: 'selectAll' },
      ],
    },
    {
      label: L('视图', 'View'),
      submenu: [
        { label: L('重新加载', 'Reload'), role: 'reload' },
        { label: L('开发者工具', 'Developer Tools'), role: 'toggleDevTools' },
        { type: 'separator' },
        { label: L('重置缩放', 'Reset Zoom'), role: 'resetZoom' },
        { label: L('放大', 'Zoom In'), role: 'zoomIn' },
        { label: L('缩小', 'Zoom Out'), role: 'zoomOut' },
        { type: 'separator' },
        { label: L('全屏', 'Toggle Full Screen'), role: 'togglefullscreen' },
      ],
    },
    {
      label: L('帮助', 'Help'),
      submenu: [
        { label: L('检查更新', 'Check for Updates'), click: () => { checkForUpdates() } },
        { label: L('打开数据目录', 'Open Data Directory'), click: () => shell.openPath(userData) },
        { label: L('打开服务日志', 'Open Server Log'), click: () => shell.openPath(logFile) },
        {
          label: `${L('关于', 'About')} ${APP_NAME}`,
          click: () => showAbout(),
        },
      ],
    },
  ])
  Menu.setApplicationMenu(menu)

  // 标题栏右键菜单：菜单栏不常驻，右键标题栏弹出应用入口 + 窗口控制
  const titleBarMenu = Menu.buildFromTemplate([
    { label: L('设置', 'Settings'), click: () => { if (win && !win.isDestroyed()) win.loadFile(controlPage) } },
    { label: L('重试启动', 'Retry Startup'), click: () => runBoot() },
    { type: 'separator' },
    // 编辑动作：macOS 走顶部菜单栏的「编辑」，Windows/Linux 从标题栏右键菜单可达
    { label: L('剪切', 'Cut'), role: 'cut' },
    { label: L('复制', 'Copy'), role: 'copy' },
    { label: L('粘贴', 'Paste'), role: 'paste' },
    { label: L('全选', 'Select All'), role: 'selectAll' },
    { type: 'separator' },
    { label: L('检查更新', 'Check for Updates'), click: () => { checkForUpdates() } },
    { label: L('打开数据目录', 'Open Data Directory'), click: () => shell.openPath(userData) },
    { label: L('打开服务日志', 'Open Server Log'), click: () => shell.openPath(logFile) },
    { label: `${L('关于', 'About')} ${APP_NAME}`, click: () => showAbout() },
    { type: 'separator' },
    { label: L('最小化', 'Minimize'), role: 'minimize' },
    { label: L('最大化', 'Maximize'), role: 'maximize' },
    { label: L('关闭', 'Close'), role: 'close' },
  ])

  app.whenReady().then(() => {
    // 先对齐 prefers-color-scheme，再创建窗口：加载页与 DSH 首帧即最终主题
    applyThemeSource()
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
