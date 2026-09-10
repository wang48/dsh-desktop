# Contributing to DSH-Desktop

Thanks for helping improve the desktop wrapper. Changes should stay focused on
desktop integration, packaging, updates, or compatibility with the upstream
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Problems
that reproduce unchanged in the official CLI or Web UI should be reported upstream.

## Development setup

Requirements:

- Node.js 22.12 or newer
- npm
- The native build tools required by Electron on your operating system

```bash
npm ci
npm start
```

`npm ci` also applies the compatibility patches in `scripts/`. A dependency
upgrade must keep every patch idempotent and fail closed when its upstream target
changes.

## Before submitting a pull request

```bash
npm run check
```

When possible, also build the package for the platform affected by your change:

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Only run the command for the current operating system unless a cross-compilation
setup is already available. Do not commit `node_modules/`, `dist/`, logs, test
homes, credentials, or generated user data.

## Pull requests

- Keep changes small enough to review and explain any upstream compatibility patch.
- Add or update tests for behavior changes.
- Update both English and Chinese README files when user-facing behavior changes.
- Mention the operating systems and package formats you tested.
- Never include API keys, access tokens, certificate material, or private paths in logs.
