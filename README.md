# DSH-Desktop — DeepSeek Harness as a Desktop App

A desktop application (**Windows / macOS / Linux**) that wraps
[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (the npm package
`@deepseek-ai/dsh`): an Electron shell bundles the complete DSH web runtime, starts the
`dsh web` server locally on launch, and loads the UI in a native window.

> No Node.js / pnpm required — double-click and go. Data is isolated from the CLI version.

> 中文文档：[README.zh-CN.md](README.zh-CN.md)。

## ✨ Features

- **Zero setup**: bundles Electron + the full DSH dependency tree (no system Node needed)
- **Cross-platform**: Windows (installer/portable), macOS (dmg/zip, Intel + Apple Silicon), Linux (AppImage/deb)
- **Visible immediately**: a window with a loading page appears instantly; it switches to the app UI once the server is ready
- **Visible errors**: startup failures show the error and recent logs inside the window, with one-click log access / retry
- **Isolated data**: DSH_HOME lives under the user-data directory (`%APPDATA%\DSH-Desktop\home` on Windows, platform equivalents elsewhere) and never touches the CLI install
- **Single instance**: launching again focuses the existing window
- **Automatic port**: a free port is picked at startup; the server listens on `127.0.0.1` only
- **Desktop settings**: WebUI toggle, optional fixed port (with conflict pre-check), rich About info — all shell-level, no DSH patching
- **Auto-update**: NSIS installs update from GitHub Releases (portable / unsigned macOS / deb fall back to the download page)
- **Clean exit**: closing the window kills the server process tree — no leftover background processes

## 📦 Installation

### Windows

- **Portable**: download `DSH-Desktop-<version>-win-<arch>-portable.exe` from [Releases](../../releases) and run it.
- **Installer**: download `DSH-Desktop-<version>-win-<arch>-setup.exe`; the wizard supports a custom install directory and desktop shortcut.

### macOS / Linux

- macOS: `DSH-Desktop-<version>-mac-<arch>.dmg` (arm64 for Apple Silicon, x64 for Intel).
  Unsigned — right-click → **Open** in Finder on first launch to bypass Gatekeeper.
  If macOS reports *"is damaged and can't be opened"* (common on macOS 15+ / Apple Silicon),
  clear the quarantine attribute first and try again:
  ```bash
  xattr -cr "/Applications/DSH-Desktop.app"
  ```
- Linux: `DSH-Desktop-<version>-linux-<arch>.AppImage` (`chmod +x` then run) or the `.deb` package.

> ⚠️ Artifacts are not code-signed. Windows SmartScreen may show "Windows protected your PC" —
> click **More info → Run anyway**.

## 🧭 How it works

```
┌────────────────────────── Electron main process ─────────────────────┐
│  1. Single-instance lock; isolated DSH_HOME under userData            │
│  2. Window opens immediately → loading page (src/loading.html)        │
│  3. Picks a free port and spawns the child in ELECTRON_RUN_AS_NODE:   │
│     electron.exe --expose-internals <bundled bin.js> web --port <p>  │
│  4. Polls http://127.0.0.1:<p>/ until the server is ready             │
│  5. Switches the window to the app URL; on error shows a page with    │
│     the error and recent logs inside the window                       │
│  6. On exit kills the server process tree (taskkill /T on Windows)    │
└────────────────────────────────────────────────────────────────────────┘
```

Key design points:

- **`--expose-internals`**: DSH's HMR service needs access to Node's internal ESM loader.
  Under system Node the `node-addon-require-builtin` native addon provides a fallback, but the
  ABI of Electron's bundled Node does not match that addon, so the flag is passed explicitly
  to use the pure-JS path;
- **`asarUnpack: node_modules`**: on first boot DSH creates a junction per package of the
  dependency closure under `$DSH_HOME/profiles/node_modules`, pointing at the installation.
  Junction targets must be real disk paths, so the whole `node_modules` is unpacked to
  `app.asar.unpacked`;
- **Explicit dependency list**: `package.json` additionally declares 19 `@deepseek-ai/*`
  packages that only exist as peerDependencies. npm auto-installs them, but electron-builder's
  node-module collector walks production dependency edges only and silently dropped them,
  causing `ERR_MODULE_NOT_FOUND` at startup. With the explicit list the packaged tree is
  deterministic and complete (195/195);
- **Directory picker patch** (`scripts/patch-picker-worker.mjs`, applied by postinstall):
  koffi's `view()` / string `decode()` abort the process under Electron (V8 does not support
  external-memory ArrayBuffer views), which crashed the Windows native folder picker after a
  folder was chosen. The patch rewrites the worker's `readUtf16` to use `lstrlenW` +
  `memcpy` into a V8-owned Buffer — verified to work under Electron;
