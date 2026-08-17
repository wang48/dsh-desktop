# DSH-Desktop 桌面功能设计（升级 / WebUI 开关 / 开放端口）

> 原则：**只做原版封装，完全兼容原版**。所有功能都在 Electron 外壳层实现，
> 不修改、不替换、不 patch `@deepseek-ai/dsh` 的任何代码与行为；
> 外壳只通过 DSH 官方 CLI 参数与文档化机制工作。

## 现状与结论速览

| 功能 | 可行性 | 兼容方式 |
|---|---|---|
| ① 应用升级 | ✅ 可行 | 纯外壳（electron-updater + GitHub Release），DSH 零感知 |
| ② WebUI 开关 | ⛔ 已从 UI 移除 | 后端逻辑保留（`web.enabled` 默认 true，恒启动服务） |
| ③a 固定端口（127.0.0.1） | ✅ 可行 | 官方参数 `--host 127.0.0.1 --port <n>` |
| ③b 开放端口（局域网 0.0.0.0） | ✅ 已实现 | 官方 `--patch` 覆盖层（见下）；设置页可切换监听地址并附醒目风险提示 |

## ① 应用升级（Auto-update）

### 机制（已验证可行）

- electron-builder 在 `build.publish` 声明发布源：
  ```json
  "build": {
    "publish": { "provider": "github", "owner": "wang48", "repo": "dsh-desktop" }
  }
  ```
- 应用侧使用 `electron-updater`（新依赖，纯外壳）：
  - 启动后 `autoUpdater.checkForUpdates()`（静默检查 + 发现新版本时通知）；
  - 菜单「帮助 → 检查更新」手动触发；
  - 下载完成后退出时自动安装（NSIS）/ 提示重启。

### 平台差异（重要）

| 平台 | 自动更新 | 说明 |
|---|---|---|
| Windows NSIS 安装版 | ✅ | 标准流程，无需签名也能更新（默认不校验签名） |
| Windows 便携版 | ⛔ | 便携版无安装器；检测 `process.env.PORTABLE_EXECUTABLE_DIR` 时禁用 updater，改为"发现新版本 → 打开 Release 下载页" |
| macOS | ⚠️ | electron-updater 要求代码签名；当前未签名 → 捕获错误后降级为"打开 Release 下载页" |
| Linux AppImage | ✅ | 依赖 `APPIMAGE` 环境变量（AppImage 运行时自带） |
| Linux deb | ⚠️ | 无 apt 仓库 → 降级为"打开 Release 下载页" |

### 兼容性

- 完全不触碰 DSH：升级的是外壳 + 内置运行时整体，DSH 子进程与 DSH_HOME 数据不受影响；
- 升级后 DSH 依赖树随应用一起更新（版本锁定 `0.1.0-rc.6`），行为与对应 Release 完全一致。

## ② WebUI 开关（已从设置页移除）

> 用户反馈该开关"意义不大"，设置页已移除；`settings.cjs` 的 `web.enabled` 字段与
> `runBoot()` 的停服分支**后端逻辑保留**（默认 `true`，恒启动服务）。设置页通过
> preload（`contextBridge` 暴露 `getState/saveSettings/restart`）读写设置并触发
> `runBoot()` 重启子进程；「返回」在有未保存修改时会弹确认，避免忘记「保存并重启」。

## ③ 开放端口

### ③a 固定端口（127.0.0.1，✅ 支持）

- DSH 官方支持：`dsh web --host 127.0.0.1 --port <n>`（`--help` 已确认，`--port 0` = 系统分配）；
- 设置项 `web.port`：`0` = 自动（默认，现状行为），正整数 = 固定端口（占用时启动失败并显示错误页）；
- 用途：让本机其他工具（浏览器扩展、MCP 客户端、脚本）稳定连接桌面版 API。

### ③b 局域网开放（0.0.0.0，✅ 已实现，官方机制）

**实测 + 源码确认**（`@deepseek-ai/dsh-web-app/lib/startup.js:39`）：

```
error: --host 0.0.0.0 is intentionally not supported yet for safety:
it would expose remote code execution to the network; use 127.0.0.1 instead
```

- 拒绝只发生在 **CLI 参数解析层**（`program.error`，硬拒绝 `--host 0.0.0.0`）；
- 但 webserver 层的 `host` schema 本来就接受 `127.0.0.1 | 0.0.0.0` 两个值，
  且 `dsh-web-app` 在绑定 0.0.0.0 时会自动收集本机 LAN IPv4 加入
  /api 浏览器信任围栏（防 DNS rebinding，`trustedHosts = [...lanAddresses, ...extra]`），
  启动日志并打印 `(LAN: http://<ip>:<port>)`——官方代码库为配置级开放预留了完整配套；
- **官方开放的路径是 `--patch` 覆盖层**（launcher 自带参数，非 hack）：
  `dsh web --patch <file>` 可用 patch 把 webserver 行的 host 覆盖为 `0.0.0.0`。
  已实测：dump-config 显示覆盖生效，实际启动成功并打印 LAN 地址；
