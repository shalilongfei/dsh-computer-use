// Confirm the file_id image path only works with the right anthropic-beta header,
// and that inline base64 needs no such header. If so, the built-in provider's
// Files-API image path is what fails once a screenshot is in the conversation.
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

const list = await (await fetch('https://api.deepseek.com/files', { headers: { authorization: `Bearer ${KEY}` } })).json()
const fileId = list.data?.[0]?.id
console.log(`using existing file id: ${fileId}\n`)

async function call(label, content, extraHeaders = {}) {
  try {
    const res = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01', ...extraHeaders },
      body: JSON.stringify({ model: 'deepseek-flash', max_tokens: 24, stream: true, messages: [{ role: 'user', content }] }),
    })
    const text = await res.text()
    const ok = res.ok
    console.log(`[${label}]`)
    console.log(`   HTTP ${res.status}  ${(ok ? `${text.split('\n').filter((l) => l.startsWith('event:')).length} SSE events` : text.slice(0, 220)).replace(/\s+/g, ' ')}`)
  } catch (error) {
    console.log(`[${label}] threw: ${error.message}`)
  }
}

const textPart = { type: 'text', text: 'what is this?' }

console.log('--- inline base64 (no beta header needed) ---')
await call('inline base64, no beta', [textPart, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }])

console.log('\n--- file_id reference, various beta headers ---')
for (const beta of [
  undefined,
  'files-api-2025-04-14',
  'files-api-2024-11-20',
  'anthropic-beta: files-api-2025-04-14',
  'files-api-2025-04-14,prompt-caching-2024-07-31',
]) {
  const label = beta === undefined ? 'no beta header' : `beta="${beta}"`
  await call(label, [textPart, { type: 'image', source: { type: 'file', file_id: fileId } }], beta === undefined ? {} : { 'anthropic-beta': beta })
}
