# DSH-Desktop —— DeepSeek Harness 桌面版

把 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（npm 包
`@deepseek-ai/dsh`）封装成**桌面应用（Windows / macOS / Linux）**：Electron 外壳内置
完整的 DSH Web 运行时，启动后在本地拉起 `dsh web` 服务，再用原生窗口加载 UI。

> 无需安装 Node.js / pnpm，双击即用；数据与命令行版隔离。

## ✨ 特性

- **开箱即用**：内置 Electron + 完整 DSH 依赖树（无需系统 Node）
- **多端支持**：Windows（安装版/便携版）、macOS（dmg/zip，Intel + Apple Silicon）、Linux（AppImage/deb）
- **立即可见**：启动即弹窗显示加载页，服务就绪后自动切换到应用界面
- **错误可见**：启动失败时错误与最近日志直接显示在窗口内，可一键打开日志 / 重试
- **数据隔离**：DSH_HOME 位于用户数据目录下（`%APPDATA%\DSH-Desktop\home` 或 macOS/Linux 对应目录），不影响命令行版
- **单实例**：重复启动会把已有窗口带到前台
- **自动端口**：启动时挑选空闲端口，服务只在 `127.0.0.1` 监听
- **干净退出**：关闭窗口时杀掉服务进程树，不留后台进程

## 📦 下载安装

### Windows

- **免安装便携版**：从 [Releases](../../releases) 下载 `DSH-Desktop-<version>-win-<arch>-portable.exe`，双击运行。
- **安装版**：下载 `DSH-Desktop-<version>-win-<arch>-setup.exe`，安装向导支持自选目录与桌面快捷方式。

### macOS / Linux

- macOS：`DSH-Desktop-<version>-mac-<arch>.dmg`（Apple Silicon 选 arm64，Intel 选 x64）。
  未签名，首次打开请在 Finder 中右键 →「打开」绕过 Gatekeeper。
- Linux：`DSH-Desktop-<version>-linux-<arch>.AppImage`（`chmod +x` 后运行）或 `.deb` 安装包。

> ⚠️ 产物未做代码签名，Windows SmartScreen 可能提示"已保护你的电脑"，
> 点 **更多信息 → 仍要运行** 即可。

## 🧭 工作原理

```
┌────────────────────────── Electron 主进程 ──────────────────────────┐
│  1. 单实例锁，userData 下建立独立 DSH_HOME                          │
│  2. 立即打开窗口 → 加载页（src/loading.html）                        │
│  3. 挑空闲端口，以 ELECTRON_RUN_AS_NODE 模式拉起子进程：             │
│     electron.exe --expose-internals <内置 bin.js> web --port <p>    │
│  4. 轮询 http://127.0.0.1:<p>/ 等服务就绪                            │
│  5. 窗口切换到应用 URL；出错则窗口内显示错误页 + 最近日志              │
│  6. 退出时 taskkill /T 杀掉服务进程树                                │
└──────────────────────────────────────────────────────────────────────┘
```

几个关键设计点：

- **`--expose-internals`**：DSH 的 HMR 服务需要访问 Node 内部 ESM loader。系统 Node
  下有 `node-addon-require-builtin` 原生插件兜底，但 Electron 内置 Node 的 ABI 与该插件
  不匹配，必须显式传此标志走纯 JS 路径；
- **`asarUnpack: node_modules`**：DSH 首次启动会在 `$DSH_HOME/profiles/node_modules`
  里为依赖闭包中的每个包创建 junction 指向安装处。junction 目标必须是真实磁盘路径，
  因此整个 node_modules 解包到 `app.asar.unpacked`；
- **显式依赖清单**：`package.json` 中额外声明了 19 个 `@deepseek-ai/*` 包。
  它们只作为 peerDependencies 存在（npm 会自动安装），但 electron-builder 的依赖收集器
  只沿正式依赖边收集，会把纯 peer 包漏掉，导致打包产物缺包、启动报
  `ERR_MODULE_NOT_FOUND`。显式声明后打包结果确定且完整（195/195）；
