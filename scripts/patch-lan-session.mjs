// 局域网/远程访问的会话续接：让 ?session=<id> 查询参数在 localStorage
// 没有"当前会话"记录时（换设备/换 origin 打开 LAN 链接的场景）作为兜底，
// 自动打开桌面端正在使用的同一会话。
//
// 背景：上游 Web UI 把"当前打开的会话"持久化在 per-origin localStorage
// （dsh.sessions.current）。localhost:3022 与 10.x.x.x:3022 是不同 origin，
// 远程设备首次打开 LAN 链接时没有该记录，于是落到一个新会话——看起来像
// "另一个实例"。浏览器不允许跨 origin 共享 localStorage，因此由壳在
// 局域网链接上附带 ?session=<id>，这里读取并恢复。
//
// 改动面：仅 dsh-client-runtime 的 SessionManager 构造入参（一行兜底），
// 其余行为与上游完全一致；localStorage 有记录时查询参数不生效。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientPath = join(root, 'node_modules', '@deepseek-ai', 'dsh-client-runtime', 'lib', 'client.js')
const MARKER = 'dsh-desktop patch: LAN ?session='

const ORIGINAL = 'this.manager = new SessionManager(api, remote, restored.sessionId, restored.subagentAddress, conversation);'

const PATCHED = `let sessionIdForBoot = restored.sessionId;
if (sessionIdForBoot === void 0) {
	try {
		// ${MARKER} 兜底：localStorage 无记录时按查询参数恢复会话
		const lanSession = new URLSearchParams(window.location.search).get("session");
		if (lanSession !== null && lanSession !== "") sessionIdForBoot = lanSession;
	} catch { /* 查询参数兜底失败不影响启动 */ }
}
this.manager = new SessionManager(api, remote, sessionIdForBoot, restored.subagentAddress, conversation);`

if (!existsSync(clientPath)) {
  console.error(`[patch-lan-session] client bundle not found: ${clientPath}`)
  process.exit(1)
}

const source = readFileSync(clientPath, 'utf8').replace(/\r\n/g, '\n')
if (source.includes(MARKER)) {
  console.log('[patch-lan-session] already patched, skip')
  process.exit(0)
}
if (!source.includes(ORIGINAL)) {
  console.error('[patch-lan-session] ERROR: expected SessionManager construction not found (package updated?):', clientPath)
  process.exit(1)
}
writeFileSync(clientPath, source.replace(ORIGINAL, PATCHED))
console.log('[patch-lan-session] patched:', clientPath)
