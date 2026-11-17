// THE decisive test: a real mid-conversation tool-addition request, exactly what
// a plugin loaded into a running session produces. If the API rejects this while
// ordinary tool calls succeed, then adding tools mid-session is the trigger.
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
const TOOL_BETA = 'mid-conversation-tool-changes-2026-07-01'

const TOOL = {
  name: 'computer',
  description: 'Operate the desktop.',
  input_schema: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] },
}

// the wire form DSH builds for a tool added mid-conversation
const TOOL_ADDITION_BLOCK = { type: 'tool_addition', tool: { type: 'tool_reference', name: 'computer' } }

async function call(label, { messages, tools, beta }) {
  try {
    const res = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
        ...(beta === undefined ? {} : { 'anthropic-beta': beta }),
      },
      body: JSON.stringify({
        model: 'deepseek-flash',
        max_tokens: 32,
        stream: true,
        ...(tools === undefined ? {} : { tools }),
        messages,
      }),
    })
    const text = await res.text()
    console.log(`[${label}]`)
    console.log(`   HTTP ${res.status}  ${(res.ok
      ? `${text.split('\n').filter((l) => l.startsWith('event:')).length} SSE events`
      : text.slice(0, 300)).replace(/\s+/g, ' ')}`)
  } catch (error) {
    console.log(`[${label}] threw: ${error.message}`)
  }
}

const plain = [{ role: 'user', content: 'say ok' }]
const withAddition = [
  { role: 'system', content: [TOOL_ADDITION_BLOCK] },
  { role: 'user', content: 'say ok' },
]

console.log('--- baseline: normal tool call, no tool-change block ---')
await call('tools, no addition, with beta   ', { messages: plain, tools: [TOOL], beta: TOOL_BETA })
await call('tools, no addition, no beta     ', { messages: plain, tools: [TOOL] })

console.log('\n--- mid-conversation tool addition (what a plugin triggers) ---')
await call('addition, WITH tool-changes beta', { messages: withAddition, tools: [TOOL], beta: TOOL_BETA })
await call('addition, NO beta              ', { messages: withAddition, tools: [TOOL] })
await call('addition, wrong beta           ', { messages: withAddition, tools: [TOOL], beta: 'files-api-2025-04-14' })
