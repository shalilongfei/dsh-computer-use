// NOTE: 下面这个 DSH 安装路径是示例，请改成你自己的。
// Extract a file (or a window around a needle) from the app.asar.
import { open } from 'node:fs/promises'

const ASAR = 'D:/DeepSeek Harness/resources/app.asar'
const target = process.argv[2]
const needle = process.argv[3]
const before = Number(process.argv[4] ?? 1500)
const after = Number(process.argv[5] ?? 2500)

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

const node = files.get(target)
if (node === undefined) {
  console.log('NOT FOUND:', target)
  console.log('candidates:', [...files.keys()].filter((p) => p.includes(process.argv[2].split('/').pop())).slice(0, 20).join('\n  '))
  process.exit(1)
}

const buf = Buffer.alloc(node.size)
await fh.read(buf, 0, node.size, DATA_OFFSET + Number(node.offset))
const src = buf.toString('utf8')
console.log(`file: ${target} (${src.length} chars)`)

if (needle === undefined) {
  console.log(src)
} else {
  let idx = src.indexOf(needle)
  if (idx === -1) { console.log(`needle "${needle}" not found`); process.exit(1) }
  console.log(`--- around "${needle}" ---`)
  console.log(src.slice(Math.max(0, idx - before), idx + after))
}

await fh.close()
