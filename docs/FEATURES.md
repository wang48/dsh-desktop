# DSH-Desktop 桌面功能设计（升级 / WebUI 开关 / 开放端口）

> 原则：**只做原版封装，完全兼容原版**。所有功能都在 Electron 外壳层实现，
> 不修改、不替换、不 patch `@deepseek-ai/dsh` 的任何代码与行为；
> 外壳只通过 DSH 官方 CLI 参数与文档化机制工作。

## 现状与结论速览

| 功能 | 可行性 | 兼容方式 |
|---|---|---|
| ① 应用升级 | ✅ 可行 | 纯外壳（electron-updater + GitHub Release），DSH 零感知 |
| ② WebUI 开关 | ✅ 可行 | 纯外壳（设置决定是否拉起 `dsh web` 子进程） |
| ③a 固定端口（127.0.0.1） | ✅ 可行 | 官方参数 `--host 127.0.0.1 --port <n>` |
| ③b 开放端口（局域网 0.0.0.0） | ⛔ 上游硬性拒绝 | 见下，**不建议绕过**；推荐 SSH 隧道方案 |

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

## ② WebUI 开关

### 语义

设置项 `web.enabled`（默认 `true`）：

- `true`：现状——拉起 `dsh web`，窗口加载 WebUI；
- `false`：**不拉起** `dsh web` 子进程；窗口显示本地控制页
  （`src/control.html` + preload IPC），提供「启用 WebUI」按钮与说明。

用途：只把桌面版当"外壳管理器"的机器（例如先配置再启用）、排查问题时停服、
或未来接入"只跑 headless agent"模式。

### 实现要点（纯外壳）

1. `userData/settings.json`（原子写）：`{ "web": { "enabled": true, "host": "127.0.0.1", "port": 0 } }`；
2. `runBoot()` 开头读设置：`enabled === false` → 直接 `win.loadFile(control.html)`，跳过 spawn；
3. 控制页通过 preload（`contextBridge` 暴露 `getSettings/setSettings/restart`）读写设置并触发
   `runBoot()` 重启子进程——复用现有重启路径（菜单「文件 → 重试启动」同款）；
4. 菜单增加「设置」入口（打开控制页）。

### 兼容性

- `enabled=true` 时 spawn 命令与现在逐字节一致；
- 设置文件是外壳自有文件（`userData/settings.json`），不写入 DSH_HOME、不改 profile、不加 patch。

## ③ 开放端口

### ③a 固定端口（127.0.0.1，✅ 支持）

- DSH 官方支持：`dsh web --host 127.0.0.1 --port <n>`（`--help` 已确认，`--port 0` = 系统分配）；
- 设置项 `web.port`：`0` = 自动（默认，现状行为），正整数 = 固定端口（占用时启动失败并显示错误页）；
- 用途：让本机其他工具（浏览器扩展、MCP 客户端、脚本）稳定连接桌面版 API。

### ③b 局域网开放（0.0.0.0，⛔ 上游硬性拒绝）

**实测 + 源码确认**（`@deepseek-ai/dsh-web-app/lib/startup.js:39`）：

```
error: --host 0.0.0.0 is intentionally not supported yet for safety:
it would expose remote code execution to the network; use 127.0.0.1 instead
```

- 这是**参数解析层的硬拒绝**（`program.error`），无环境变量开关；
- 错误信息明确：暴露到网络 = 暴露远程代码执行（agent 工具可执行任意命令），
  上游将此视为安全问题而非未实现能力（"not supported **yet**"，未来可能提供带鉴权的形态）；
- webserver 层的 `host` schema 只接受 `127.0.0.1 | 0.0.0.0`，
  LAN 信任机制（`trustedHosts = [...lanAddresses, ...extra]` 与 `--trusted-host` 围栏）已就绪，
  是上游为将来的安全开放形态预留的。

### 兼容方案（不绕开上游安全门禁）

| 方案 | 说明 | 推荐度 |
|---|---|---|
| **SSH 隧道** | 固定端口（③a）+ `ssh -L 127.0.0.1:<p>:127.0.0.1:<p> user@host`，经认证隧道访问，流量仍是回环。DSH 自身的 `dsh-ssh` 插件/`ssh_tunnel` 工具就是这个模式 | ⭐ 推荐 |
| 反向代理（外壳内） | 外壳自建 `0.0.0.0` 监听并转发到回环端口。技术上可行，但**绕开了上游明确的安全拒绝**（把 RCE 面暴露到网络），违反"完全兼容原版"的约束，仅可作为显式 opt-in + 醒目警告的后续讨论项 | ⚠️ 不建议 |
| 等上游支持 | 上游措辞为 "not supported yet"，待其提供带鉴权的开放形态后，外壳透传其官方参数即可 | ⏳ 长期 |

**结论**：桌面版应实现 ③a（固定端口），把"开放端口/局域网"场景导向 SSH 隧道方案；
在设置 UI 中写明原因并附上游错误原文，不提供绕过入口。

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
