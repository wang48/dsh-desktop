// 修复局域网 http origin（非安全上下文）下 crypto.randomUUID 缺失导致的
// "加载提供方目录失败 / 无法加载 Agent 预设" 等报错。
//
// 背景：crypto.randomUUID 是 secure-context-only 的 Web API——https 与
// localhost 可用，但 http://<局域网IP> 下为 undefined。DSH Web 客户端的
// RPC/message id 生成与设置页（模型目录、Agent 预设）都用它，LAN 地址
// 打开时这些路径直接抛错。crypto.getRandomValues 在所有上下文可用，
// 因此宿主在注入 __DSH_BOOT__ 的首个 <head> 脚本之后紧跟一个同源
// polyfill（UUID v4），对任何 origin 生效，且不修改任何浏览器 bundle。
//
// 注入点：dsh-client-modules（host 侧）的 injectBootManifest 返回语句。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'node_modules', '@deepseek-ai', 'dsh-client-modules', 'lib', 'index.js')
const MARKER = 'dsh-desktop patch: insecure-context crypto.randomUUID'

const ORIGINAL = '\tif (head !== -1) return `${html.slice(0, head + 6)}${script}${html.slice(head + 6)}`;'

// polyfill 脚本不含反引号 / ${ 序列，避免干扰宿主模板字面量
const POLYFILL = '<script>/* ' + MARKER + ' */(function(){if(typeof crypto==="undefined"||typeof crypto.getRandomValues!=="function")return;if(typeof crypto.randomUUID==="function")return;function uuid(){var b=new Uint8Array(16);crypto.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var h="";for(var i=0;i<16;i++){var s=b[i].toString(16);h+=s.length<2?"0"+s:s}return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20)}try{crypto.randomUUID=uuid}catch(e){try{Object.defineProperty(crypto,"randomUUID",{value:uuid,configurable:true,writable:true})}catch(e2){}}})();<\\/script>'

const PATCHED = '\tif (head !== -1) return `${html.slice(0, head + 6)}${script}' + POLYFILL + '${html.slice(head + 6)}`;'

if (!existsSync(target)) {
  console.error(`[patch-secure-context] target not found: ${target}`)
  process.exit(1)
}

const source = readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
if (source.includes(MARKER)) {
  console.log('[patch-secure-context] already patched, skip')
  process.exit(0)
}
if (!source.includes(ORIGINAL)) {
  console.error('[patch-secure-context] ERROR: expected injectBootManifest return not found (package updated?):', target)
  process.exit(1)
}
writeFileSync(target, source.replace(ORIGINAL, PATCHED))
console.log('[patch-secure-context] patched:', target)
