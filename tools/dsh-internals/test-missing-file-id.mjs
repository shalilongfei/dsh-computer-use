// Complete the picture: a session whose image was never uploaded to the Files API
// makes the Anthropic-protocol provider reference a file_id that does not exist.
// What does the API do then?
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
const BETA = 'files-api-2025-04-14'

// what the account actually holds right now
const list = await (await fetch('https://api.deepseek.com/files', { headers: { authorization: `Bearer ${KEY}` } })).json()
const realIds = new Set((list.data ?? []).map((f) => f.id))
console.log(`files on account: ${[...realIds].join(', ') || '(none)'}\n`)

const text = { type: 'text', text: 'what is this?' }

async function call(label, fileId) {
  try {
    const res = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': BETA },
      body: JSON.stringify({
        model: 'deepseek-flash',
        max_tokens: 24,
        stream: true,
        messages: [{ role: 'user', content: [text, { type: 'image', source: { type: 'file', file_id: fileId } }] }],
      }),
    })
    const body = await res.text()
    console.log(`[${label}]`)
    console.log(`   ${fileId}`)
    console.log(`   HTTP ${res.status}  ${(res.ok ? `${body.split('\n').filter((l) => l.startsWith('event:')).length} SSE events` : body.slice(0, 260)).replace(/\s+/g, ' ')}`)
  } catch (error) {
    console.log(`[${label}] threw: ${error.message}`)
  }
}

const real = [...realIds][0]
if (real !== undefined) await call('existing file_id (yours, uploaded OK)', real)

await call('image attached to an OLD session that has no file record', 'file-api-00000000-0000-0000-0000-000000000000')

await call('malformed file_id', 'not-a-real-file-id')
