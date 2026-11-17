// NOTE: 下面这个 DSH 安装路径是示例，请改成你自己的。
// Print whether the given asar-internal paths exist.
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

const files = new Map()
function walk(node, prefix) {
  if (node.files === undefined) { files.set(prefix, node); return }
  for (const [name, child] of Object.entries(node.files)) walk(child, prefix === '' ? name : `${prefix}/${name}`)
}
walk(header, '')

for (const p of process.argv.slice(2)) {
  console.log(`${files.has(p) ? 'EXISTS' : 'MISSING'}  ${p}`)
}

// also show what the dsh package actually exposes at top level
const listing = [...files.keys()].filter((p) => p.startsWith('dsh/node_modules/@deepseek-ai/dsh/')).slice(0, 40)
console.log('\n@deepseek-ai/dsh contents (first 40):')
for (const p of listing) console.log('  ' + p.replace('dsh/node_modules/@deepseek-ai/dsh/', ''))

await fh.close()
