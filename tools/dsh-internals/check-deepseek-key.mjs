// Validate the stored DeepSeek API key against the real API.
// Prints ONLY the HTTP status and a short error body — never the key.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

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

const targets = [
  ['DEEPSEEK_API_KEY', 'https://api.deepseek.com/models'],
  ['DPSK_API_KEY', 'https://api.deepseek.com/models'],
]

for (const [name, url] of targets) {
  const key = refs[name]
  if (key === undefined) { console.log(`${name}: not present in refs`); continue }
  const shape = `${key.slice(0, 3)}…(${key.length} chars)`
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${key}` } })
    const body = await res.text()
    console.log(`${name} ${shape}`)
    console.log(`   GET /models -> HTTP ${res.status}`)
    if (res.ok) {
      const j = JSON.parse(body)
      const ids = (j.data ?? []).map((d) => d.id)
      console.log(`   models available: ${ids.join(', ')}`)
    } else {
      console.log(`   body: ${body.slice(0, 200)}`)
    }
  } catch (error) {
    console.log(`${name} ${shape}`)
    console.log(`   request threw: ${error.message}`)
  }
  console.log('')
}
