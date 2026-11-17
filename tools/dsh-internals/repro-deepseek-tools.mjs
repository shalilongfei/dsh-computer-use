// REPRODUCTION: send the plugin's real tool definitions to the real DeepSeek API
// and compare against a control request with no tools.
//
// If the tools request fails while the control succeeds, the plugin's schema is
// what breaks the DeepSeek route ("DeepSeek Messages transport failed").
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

// --- the API key (never printed) ---
const cred = await readFile(join(DSH_HOME, '.credentials.yaml'), 'utf8')
const refs = {}
let inRefs = false
for (const line of cred.split(/\r?\n/)) {
  if (/^refs:\s*$/.test(line)) { inRefs = true; continue }
  if (inRefs) {
    const m = /^\s+([A-Z0-9_]+):\s*(.+?)\s*$/.exec(line)
    if (m) refs[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const KEY = refs.DEEPSEEK_API_KEY

// --- collect the plugin's real tool definitions ---
const registered = []
const scoped = {
  tools: { register(def) { registered.push(def); return () => {} } },
  systemPrompt: { section() { return () => {} } },
  webServer: { register() { return () => {} } },
}
const plugin = await import(`file:///${ROOT}/lib/index.js`)
plugin.apply({ inject: (_s, cb) => cb(scoped), get: () => undefined, on: () => {} }, { escPause: false })

console.log(`collected ${registered.length} tools: ${registered.map((t) => t.name).join(', ')}\n`)

const tools = registered.map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.parameters },
}))

async function probe(label, body) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  console.log(`--- ${label}: HTTP ${res.status}`)
  if (!res.ok) {
    console.log(`    body: ${text.slice(0, 600)}`)
  } else {
    const j = JSON.parse(text)
    const msg = j.choices?.[0]?.message
    console.log(`    ok; model=${j.model}, content=${JSON.stringify(msg?.content ?? '').slice(0, 60)}, tool_calls=${msg?.tool_calls?.length ?? 0}`)
  }
  return res.status
}

// control: no tools at all
const control = await probe('CONTROL (no tools)', {
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: 'say ok' }],
  max_tokens: 8,
})

// the real thing: the plugin's tool definitions
const withTools = await probe('WITH PLUGIN TOOLS', {
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: 'say ok' }],
  max_tokens: 8,
  tools,
  tool_choice: 'auto',
})

// bisect: one tool at a time, to name the offender if the combined set fails
if (withTools !== 200) {
  console.log('\nBisecting tool by tool:')
  for (const tool of tools) {
    await probe(`  only "${tool.function.name}"`, {
      model: 'deepseek-flash',
      messages: [{ role: 'user', content: 'say ok' }],
      max_tokens: 8,
      tools: [tool],
      tool_choice: 'auto',
    })
  }
}

console.log(`\ncontrol=${control}  withTools=${withTools}`)
console.log(control === 200 && withTools !== 200
  ? 'CONCLUSION: the plugin tool schema breaks the DeepSeek route'
  : 'CONCLUSION: the plugin tool schema is accepted by the DeepSeek route')
