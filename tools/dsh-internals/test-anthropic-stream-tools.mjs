// The untested combination: the /anthropic endpoint DSH's built-in deepseek
// provider actually uses, called the way DSH calls it — streaming, with tools
// and a system prompt. Compare against the pi-ai (dpsk) protocol.
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

const TOOLS = [{
  name: 'get_time',
  description: 'Return the current time.',
  input_schema: { type: 'object', properties: { tz: { type: 'string' } }, required: [] },
}]

async function anthropic(label, { stream, tools, system }) {
  const body = {
    model: 'deepseek-flash',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'say ok' }],
    ...(stream ? { stream: true } : {}),
    ...(tools ? { tools: TOOLS } : {}),
    ...(system ? { system } : {}),
  }
  try {
    const res = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    })
    let detail = ''
    if (res.ok) {
      if (stream) {
        const text = await res.text()
        detail = `${text.split('\n').filter((l) => l.startsWith('event:')).length} SSE events, ${text.length} bytes`
      } else {
        detail = (await res.text()).slice(0, 120)
      }
    } else {
      detail = (await res.text()).slice(0, 300)
    }
    console.log(`  HTTP ${res.status}  ${detail.replace(/\s+/g, ' ')}`)
  } catch (error) {
    console.log(`  threw: ${error.message}`)
  }
}

console.log('=== POST /anthropic/v1/messages (what deepseek-official uses) ===')
for (const [label, opts] of [
  ['plain                ', {}],
  ['stream: true         ', { stream: true }],
  ['tools                ', { tools: true }],
  ['stream + tools       ', { stream: true, tools: true }],
  ['stream + tools + sys ', { stream: true, tools: true, system: 'You are a helpful assistant.' }],
]) {
  console.log(`\n[${label.trim()}]`)
  await anthropic(label, opts)
}

console.log('\n=== POST /v1/responses (what dpsk uses) — for contrast ===')
try {
  const res = await fetch('https://api.deepseek.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: 'deepseek-flash', input: 'say ok', max_output_tokens: 32 }),
  })
  const text = await res.text()
  console.log(`  HTTP ${res.status}  ${text.slice(0, 200).replace(/\s+/g, ' ')}`)
} catch (error) {
  console.log(`  threw: ${error.message}`)
}
