// The built-in deepseek-official provider posts to https://api.deepseek.com/anthropic
// (Anthropic Messages protocol). Test that exact endpoint with the stored key —
// this is the request path DSH actually uses, unlike the OpenAI-compatible one.
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
console.log(`using DEEPSEEK_API_KEY (${KEY.length} chars, not printed)\n`)

const body = JSON.stringify({
  model: 'deepseek-flash',
  max_tokens: 16,
  messages: [{ role: 'user', content: 'say ok' }],
})

const attempts = [
  ['POST /anthropic/v1/messages (x-api-key)', 'https://api.deepseek.com/anthropic/v1/messages', { 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }],
  ['POST /anthropic/v1/messages (bearer)', 'https://api.deepseek.com/anthropic/v1/messages', { authorization: `Bearer ${KEY}`, 'anthropic-version': '2023-06-01' }],
  ['GET  /anthropic/v1/models', 'https://api.deepseek.com/anthropic/v1/models', { 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }],
  ['POST /v1/responses (what dpsk uses)', 'https://api.deepseek.com/v1/responses', { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }],
  ['POST /chat/completions (control)', 'https://api.deepseek.com/chat/completions', { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }],
]

for (const [label, url, headers] of attempts) {
  const isGet = label.startsWith('GET')
  try {
    const res = await fetch(url, {
      method: isGet ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      ...(isGet ? {} : { body }),
    })
    const text = await res.text()
    console.log(`${label}`)
    console.log(`   -> HTTP ${res.status}`)
    console.log(`   ${text.slice(0, 260).replace(/\s+/g, ' ')}`)
  } catch (error) {
    console.log(`${label}`)
    console.log(`   -> threw: ${error.message}`)
  }
  console.log('')
}
