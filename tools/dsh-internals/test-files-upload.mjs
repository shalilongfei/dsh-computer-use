// The one path never tested: the Files API UPLOAD. dsh-llm-deepseek uploads
// request images here (with quota handling); the dpsk/pi-ai provider does not
// use it at all. If uploads fail, every deepseek-official request that carries
// an image fails as a transport error.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

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
const auth = { authorization: `Bearer ${KEY}` }

// --- what does the account currently hold? ---
console.log('=== GET /files ===')
const list = await fetch('https://api.deepseek.com/files', { headers: auth })
console.log(`HTTP ${list.status}`)
const listBody = await list.text()
console.log(listBody.slice(0, 700))

// --- the upload path ---
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

console.log('\n=== POST /files (multipart upload) ===')
for (const url of ['https://api.deepseek.com/files', 'https://api.deepseek.com/v1/files']) {
  try {
    const form = new FormData()
    form.append('purpose', 'user_data')
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'dsh-probe.png')
    const res = await fetch(url, { method: 'POST', headers: auth, body: form })
    const text = await res.text()
    console.log(`${url}: HTTP ${res.status}`)
    console.log(`   ${text.slice(0, 400).replace(/\s+/g, ' ')}`)
  } catch (error) {
    console.log(`${url}: threw ${error.message}`)
  }
}
