// Remove the two probe files this investigation uploaded to the real account.
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
const auth = { authorization: `Bearer ${refs.DEEPSEEK_API_KEY}` }

const list = await fetch('https://api.deepseek.com/files', { headers: auth })
const { data } = await list.json()
console.log(`files before: ${data.length}`)
for (const f of data) console.log(`  ${f.id}  ${f.filename}  ${f.bytes}B`)

for (const f of data) {
  if (f.filename !== 'dsh-probe.png') continue
  const res = await fetch(`https://api.deepseek.com/files/${f.id}`, { method: 'DELETE', headers: auth })
  console.log(`delete ${f.id} -> HTTP ${res.status}`)
}

const after = await (await fetch('https://api.deepseek.com/files', { headers: auth })).json()
console.log(`\nfiles after: ${after.data.length}`)
for (const f of after.data) console.log(`  ${f.id}  ${f.filename}  ${f.bytes}B`)
