// Inspect the DeepSeek credential store WITHOUT printing secret values.
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

const f = join(DSH_HOME, 'llm-deepseek', 'files-v3.json')
const s = await stat(f).catch(() => undefined)
if (!s) { console.log('credential file missing:', f); process.exit(0) }
console.log(`file: ${f}`)
console.log(`size: ${s.size} bytes, mtime ${s.mtime.toISOString()}\n`)

const raw = await readFile(f, 'utf8')
let json
try { json = JSON.parse(raw) } catch { console.log('not JSON:', raw.slice(0, 200)); process.exit(0) }

const show = (value, depth = 0) => {
  const pad = '  '.repeat(depth)
  if (value === null) { console.log(`${pad}null`); return }
  if (Array.isArray(value)) {
    console.log(`${pad}array(${value.length})`)
    value.slice(0, 4).forEach((v) => show(v, depth + 1))
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string') {
        const looksSecret = /key|token|secret|credential/i.test(k)
        const shown = looksSecret
          ? `«${v.length} chars, starts "${v.slice(0, 3)}…", ${v.trim().length === 0 ? 'EMPTY!' : 'non-empty'}»`
          : JSON.stringify(v).slice(0, 80)
        console.log(`${pad}${k}: ${shown}`)
      } else {
        console.log(`${pad}${k}:`)
        show(v, depth + 1)
      }
    }
    return
  }
  console.log(`${pad}${String(value)}`)
}

show(json)
