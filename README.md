# DSH-Desktop - DeepSeek Harness as a Desktop App

A desktop wrapper for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
(the npm package `@deepseek-ai/dsh`): an Electron shell bundles the complete DSH web
runtime, starts `dsh web` locally on launch, and loads the UI in a native window.

> Community-maintained, not affiliated with DeepSeek.
> No Node.js / pnpm required - double-click and go. Data is isolated from the CLI version.
>
> 中文文档：[README.zh-CN.md](README.zh-CN.md)。

## ✨ Features

- **Zero setup**: bundles Electron + the full DSH dependency tree (no system Node needed)
- **Cross-platform**: Windows (installer/portable), macOS (dmg/zip, Intel + Apple Silicon), Linux (AppImage/deb)
- **Isolated data**: DSH_HOME lives under the user-data directory and never touches the CLI install; single-instance
- **Desktop settings**: WebUI toggle, optional fixed port, rich About info, auto-update - all shell-level, no DSH patching
- **Clean exit**: closing the window kills the server process tree - no leftover background processes

## 📦 Installation

### Windows

- **Portable**: download `DSH-Desktop-<version>-win-<arch>-portable.exe` from [Releases](../../releases) and run it.
- **Installer**: download `DSH-Desktop-<version>-win-<arch>-setup.exe`; the wizard supports a custom install directory and desktop shortcut.

### macOS / Linux

- macOS: `DSH-Desktop-<version>-mac-<arch>.dmg` (arm64 for Apple Silicon, x64 for Intel).
  Signed and notarized since v0.2.4; the first launch only asks to confirm the download.
  If macOS still reports *"is damaged and can't be opened"*, clear the quarantine attribute:
  ```bash
  xattr -cr "/Applications/DSH-Desktop.app"
  ```
- Linux: `DSH-Desktop-<version>-linux-<arch>.AppImage` (`chmod +x` then run) or the `.deb` package.

> ⚠️ Windows builds are not code-signed - SmartScreen may warn; choose **More info → Run anyway**.

## 🗂 Data & migration

| Path | Description |
|---|---|
| Windows: `%APPDATA%\DSH-Desktop\home\` | The app's private DSH_HOME (sessions, config, profiles) |
| macOS: `~/Library/Application Support/DSH-Desktop/home\` | same |
| Linux: `~/.config/DSH-Desktop/home\` | same |

Shell settings live in `<data dir>\settings.json`, logs in `<data dir>\server.log` -
both reachable via the title-bar right-click menu.

Migrating conversations from the official DSH (copy-only, the original stays untouched):
see [docs/MIGRATION.md](docs/MIGRATION.md) (Chinese).

## 🛠 Development

Requires Node.js ≥ 20 (build time only; end users need nothing).

```powershell
npm install    # electron / electron-builder / dsh deps
npm start      # run locally (electron .)
npm run dist   # build Windows installer + portable exe -> dist/
```

## ❓ FAQ

- **Stuck on the loading page**: the first launch initializes DSH, usually 1-3 minutes.
  Past that the window shows the error and logs - right-click the title bar → Retry startup.
- **SmartScreen / Gatekeeper warnings**: Windows builds are unsigned (see install notes);
  macOS builds are signed and notarized since v0.2.4.
- **Something broke**: check the in-window error page or `server.log`; deleting the data
  directory (`%APPDATA%\DSH-Desktop` on Windows) resets the app state.

## 📄 License

[MIT](LICENSE). Built on [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
(MIT); `@deepseek-ai/dsh` and its plugins are copyrighted by their respective authors.
