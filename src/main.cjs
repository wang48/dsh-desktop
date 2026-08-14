'use strict'

/**
 * DeepSeek Harness 桌面版 — Electron 主进程
 *
 * 职责：
 *  1. 单实例锁（失败时降级继续运行）
 *  2. 立即打开窗口显示加载页，避免启动期"有进程无界面"
 *  3. 在 userData/home 下建立独立的 DSH_HOME（与命令行版数据隔离）
 *  4. 挑一个空闲端口，用 ELECTRON_RUN_AS_NODE 模式拉起内置的 `dsh web` 服务
 *  5. 轮询 HTTP 等服务就绪，然后把窗口切换到 http://127.0.0.1:<port>
 *  6. 出错时把错误与最近日志显示在窗口内（可打开日志/重试）
 *  7. 退出时杀掉服务进程树
 */

const { app, BrowserWindow, Menu, dialog, shell } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const http = require('node:http')

const APP_ID = 'com.deepseek.dsh.desktop'
const APP_NAME = 'DeepSeek Harness'
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
  fs.mkdirSync(dshHome, { recursive: true })

  // DSH 会在 $DSH_HOME/profiles/node_modules 里为每个包建 junction 指向安装处的
  // node_modules，因此必须从 app.asar.unpacked 的真实磁盘路径拉起服务，
  // 否则 junction 目标会指向 asar 文件内部、OS 层面无法解析。
  const appBase = app.isPackaged
    ? app.getAppPath().replace(/[\\/]app\.asar$/, '$&.unpacked')
    : app.getAppPath()
  const dshBin = path.join(appBase, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const loadingPage = path.join(app.getAppPath(), 'src', 'loading.html')
  if (!fs.existsSync(dshBin)) {
    dialog.showErrorBox('DeepSeek Harness 启动失败', `找不到内置 DSH 运行时：\n${dshBin}`)
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
html,body{height:100%;margin:0}body{background:#0b0f17;color:#c9d1d9;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;padding:40px}
h1{font-size:18px;color:#f85149;margin:0 0 14px}
p{font-size:13px;color:#e6edf3;margin:0 0 10px}
pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:14px;font-size:12px;line-height:1.5;color:#8b949e;overflow:auto;max-height:46vh}
.hint{font-size:12px;color:#8b949e;margin-top:12px}</style></head><body>
<h1>DeepSeek Harness 启动失败</h1>
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
      dialog.showErrorBox('DeepSeek Harness 启动失败', `${message}\n\n完整日志：${logFile}`)
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

  async function startServer() {
    const port = await getFreePort()
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

    win.loadFile(loadingPage)
  }

  function killTree() {
    if (!server) return
    const { child } = server
    if (child.exitCode === null && !child.killed) {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } catch {
        try { child.kill() } catch { /* already gone */ }
      }
    }
  }

  async function runBoot() {
    if (booting) return
    booting = true
    try {
      if (server) {
        killTree()
        server = null
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

  const menu = Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
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
        { label: '打开数据目录', click: () => shell.openPath(userData) },
        { label: '打开服务日志', click: () => shell.openPath(logFile) },
        {
          label: `关于 ${APP_NAME}`,
          click: () => dialog.showMessageBox({
            type: 'info',
            title: '关于',
            message: APP_NAME,
            detail: `桌面版 v${app.getVersion()}\n内置 @deepseek-ai/dsh\n数据目录：${userData}`,
          }),
        },
      ],
    },
  ])
  Menu.setApplicationMenu(menu)

  app.whenReady().then(() => {
    createWindow()
    runBoot()
  })
}
