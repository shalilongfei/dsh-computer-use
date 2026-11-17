// NOTE: 下面这个 DSH 安装路径是示例，请改成你自己的。
// Print every occurrence of both spellings in dsh-llm-deepseek with context, to
// see whether it correctly converts the internal "tool-addition" block type into
// the wire "tool_addition" form (and therefore does send the beta).
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

async function src(path) {
  const node = files.get(path)
  const buf = Buffer.alloc(node.size)
  await fh.read(buf, 0, node.size, DATA_OFFSET + Number(node.offset))
  return buf.toString('utf8')
}

for (const path of [
  'dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js',
]) {
  const text = await src(path)
  const short = path.split('/').slice(-2)[0]
  for (const needle of ['"tool-addition"', '"tool-removal"', '"tool_addition"', '"tool_removal"']) {
    let from = 0
    let n = 0
    for (;;) {
      const i = text.indexOf(needle, from)
      if (i === -1) break
      n++
      console.log(`\n[${short}] ${needle} occurrence ${n} @${i}`)
      console.log('  ' + text.slice(Math.max(0, i - 300), i + 220).replace(/\s+/g, ' '))
      from = i + needle.length
    }
    if (n === 0) console.log(`\n[${short}] ${needle}: none`)
  }
}

await fh.close()
