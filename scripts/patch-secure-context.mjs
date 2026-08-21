// 修复局域网 http origin（非安全上下文）下 crypto.randomUUID 缺失导致的
// "加载提供方目录失败 / 无法加载 Agent 预设" 等报错。
//
// 背景：crypto.randomUUID 是 secure-context-only 的 Web API——https 与
// localhost 可用，但 http://<局域网IP> 下为 undefined。DSH Web 客户端的
// RPC/message id 生成与设置页（模型目录、Agent 预设）都用它，LAN 地址
// 打开时这些路径直接抛错。crypto.getRandomValues 在所有上下文可用，
// 因此宿主把 polyfill（UUID v4）作为 index 注入表的第一条 head 脚本，
// 在任何 origin 的页面头部最先执行，且不修改任何浏览器 bundle。
//
// 注入点（DSH 0.1.1-rc.1 起改为结构化注入表）：dsh-client-modules（host 侧）
// bootInjections() 的返回数组——在其首个 {kind:"script", placement:"head"}
// 行之前插入 polyfill 行；dsh-host-webserver 的 renderIndexInjections 会把它
// 渲染为紧随 <head> 的 <script>，与旧版 injectBootManifest 注入语义一致。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'node_modules', '@deepseek-ai', 'dsh-client-modules', 'lib', 'index.js')
const MARKER = 'dsh-desktop patch: insecure-context crypto.randomUUID'

// bootInjections() 返回数组的头部：首个 {kind:"script", placement:"head"} 行
const ORIGINAL = '\treturn [\n\t\t{\n\t\t\tkind: "script",\n\t\t\tplacement: "head",\n\t\t\ttext: queue\n\t\t},'

// polyfill 源码（不含反引号 / ${ / </script> 序列）。注意：作为注入行对象的
// text 属性值，它必须是「字符串」，不能是立即执行表达式——否则 IIFE 会在 host
// 进程（node）里先执行掉，text 变成 undefined，浏览器端拿不到 polyfill。
const POLYFILL_SRC = '/* ' + MARKER + ' */ (function(){if(typeof crypto==="undefined"||typeof crypto.getRandomValues!=="function")return;if(typeof crypto.randomUUID==="function")return;function uuid(){var b=new Uint8Array(16);crypto.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var h="";for(var i=0;i<16;i++){var s=b[i].toString(16);h+=s.length<2?"0"+s:s}return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20)}try{crypto.randomUUID=uuid}catch(e){try{Object.defineProperty(crypto,"randomUUID",{value:uuid,configurable:true,writable:true})}catch(e2){}}})();'

const PATCHED = '\treturn [\n\t\t{\n\t\t\tkind: "script",\n\t\t\tplacement: "head",\n\t\t\ttext: ' + JSON.stringify(POLYFILL_SRC) + '\n\t\t},\n\t\t{\n\t\t\tkind: "script",\n\t\t\tplacement: "head",\n\t\t\ttext: queue\n\t\t},'

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
  console.error('[patch-secure-context] ERROR: expected bootInjections head not found (package updated?):', target)
  process.exit(1)
}
writeFileSync(target, source.replace(ORIGINAL, PATCHED))
console.log('[patch-secure-context] patched:', target)
