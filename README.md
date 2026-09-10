# DSH-Desktop

[![CI](https://github.com/wang48/dsh-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/wang48/dsh-desktop/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/wang48/dsh-desktop?include_prereleases)](https://github.com/wang48/dsh-desktop/releases)
[![License](https://img.shields.io/github/license/wang48/dsh-desktop)](LICENSE)

A cross-platform desktop app for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (the npm package
`@deepseek-ai/dsh`). The Electron shell bundles the complete DSH Web runtime, starts
`dsh web` locally, and presents it in a native desktop window.

> Community-maintained, not affiliated with DeepSeek.
> No Node.js / pnpm required - double-click and go. Data is isolated from the CLI version.
>
> 中文文档：[README.zh-CN.md](README.zh-CN.md)。

## Features

- **Zero setup**: bundles Electron + the full DSH dependency tree (no system Node needed)
- **Cross-platform**: Windows (installer/portable), macOS (dmg/zip, Intel + Apple Silicon), Linux (AppImage/deb)
- **Isolated data**: DSH_HOME lives under the user-data directory and never touches the CLI install; single-instance
- **Desktop integration**: optional fixed port, LAN access, runtime details, native menus, and automatic updates
- **Clean exit**: closing the window kills the server process tree - no leftover background processes
- **Integrated macOS title bar**: on macOS the native title-bar strip is removed and the traffic-light
  buttons float over the app's own surface (sidebar/header background); the top strip stays draggable
  (double-click to zoom, right-click for the app menu). Windows/Linux keep the system title bar.

Compatibility fixes are applied during dependency installation and are guarded by
regression tests. The scripts fail closed when an upstream package changes, so an
unreviewed patch is never silently applied to a new dependency layout.

## Install

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

Use only downloads from this repository's [Releases](../../releases) page. Release
candidates contain `-rc` in the version and may be less stable than the latest release.

## Data

| Path | Description |
|---|---|
| Windows: `%APPDATA%\DSH-Desktop\home\` | The app's private DSH_HOME (sessions, config, profiles) |
| macOS: `~/Library/Application Support/DSH-Desktop/home\` | same |
| Linux: `~/.config/DSH-Desktop/home\` | same |

Shell settings live in `<data dir>\settings.json`, logs in `<data dir>\server.log` -
both reachable via the title-bar right-click menu.

Migrating conversations from the official DSH (copy-only, the original stays untouched):
see [docs/MIGRATION.md](docs/MIGRATION.md) (Chinese).

## LAN access

The desktop settings can bind the Web UI to `0.0.0.0` and show access links for the
local network. The current default is `0.0.0.0`; select the loopback-only option in
Settings if other devices should not be able to connect.

> **Security warning:** any device that can reach the service may control an agent
> capable of running commands on this computer. DSH-Desktop does not add authentication.
> Use this only on a trusted LAN; for remote access, prefer an SSH tunnel or another
> authenticated access layer. Do not expose the port directly to the public internet.

Upstream DSH still restricts privileged settings and credential methods to loopback;
a `403` response for those pages from another device is expected.

## Development

Requires Node.js 22.12 or newer (build time only; end users need nothing).

```bash
npm ci          # install the locked dependencies and compatibility patches
npm start       # run locally (electron .)
npm run check   # syntax checks and integration tests
npm run dist    # package for the current operating system -> dist/
```

Platform-specific package commands are `npm run dist:win`, `npm run dist:mac`, and
`npm run dist:linux`. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution and
verification guidelines.

## FAQ

- **Stuck on the loading page**: the first launch initializes DSH, usually 1-3 minutes.
  Past that the window shows the error and logs - right-click the title bar → Retry startup.
- **SmartScreen / Gatekeeper warnings**: Windows builds are unsigned (see install notes);
  macOS builds are signed and notarized since v0.2.4.
- **Something broke**: check the in-window error page or `server.log`; deleting the data
  directory (`%APPDATA%\DSH-Desktop` on Windows) resets the app state.
- **A problem also occurs in official DSH**: report it to the
  [upstream project](https://github.com/deepseek-ai/deepseek-harness/issues). For
  desktop packaging, update, or OS integration issues, use this repository's
  [issue tracker](../../issues).

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Built on [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
(MIT); `@deepseek-ai/dsh` and its plugins are copyrighted by their respective authors.