- **Shell-level settings only**: the WebUI toggle / fixed port are persisted in
  `userData/settings.json` by the shell and passed through DSH's official CLI flags
  (`--host 127.0.0.1 --port <n>`). DSH_HOME, profiles and the composition are never touched.
  LAN exposure (`--host 0.0.0.0`) stays disabled because upstream refuses it by design —
  use an SSH tunnel instead.

## 🗂 Data & logs
| Path | Description |
|---|---|
| Windows: `%APPDATA%\DSH-Desktop\home\` | The app's private DSH_HOME (sessions, config, profiles) |
| macOS: `~/Library/Application Support/DSH-Desktop/home\` | same |
| Linux: `~/.config/DSH-Desktop/home\` | same |
| `<data dir>\settings.json` | Shell settings (WebUI toggle, fixed port) |
| `<data dir>\server.log` | Main-process + DSH server logs (with `[main ...]` lines) |

The settings page is reachable by right-clicking the window title bar; the **Help** menu
opens the data directory and the log directly.

**Migrating conversations from the official DSH** (copy-only, the original stays untouched):
see [docs/MIGRATION.md](docs/MIGRATION.md) (Chinese).

## 🛠 Development

Requires Node.js ≥ 20 (build time only; end users need nothing).

```powershell
npm install          # installs electron / electron-builder / dsh deps
npm run gen:icon     # regenerates build/icon.png (optional)
npm start            # run locally (electron .)
npm run dist         # builds nsis installer + portable exe -> dist/
```

### Restricted-network installs

The electron binary and koffi prebuilds come from GitHub, which may time out on some networks:

1. If `npm install` fails on koffi/electron install scripts, use
   `npm install --ignore-scripts` and fetch the electron binary manually:
   ```powershell
   node scripts/fetch-electron.mjs <version> <out.zip>   # falls back to npmmirror if GitHub fails
   # extract the zip to node_modules\electron\dist\ and write node_modules\electron\path.txt
   ```
2. When packaging you may set a mirror:
   `$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'`

### Packaging notes

- `build.npmRebuild: false`: all dependencies are pure JS (koffi has a fallback path without
  its native binary, sharp uses `@img/*` prebuilt packages) — no Electron-ABI rebuild needed;
- Local `npm run dist` passes `--config.electronDist=node_modules/electron/dist` to reuse the
  manually extracted electron (handy behind restricted networks); CI omits it and lets
  electron-builder download electron itself;
- CI (GitHub Actions) builds a three-platform matrix (Windows/macOS/Linux): pushes build
  artifacts, `v*` tags automatically publish a Release with all installers plus the
  `latest*.yml` update metadata used by the auto-updater.

## ❓ FAQ

- **The window stays on the loading page**: the first launch extracts the runtime and
  initializes DSH, usually 1–3 minutes. Past that, the window shows the error and logs; use
  the title-bar right-click menu → Retry startup.
- **SmartScreen blocks the app**: it is unsigned — choose "Run anyway".
- **Antivirus false positives / very slow startup**: the portable build extracts to `%TEMP%`;
  whitelist `%APPDATA%\DSH-Desktop` and the extraction directory.
- **Startup errors**: check the in-window error page or `server.log`; deleting
  `%APPDATA%\DSH-Desktop` resets the app state.
- **Leftovers from older versions**: on trouble after upgrading, delete the stale junctions
  under `%APPDATA%\DSH-Desktop\home\profiles\node_modules` (or the whole data dir); the app
  rebuilds them automatically.

## 🗺 Desktop feature roadmap

Compatibility research and design for auto-update, the WebUI toggle, and custom
ports: [docs/FEATURES.md](docs/FEATURES.md) (Chinese).

## 📁 Project layout

```
dsh-desktop/
├── src/
│   ├── main.cjs          # Electron main process (spawns DSH, windows, lifecycle)
│   ├── preload.cjs       # settings-page IPC bridge (contextBridge)
│   ├── settings.cjs      # shell settings store (userData/settings.json)
│   ├── control.html      # settings page (DSH design tokens)
│   └── loading.html      # startup loading page
├── scripts/
│   ├── gen-icon.mjs      # generates the app icon (pure Node, no deps)
│   ├── fetch-electron.mjs# retrying electron binary download (GitHub → npmmirror fallback)
│   └── patch-picker-worker.mjs # postinstall patch for the koffi/Electron picker crash
├── docs/FEATURES.md      # desktop-features compatibility research (Chinese)
├── build/icon.png        # app icon source
├── .github/workflows/    # CI: builds on push, Releases on v* tags
└── package.json          # dependencies and electron-builder config
```

## 📄 License

[MIT](LICENSE) © dsh-desktop contributors

This project is a wrapper around [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (MIT);
`@deepseek-ai/dsh` and its plugins are copyrighted by their respective authors.