- **目录选择器补丁**（`scripts/patch-picker-worker.mjs`，postinstall 自动执行）：
  koffi 的 `view()`/字符串 `decode()` 在 Electron 下会直接崩溃（V8 不支持外部内存
  ArrayBuffer 视图），导致 Windows 原生文件夹选择器选完文件夹后进程崩溃。
  补丁把 worker 的 `readUtf16` 改为 `lstrlenW` 量长 + `memcpy` 拷贝进 Node Buffer，
  该路径已在 Electron 下验证可用。

## 🗂 数据与日志

| 路径 | 说明 |
|---|---|
| Windows：`%APPDATA%\DSH-Desktop\home\` | 应用私有 DSH_HOME（会话、配置、profile） |
| macOS：`~/Library/Application Support/DSH-Desktop/home\` | 同上 |
| Linux：`~/.config/DSH-Desktop/home\` | 同上 |
| `<数据目录>\server.log` | 主进程 + DSH 服务日志（含 `[main ...]` 行） |

菜单「帮助」里可直接打开数据目录与日志；出错时窗口内的错误页也会给出日志路径。

## 🛠 开发

要求：Node.js ≥ 20（仅开发构建需要；最终用户不需要）。

```powershell
npm install          # 安装依赖（含 electron / electron-builder）
npm run gen:icon     # 重新生成 build/icon.png（可选）
npm start            # 本地运行（electron .）
npm run dist         # 打包 nsis 安装版 + portable 便携版 → dist/
```

### 网络受限环境的安装提示

electron 二进制、koffi 原生预编译等从 GitHub 下载，国内网络可能超时：

1. 若 `npm install` 因 koffi/electron 安装脚本失败：改用
   `npm install --ignore-scripts`，再手动拉取 electron 二进制：
   ```powershell
   node scripts/fetch-electron.mjs <版本> <输出zip>   # GitHub 失败自动回退 npmmirror
   # 解压 zip 到 node_modules\electron\dist\，并写入 node_modules\electron\path.txt
   ```
2. 打包时可设置镜像：
   `$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'`

### 打包说明

- `build.npmRebuild: false`：依赖均为纯 JS（koffi 无原生二进制也有降级路径，
  sharp 走 `@img/*` 预编译包），无需针对 Electron ABI 重编译；
- 本地 `npm run dist` 通过 `--config.electronDist=node_modules/electron/dist` 复用
  本地已解压的 electron（网络受限环境下很有用）；CI 不设此项，由 electron-builder
  自行下载 electron；
- CI（GitHub Actions）三平台矩阵构建（Windows/macOS/Linux）：push 触发构建，
  打 `v*` tag 自动发布 Release（含全平台安装包）。

## ❓ 常见问题

- **双击后窗口里一直是加载页**：首次启动需解压运行时并初始化 DSH，通常 1–3 分钟。
  若超过 3 分钟，窗口会显示错误与日志；可用菜单「文件 → 重试启动」。
- **SmartScreen 拦截**：未签名，选"仍要运行"。
- **杀毒软件误报 / 启动极慢**：便携版会解压到 `%TEMP%` 运行，可把
  `%APPDATA%\DSH-Desktop` 与解压目录加入白名单。
- **启动报错**：先看窗口内错误页或 `server.log`；也可删除
  `%APPDATA%\DSH-Desktop` 重置数据后重试。
- **旧版本残留**：升级前如遇异常，删除 `%APPDATA%\DSH-Desktop\home\profiles\node_modules`
  里的失效 junction（或整个数据目录），应用会自动重建。

## 📁 项目结构

```
dsh-desktop/
├── src/
│   ├── main.cjs          # Electron 主进程（拉起 DSH、窗口与生命周期管理）
│   └── loading.html      # 启动加载页
├── scripts/
│   ├── gen-icon.mjs      # 生成应用图标（纯 Node，无依赖）
│   └── fetch-electron.mjs# 带重试的 electron 二进制下载脚本（GitHub→npmmirror 回退）
├── build/icon.png        # 应用图标源文件
├── .github/workflows/    # CI：自动构建 + tag 触发 Release
└── package.json          # 依赖与 electron-builder 打包配置
```

## 📄 License

[MIT](LICENSE) © dsh-desktop contributors

本项目是对 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）的封装；
`@deepseek-ai/dsh` 及其插件版权归各自作者所有。
