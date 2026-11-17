// NOTE: 下面这个 DSH 安装路径是示例，请改成你自己的。
// Does the DeepSeek provider's Files API path actually work with this key?
// DSH uploads request images through the Files API; the small inline-base64 test
// took a different path, so this is the one route left that the plugin newly
// exercises (it injects screenshots).
import { readFile } from 'node:fs/promises'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const ASAR = 'D:/DeepSeek Harness/resources/app.asar'

// ---------- 1. find the Files API endpoint used by dsh-llm-deepseek ----------
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

const pkgPath = 'dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js'
const node = files.get(pkgPath)
const buf = Buffer.alloc(node.size)
await fh.read(buf, 0, node.size, DATA_OFFSET + Number(node.offset))
const src = buf.toString('utf8')
await fh.close()

console.log('=== Files API references in dsh-llm-deepseek ===')
const urlMatches = [...src.matchAll(/["'`]([^"'`\s]*\/files[^"'`\s]*)["'`]/g)].map((m) => m[1])
console.log('endpoint-ish strings:', [...new Set(urlMatches)].slice(0, 10).join(', ') || '(none)')
for (const needle of ['files', 'file-api', 'uploadFile', 'filesApi']) {
  const i = src.indexOf(needle)
  if (i !== -1) {
    console.log(`  "${needle}" @${i}: ...${src.slice(Math.max(0, i - 90), i + 130).replace(/\s+/g, ' ')}...`)
    break
  }
}

// ---------- 2. read the key (never printed) ----------
const cred = await readFile(join(DSH_HOME, '.credentials.yaml'), 'utf8')
const refs = {}
let inRefs = false
for (const line of cred.split(/\r?\n/)) {
  if (/^refs:\s*$/.test(line)) { inRefs = true; continue }
  if (!inRefs) continue
  const m = /^\s+([A-Z0-9_]+):\s*(.+?)\s*$/.exec(line)
  if (m) refs[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const KEY = refs.DEEPSEEK_API_KEY

// ---------- 3. probe plausible Files API endpoints ----------
console.log('\n=== probing Files API endpoints ===')
for (const ep of [
  'https://api.deepseek.com/files',
  'https://api.deepseek.com/v1/files',
  'https://api.deepseek.com/files/list',
]) {
  try {
    const res = await fetch(ep, { headers: { authorization: `Bearer ${KEY}` } })
    const body = await res.text()
    console.log(`${ep}\n   HTTP ${res.status}  ${body.slice(0, 200)}`)
  } catch (error) {
    console.log(`${ep}\n   threw: ${error.message}`)
  }
}

// ---------- 4. does a streamed request with an image still work? ----------
console.log('\n=== streamed request WITH an image (what DSH actually does) ===')
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
try {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'deepseek-flash',
      stream: true,
      max_tokens: 16,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
        ],
      }],
    }),
  })
  console.log(`streamed+image -> HTTP ${res.status}`)
  if (!res.ok) {
    console.log('   body:', (await res.text()).slice(0, 300))
  } else {
    const reader = res.body.getReader()
    let chunks = 0
    let bytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks++
      bytes += value.length
      if (chunks > 200) break
    }
    console.log(`   streamed ok: ${chunks} chunks, ${bytes} bytes`)
  }
} catch (error) {
  console.log(`   threw: ${error.message}`)
}
