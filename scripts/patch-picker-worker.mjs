// 修复 dsh-host-directory-picker-native 的 worker 在 Electron 下崩溃的问题。
//
// 背景：koffi.view()/decode('str16') 需要 V8 外部内存 ArrayBuffer 视图，
// Electron（run-as-node 模式）的 V8 不支持该路径，调用直接 FATAL 崩溃
// （目录选择器"worker exited before reporting a result"的根因）。
// 系统 Node 下正常，仅 Electron 复现，koffi 3.1.4/3.1.5 均如此。
//
// 修复：readUtf16 改为 lstrlenW 量长 + memcpy 拷贝进 V8 自有 Buffer，
// 该路径在 Electron 下验证可用。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const workerPath = join(root, 'node_modules', '@deepseek-ai', 'dsh-host-directory-picker-native', 'lib', 'worker.cjs')
const MARKER = 'dsh-desktop patch: koffi.view is unsupported under Electron'

const ORIGINAL = `function readUtf16(koffi, address) {
	const bytes = Buffer.from(koffi.view(address, 32768));
	let end = 0;
	while (end + 1 < bytes.length && bytes[end] !== 0) end += 2;
	return bytes.toString("utf16le", 0, end);
}`

const PATCHED = `function readUtf16(koffi, address) {
	// ${MARKER}
	// (V8 external ArrayBuffer views abort the process there); measure the
	// string with lstrlenW and copy it into a V8-owned Buffer via memcpy.
	if (readUtf16.lstrlenW === void 0)
		readUtf16.lstrlenW = koffi.load("kernel32.dll").func("__stdcall", "lstrlenW", "int32", ["void *"]);
	if (readUtf16.memcpy === void 0)
		readUtf16.memcpy = koffi.load("msvcrt.dll").func("void * memcpy(void *dest, const void *src, size_t size)");
	const units = readUtf16.lstrlenW(address);
	const bytes = Buffer.alloc((units + 1) * 2);
	readUtf16.memcpy(bytes, address, (units + 1) * 2);
	return bytes.toString("utf16le", 0, units * 2);
}`

if (!existsSync(workerPath)) {
  console.error(`[patch-picker-worker] worker not found: ${workerPath}`)
  process.exit(1)
}

const source = readFileSync(workerPath, 'utf8').replace(/\r\n/g, '\n')
if (source.includes(MARKER)) {
  console.log('[patch-picker-worker] already patched, skip')
  process.exit(0)
}
if (!source.includes(ORIGINAL)) {
  console.error('[patch-picker-worker] ERROR: expected readUtf16 block not found (package updated?):', workerPath)
  process.exit(1)
}
writeFileSync(workerPath, source.replace(ORIGINAL, PATCHED))
console.log('[patch-picker-worker] patched:', workerPath)
