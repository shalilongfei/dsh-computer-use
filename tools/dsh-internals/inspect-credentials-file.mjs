// Compare the credential store against its backup, masking every secret.
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

const files = [
  ['current', join(DSH_HOME, '.credentials.yaml')],
  ['backup ', join(DSH_HOME, '.credentials.yaml.bak-20261009202937')],
]

const mask = (line) => {
  const m = /^(\s*)([\w.-]+)\s*:\s*(.*)$/.exec(line)
  if (!m) return line
  const [, indent, key, value] = m
  if (value.trim().length === 0) return `${indent}${key}:`
  if (/key|token|secret|credential|password/i.test(key)) {
    const v = value.replace(/^["']|["']$/g, '')
    const tail = v.length > 4 ? v.slice(-4) : ''
    return `${indent}${key}: «${v.length} chars${tail ? ` …${tail}` : ''}»`
  }
  return `${indent}${key}: ${value}`
}

for (const [label, path] of files) {
  const s = await stat(path).catch(() => undefined)
  console.log(`===== ${label} ${path}`)
  if (!s) { console.log('  (missing)\n'); continue }
  console.log(`  size=${s.size} mtime=${s.mtime.toISOString()}`)
  const text = await readFile(path, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const hasSecret = /key|token|secret|credential|password/i.test(line)
    console.log(`  ${hasSecret ? mask(line) : line}`)
  }
  console.log('')
}
