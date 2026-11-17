// Find where each model provider is configured, so the working custom provider
// (dpsk) can be compared against the failing built-in one (deepseek-official).
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const DSH_DESKTOP_DIR = process.env.DSH_DESKTOP_DIR ?? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), '@deepseek-ai', 'dsh-desktop')

const ROOTS = [
  DSH_HOME,
  DSH_DESKTOP_DIR,
]
const NEEDLES = ['dpsk', 'deepseek-official', 'longcat', 'llm-deepseek']
const SKIP = /node_modules|sessions|attachments|\.pnpm|computer-use-shots/

async function walk(dir, out, depth = 0) {
  if (depth > 6) return
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const p = join(dir, entry.name)
    if (SKIP.test(p)) continue
    if (entry.isDirectory()) { await walk(p, out, depth + 1); continue }
    // skip the plugin cache and huge logs
    if (/\.(jsonl\.zstd|png|jpg|dll|exe|pdb)$/i.test(entry.name)) continue
    const s = await stat(p).catch(() => undefined)
    if (!s || s.size > 2_000_000) continue
    out.push(p)
  }
}

const files = []
for (const root of ROOTS) await walk(root, files)
console.log(`scanning ${files.length} files under ${ROOTS.length} roots\n`)

let found = 0
for (const f of files) {
  const text = await readFile(f, 'utf8').catch(() => undefined)
  if (text === undefined) continue
  const hits = NEEDLES.filter((n) => text.toLowerCase().includes(n))
  if (hits.length === 0) continue
  found++
  console.log(`=== ${f}`)
  console.log(`    matched: ${hits.join(', ')}`)
  text.split(/\r?\n/).forEach((line, i) => {
    if (NEEDLES.some((n) => line.toLowerCase().includes(n))) {
      console.log(`    ${String(i + 1).padStart(4)}: ${line.trim().slice(0, 170)}`)
    }
  })
  console.log('')
  if (found >= 12) { console.log('(stopping after 12 files)'); break }
}
if (found === 0) console.log('no configuration mentions any of these providers')
