// NOTE: 下面这个 DSH 安装路径是示例，请改成你自己的。
// Is MESSAGES_TOOL_CHANGES_BETA ever actually applied to a request, or only
// defined? If it is never sent, every mid-conversation tool addition (which is
// exactly what a plugin loaded into a live session produces) fails.
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

const targets = [...files.keys()].filter(
  (p) => p.includes('@deepseek-ai/dsh-llm-deepseek/') && p.endsWith('.js'),
)

for (const needle of ['MESSAGES_TOOL_CHANGES_BETA', 'MESSAGES_FILES_BETA', 'headers.set("anthropic-beta"', 'anthropic-beta']) {
  console.log(`\n########## "${needle}" ##########`)
  let total = 0
  for (const path of targets) {
    const node = files.get(path)
    const buf = Buffer.alloc(node.size)
    await fh.read(buf, 0, node.size, DATA_OFFSET + Number(node.offset))
    const src = buf.toString('utf8')
    let from = 0
    for (;;) {
      const i = src.indexOf(needle, from)
      if (i === -1) break
      total++
      if (total <= 6) {
        const short = path.replace('dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/', '')
        console.log(`  ${short} @${i}`)
        console.log(`     ...${src.slice(Math.max(0, i - 150), i + 170).replace(/\s+/g, ' ')}...`)
      }
      from = i + needle.length
    }
  }
  console.log(`  total occurrences: ${total}`)
}

await fh.close()
