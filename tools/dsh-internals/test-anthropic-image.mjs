// The final untested combination: the /anthropic endpoint WITH AN IMAGE, which is
// the one thing the plugin newly puts into the conversation. If this fails while
// every text-only call succeeds, the plugin's screenshots are the trigger.
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
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// the file id already on the account (the user's own screenshot)
const listRes = await fetch('https://api.deepseek.com/files', { headers: { authorization: `Bearer ${KEY}` } })
const list = await listRes.json()
const existingId = list.data?.[0]?.id
console.log(`existing file on account: ${existingId ?? '(none)'}\n`)

async function call(label, content) {
  const body = {
    model: 'deepseek-flash',
    max_tokens: 32,
    stream: true,
    messages: [{ role: 'user', content }],
  }
  try {
    const res = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    console.log(`[${label}] HTTP ${res.status}`)
    console.log(`   ${(res.ok ? `${text.split('\n').filter((l) => l.startsWith('event:')).length} SSE events` : text.slice(0, 300)).replace(/\s+/g, ' ')}`)
  } catch (error) {
    console.log(`[${label}] threw: ${error.message}`)
  }
}

await call('text only', [{ type: 'text', text: 'what is this?' }])

await call('text + inline base64 image', [
  { type: 'text', text: 'what is this?' },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
])

if (existingId !== undefined) {
  await call('text + file_id reference', [
    { type: 'text', text: 'what is this?' },
    { type: 'image', source: { type: 'file', file_id: existingId } },
  ])
}
