// NOTE: 下面这个 DSH 安装路径是示例，请改成你自己的。
// Prove the identifier mismatch: the producer emits "tool-addition" (hyphen) but
// the DeepSeek transport looks for "tool_addition" (underscore), so the required
// mid-conversation-tool-changes beta is never sent.
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
  if (!node) return undefined
  const buf = Buffer.alloc(node.size)
  await fh.read(buf, 0, node.size, DATA_OFFSET + Number(node.offset))
  return buf.toString('utf8')
}

const PRODUCER = 'dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js'
const CONSUMER = 'dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js'

const producer = await src(PRODUCER)
const consumer = await src(CONSUMER)

const count = (text, needle) => text.split(needle).length - 1

console.log('PRODUCER  dsh-agent-loop      (creates the blocks)')
console.log(`  "tool-addition" (hyphen)    : ${count(producer, '"tool-addition"')}`)
console.log(`  "tool_addition" (underscore): ${count(producer, '"tool_addition"')}`)

console.log('\nCONSUMER  dsh-llm-deepseek     (decides whether to send the beta)')
console.log(`  "tool-addition" (hyphen)    : ${count(consumer, '"tool-addition"')}`)
console.log(`  "tool_addition" (underscore): ${count(consumer, '"tool_addition"')}`)

const mismatch = count(producer, '"tool-addition"') > 0
  && count(consumer, '"tool-addition"') === 0
  && count(consumer, '"tool_addition"') > 0

console.log(`\n${mismatch
  ? 'CONFIRMED MISMATCH: the transport can never see the block type the agent loop produces,\nso MESSAGES_TOOL_CHANGES_BETA is never attached, and the API rejects the request.'
  : 'no mismatch detected'}`)

// show the deciding expression verbatim
const i = consumer.indexOf('tool_addition')
if (i !== -1) {
  console.log('\nthe deciding expression:')
  console.log('  ' + consumer.slice(Math.max(0, i - 260), i + 120).replace(/\s+/g, ' '))
}

await fh.close()