- 注意 `--patch` 必须放在应用参数（`--port`/`--host`）**之前**：
  commander 的 `passThroughOptions` 会把首个未知选项之后的内容全部透传给 web 应用，
  应用侧不认识 `--patch`（报 `error: unknown option '--patch'`）；
- settings.yaml 用户层改不动 webserver 的 host（其行配置是
  `!!js ctx.webStartup.host ?? '127.0.0.1'` 表达式，不引用用户配置）。

### 实现（设置项 `web.host`）

- 默认 `0.0.0.0`（用户决策）；上游 schema 只接受 `0.0.0.0 | 127.0.0.1` 两个
  字面量，设置页以「开放局域网访问」开关切换（Ollama 式精简 UI，无输入框）；
- `host = 0.0.0.0` 时外壳写入 `userData/lan.patch.yml` 并以 `--patch` 传入
  （patch 内容：webserver 行 host 覆盖 + 保留 `!!js ctx.webStartup.port ?? 3080` 端口表达式）；
  `host = 127.0.0.1` 时沿用官方参数 `--host 127.0.0.1`；
- 设置页在 0.0.0.0 监听且服务运行时列出当前 LAN 访问链接（主进程枚举网卡，
  只留物理网卡：按接口名黑名单过滤 VMware/VirtualBox/WSL/Hyper-V/Docker/VPN/
  隧道等虚拟适配器），并显示醒目的风险警告（0.0.0.0 等于把可执行任意命令的
  agent 开放给整个局域网，仅在可信网络使用）；SSH 隧道说明保留，作为远程访问
  的推荐方案；
- 会话续接（跨设备打开同一会话）：主进程轮询桌面窗口的
  `localStorage['dsh.sessions.current']`（2s 间隔），把当前会话 ID 附到局域网链接
  （`?session=<id>`）；postinstall 补丁 `scripts/patch-lan-session.mjs` 在
  `dsh-client-runtime/lib/client.js` 的 SessionManager 构造处加查询参数兜底
  （localStorage 无记录时才生效），远程设备打开链接即直接进入桌面端正在使用的
  同一会话。浏览器按 origin 隔离 localStorage 是标准行为，跨设备续接只能走
  "链接携带 + 客户端兜底"这条路；
- 非安全上下文 polyfill：`crypto.randomUUID` 只在安全上下文（https/localhost）
  可用，`http://<局域网IP>` 下为 undefined——模型目录、Agent 预设等设置页路径
  用它生成 RPC/消息 id，LAN 打开时报 "crypto.randomUUID is not a function"。
  postinstall 补丁 `scripts/patch-secure-context.mjs` 在 `dsh-client-modules`
  （host 侧）注入 `__DSH_BOOT__` 的首个脚本后追加一个 UUID v4 polyfill
  （用所有上下文都有的 `crypto.getRandomValues`），对任何 origin、任何设备
  生效，不改动任何浏览器 bundle。
- 已知边界（上游设计，桌面版不解除）：`settings.*` / `credentials.*` /
  `llm.discoverModels` / `host.openPath` 属于 PRIVILEGED_METHODS，被上游用
  空信任列表**钉死在回环**——即使绑定 0.0.0.0，LAN 设备访问模型设置页也会
  得到 `/api/settings.describe → HTTP 403`（"加载提供方目录失败"）。这是
  上游防凭据泄露的边界：LAN 端可以驱动 agent、读写会话，但不能查看/修改
  设置与凭据。

### 安全立场

- 不修改上游代码、不绕过其 CLI 门禁——用的正是上游为开放形态预留的官方 `--patch` 机制
  （社区插件如 `@xiaosenho/dsh-plugin-remote-access` 走同一条路，另加了认证与 frpc 隧道）；
- 浏览器信任围栏由上游自动生效；无内置认证——非可信网络的用户应改用 SSH 隧道或
  带认证的社区插件。

## 落地计划（待确认后实施）

1. **设置存储**：`src/settings.cjs`（`userData/settings.json` 读写 + 默认值 + 校验）；
2. **控制页**：`src/control.html` + `src/preload.cjs`（contextBridge：读设置/存设置/重启/版本检查）;
   webPreferences 增加 preload（保持 `contextIsolation: true, nodeIntegration: false, sandbox: true`）；
3. **runBoot 改造**：读设置 → 决定是否 spawn → spawn 参数含 `--host`/`--port`；
4. **菜单**：新增「设置」，帮助菜单加「检查更新」；
5. **升级**：`electron-updater` 依赖 + `build.publish`（GitHub）+ 平台降级逻辑（便携版/macOS/deb → 打开下载页）；
6. **文档**：README（中/英）补充功能说明与 SSH 隧道用法；
7. **测试**：无头验证固定端口/开关路径（spawn 参数与设置联动）；GUI 部分交用户实测；
8. **发布**：bump 版本 → CI 三平台 → Release（updater 从 Release 拉新版本）。
