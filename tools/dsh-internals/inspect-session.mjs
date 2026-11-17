// Decompress the newest session log and look for image content blocks, which a
// text-only model route cannot accept.
import { readdir, stat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const ROOT = join(DSH_HOME, 'sessions')
// 下面这个是 DSH 会话目录的编码名（工作区路径 slug 化后的结果），请按你的工作区按需覆盖。
const WORKSPACE_DIR = process.env.DSH_SESSION_SLUG ?? '--<your-workspace-slug>--'

async function newestSession(dir) {
  let best
  for (const name of await readdir(dir).catch(() => [])) {
    const full = join(dir, name)
    const s = await stat(full).catch(() => undefined)
    if (!s) continue
    if (s.isDirectory()) {
      const inner = await newestSession(full)
      if (inner && (!best || inner.mtime > best.mtime)) best = { ...inner, mtime: inner.mtime }
      for (const f of await readdir(full).catch(() => [])) {
        if (!f.startsWith('session.v4.jsonl')) continue
        const p = join(full, f)
        const st = await stat(p).catch(() => undefined)
        if (st && (!best || st.mtimeMs > best.mtime)) best = { path: p, mtime: st.mtimeMs, size: st.size }
      }
    }
  }
  return best
}

const target = await newestSession(join(ROOT, WORKSPACE_DIR))
if (!target) { console.log('no session found'); process.exit(0) }
console.log(`session: ${target.path}`)
console.log(`size   : ${target.size} bytes, mtime ${new Date(target.mtime).toISOString()}\n`)

const raw = await readFile(target.path)
let text
if (target.path.endsWith('.zstd')) {
  try {
    text = zlib.zstdDecompressSync(raw).toString('utf8')
  } catch (error) {
    console.log('zstd decompress failed:', error.message)
    console.log('has zstd support:', typeof zlib.zstdDecompressSync)
    process.exit(0)
  }
} else {
  text = raw.toString('utf8')
}

const lines = text.split('\n').filter((l) => l.trim().length > 0)
console.log(`log lines: ${lines.length}`)

let imageBlocks = 0
let attachmentRefs = new Set()
const sample = []
for (const line of lines) {
  if (line.includes('"type":"image"') || line.includes('"image"')) {
    imageBlocks++
    for (const m of line.matchAll(/([0-9a-f]{64})/g)) attachmentRefs.add(m[1])
    if (sample.length < 3) sample.push(line.slice(0, 300))
  }
}

console.log(`lines mentioning an image block: ${imageBlocks}`)
console.log(`distinct 64-hex ids referenced : ${attachmentRefs.size}`)
if (attachmentRefs.size > 0) {
  console.log('sample ids:')
  for (const id of [...attachmentRefs].slice(0, 6)) console.log('  ' + id)
}
if (sample.length > 0) {
  console.log('\nsample line:')
  console.log('  ' + sample[0])
}
