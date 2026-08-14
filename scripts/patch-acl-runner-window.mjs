// 修复 Windows ACL 沙箱 runner 弹 CMD 窗口的问题。
//
// 背景：Windows 上 read-only 沙箱模式的 pwsh 工具经由
// dsh-sandbox-windows-acl 的 CreateProcessAsUserW 以受限令牌启动。该 API
// 的子进程不继承调用者（runner）的控制台，而 runner 又不能用 CREATE_NO_WINDOW
// （受限令牌下子进程在 DLL 初始化时以 STATUS_DLL_INIT_FAILED 死亡，见上游
// README），因此 pwsh（控制台程序）每次执行都会被分配一个可见的新控制台窗口
// ——"命令行窗口弹一下又消失"。
//
// 修复：STARTUPINFO 加 STARTF_USESHOWWINDOW(0x1) + wShowWindow=SW_HIDE(0)，
// 让受限令牌子进程的控制台窗口创建即隐藏（不闪烁、不弹窗，也不触发上游
// 记载的 CREATE_NO_WINDOW 崩溃路径）。已验证：窗口存在但 IsWindowVisible=0。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', 'types-CNjZgO4h.js')
const MARKER = 'dsh-desktop patch: STARTF_USESHOWWINDOW + SW_HIDE for restricted-token children'

// spawnSandboxed（管道 stdio）
const ORIG_PIPE = `		dwFlags: 256,
		hStdInput: stdIn.read,`
const PATCH_PIPE = `		dwFlags: 256 | 1,
		wShowWindow: 0, // ${MARKER}
		hStdInput: stdIn.read,`

// spawnSandboxedInherited（继承 stdio）
const ORIG_INHERIT = `		dwFlags: 256,
		hStdInput: stdIn,`
const PATCH_INHERIT = `		dwFlags: 256 | 1,
		wShowWindow: 0, // ${MARKER}
		hStdInput: stdIn,`

if (!existsSync(target)) {
  console.error(`[patch-acl-runner-window] target not found: ${target}`)
  process.exit(1)
}

const source = readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
if (source.includes(MARKER)) {
  console.log('[patch-acl-runner-window] already patched, skip')
  process.exit(0)
}

for (const [label, original, patched] of [
  ['spawnSandboxed', ORIG_PIPE, PATCH_PIPE],
  ['spawnSandboxedInherited', ORIG_INHERIT, PATCH_INHERIT],
]) {
  if (!source.includes(original)) {
    console.error(`[patch-acl-runner-window] ERROR: expected ${label} block not found (package updated?): ${target}`)
    process.exit(1)
  }
}

writeFileSync(target, source.replace(ORIG_PIPE, PATCH_PIPE).replace(ORIG_INHERIT, PATCH_INHERIT))
console.log('[patch-acl-runner-window] patched:', target)
