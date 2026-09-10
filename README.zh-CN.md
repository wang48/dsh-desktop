# DSH-Desktop

[![CI](https://github.com/wang48/dsh-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/wang48/dsh-desktop/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/wang48/dsh-desktop?include_prereleases)](https://github.com/wang48/dsh-desktop/releases)
[![License](https://img.shields.io/github/license/wang48/dsh-desktop)](LICENSE)

把 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（npm 包
`@deepseek-ai/dsh`）封装成**桌面应用（Windows / macOS / Linux）**：Electron 外壳内置
完整的 DSH Web 运行时，启动后在本地拉起 `dsh web` 服务，再用原生窗口加载 UI。

> 社区维护项目，与 DeepSeek 官方无关。
> 无需安装 Node.js / pnpm，双击即用；数据与命令行版隔离。
>
> English docs: [README.md](README.md)。

## 特性

- **开箱即用**：内置 Electron + 完整 DSH 依赖树（无需系统 Node）
- **多端支持**：Windows（安装版/便携版）、macOS（dmg/zip，Intel + Apple Silicon）、Linux（AppImage/deb）
- **数据隔离**：DSH_HOME 位于用户数据目录下，不影响命令行版；单实例
- **桌面集成**：可选固定端口、局域网访问、运行时信息、原生菜单和自动更新
- **干净退出**：关闭窗口时杀掉服务进程树，不留后台进程
- **macOS 一体式标题栏**：macOS 下移除独立标题栏条，红绿灯悬浮在页面自身表面
  （侧栏/对话头部背景）上，与页面融为一体；顶部保留可拖拽区（双击缩放、右键弹应用菜单）。
  Windows/Linux 保持系统标题栏。

依赖安装阶段会应用少量 Electron/平台兼容补丁，并由回归测试守护。上游文件结构发生
变化时补丁会直接失败，避免把未经确认的修改静默套用到新版本依赖。

## 安装

### Windows

- **免安装便携版**：从 [Releases](../../releases) 下载 `DSH-Desktop-<version>-win-<arch>-portable.exe`，双击运行。
- **安装版**：下载 `DSH-Desktop-<version>-win-<arch>-setup.exe`，安装向导支持自选目录与桌面快捷方式。

### macOS / Linux

- macOS：`DSH-Desktop-<version>-mac-<arch>.dmg`（Apple Silicon 选 arm64，Intel 选 x64）。
  v0.2.4 起已签名 + 公证，首次打开只需确认下载来源。
  若仍提示**"已损坏，无法打开"**，先清除隔离属性再试：
  ```bash
  xattr -cr "/Applications/DSH-Desktop.app"
  ```
- Linux：`DSH-Desktop-<version>-linux-<arch>.AppImage`（`chmod +x` 后运行）或 `.deb` 安装包。

> ⚠️ Windows 产物未做代码签名，SmartScreen 可能提示"已保护你的电脑"，点 **更多信息 → 仍要运行**。

请只从本仓库的 [Releases](../../releases) 页面下载。版本号带 `-rc` 的是候选版本，
稳定性可能低于 Latest 正式版。

## 数据与迁移

| 路径 | 说明 |
|---|---|
| Windows：`%APPDATA%\DSH-Desktop\home\` | 桌面版专属 DSH_HOME（会话、配置、profiles） |
| macOS：`~/Library/Application Support/DSH-Desktop/home\` | 同上 |
| Linux：`~/.config/DSH-Desktop/home\` | 同上 |

外壳设置存于 `<数据目录>\settings.json`，日志存于 `<数据目录>\server.log`，
均可通过标题栏右键菜单打开。

从官方 DSH 迁移历史会话（只复制、原版不受影响）：见 [docs/MIGRATION.md](docs/MIGRATION.md)。

## 局域网访问

桌面设置可让 Web UI 监听 `0.0.0.0`，并显示本机局域网访问链接。当前默认值是
`0.0.0.0`；如果不希望其他设备连接，请在设置中切换为仅本机回环地址。

> **安全警告：**能访问该服务的设备可能控制一个可在本机执行命令的 agent。
> DSH-Desktop 不额外提供身份认证。仅在可信局域网中使用；远程访问应优先使用
> SSH 隧道或其他带认证的访问层，切勿把端口直接暴露到公网。

上游 DSH 仍会把设置、凭据等特权方法限制在本机回环地址；其他设备访问相关页面时
出现 `403` 属于预期的安全边界。

## 开发

仅构建时需要 Node.js 22.12 或更高版本（最终用户无需安装任何环境）。

```bash
npm ci          # 安装锁定依赖并应用兼容补丁
npm start       # 本地运行（electron .）
npm run check   # 语法检查与集成测试
npm run dist    # 为当前操作系统打包 -> dist/
```

平台专用命令为 `npm run dist:win`、`npm run dist:mac` 和 `npm run dist:linux`。
贡献与验证说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 常见问题

- **窗口一直停在加载页**：首次启动需初始化 DSH，通常 1-3 分钟；之后仍未就绪，
  窗口内会显示错误与日志，可右键标题栏 → 重试启动。
- **SmartScreen / Gatekeeper 拦截**：Windows 产物未签名（见安装说明）；macOS 自 v0.2.4 起已签名 + 公证。
- **启动异常**：查看窗口内错误页或 `server.log`；删除数据目录（Windows 为
  `%APPDATA%\DSH-Desktop`）可重置应用状态。
- **问题也能在官方 DSH 复现**：请反馈到
  [上游项目](https://github.com/deepseek-ai/deepseek-harness/issues)；桌面打包、升级或
  系统集成问题请使用本仓库的 [Issues](../../issues)。

安全漏洞请按 [SECURITY.md](SECURITY.md) 说明私下报告，不要创建公开 Issue。

## 许可证

[MIT](LICENSE)。基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
（MIT）；`@deepseek-ai/dsh` 及其插件版权归其各自作者所有。
