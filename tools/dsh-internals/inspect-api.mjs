// NOTE: 下面这个 DSH 安装路径是示例，请改成你自己的。
// Verify the plugin's API usage against the DSH build the desktop app runs (0.2.0-rc.2).
import { open } from 'node:fs/promises'

const ASAR = 'D:/DeepSeek Harness/resources/app.asar'
const fh = await open(ASAR, 'r')
const sizeBuf = Buffer.alloc(8)
await fh.read(sizeBuf, 0, 8, 0)
const headerSize = sizeBuf.readUInt32LE(4)
const headerBuf = Buffer.alloc(headerSize)
await fh.read(headerBuf, 0, headerSize, 8)
const strLen = headerBuf.readUInt32LE(4)
const header = JSON.parse(headerBuf.subarray(8, 8 + strLen).toString('utf8'))
const DATA_OFFSET = 8 + headerSize

const files = new Map()
function walk(node, prefix) {
  if (node.files === undefined) { files.set(prefix, node); return }
  for (const [name, child] of Object.entries(node.files)) walk(child, prefix === '' ? name : `${prefix}/${name}`)
}
walk(header, '')

async function read(path) {
  const node = files.get(path)
  if (node === undefined) return undefined
  const buf = Buffer.alloc(node.size)
  await fh.read(buf, 0, node.size, DATA_OFFSET + Number(node.offset))
  return buf.toString('utf8')
}

const P = 'dsh/node_modules/@deepseek-ai/'
const checks = []

async function check(label, path, needle, expectPresent = true) {
  const src = await read(path)
  if (src === undefined) { checks.push([label, 'FILE MISSING', false]); return }
  const found = src.includes(needle)
  checks.push([`${label} — "${needle}"`, found ? 'found' : 'NOT FOUND', found === expectPresent])
}

// host side
await check('webserver custom route', `${P}dsh-host-webserver/lib/index.js`, 'kind')
await check('webserver custom route', `${P}dsh-host-webserver/lib/index.js`, 'handler')
await check('system prompt section', `${P}dsh-system-prompt/lib/index.js`, 'section')
await check('tools register', `${P}dsh-tools/lib/index.js`, 'must declare output')

// client side (what the sidebar UI relies on)
await check('sidebar-right service', `${P}dsh-client-ui-sidebar-right/lib/client.js`, 'sidebarRightTabs')
await check('slot: right pane tab', `${P}dsh-client-ui-sidebar-right/lib/client.js`, 'sidebar.right.pane.tab')
await check('slot: right pane title', `${P}dsh-client-ui-sidebar-right/lib/client.js`, 'sidebar.right.pane.tab.title')
await check('client module loader', `${P}dsh-client-modules/lib/client.js`, '__ModuleLoader__')

for (const [label, result, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'BAD '} ${label}: ${result}`)
}

const bad = checks.filter(([, , ok]) => !ok).length
console.log(bad === 0 ? '\nALL API USAGE MATCHES the 0.2.0-rc.2 build' : `\n${bad} MISMATCHES — the plugin would fail on this build`)

await fh.close()
