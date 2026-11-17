// NOTE: 下面这个 DSH 安装路径是示例，请改成你自己的。
// Search text inside the app.asar across package lib/ files.
import { open } from 'node:fs/promises'

const ASAR = 'D:/DeepSeek Harness/resources/app.asar'
const needle = process.argv[2] ?? 'install_bundle'
const nameFilter = process.argv[3] // optional substring filter on the package name

const fh = await open(ASAR, 'r')
const sizeBuf = Buffer.alloc(8)
await fh.read(sizeBuf, 0, 8, 0)
const headerSize = sizeBuf.readUInt32LE(4)
const headerBuf = Buffer.alloc(headerSize)
await fh.read(headerBuf, 0, headerSize, 8)
const strLen = headerBuf.readUInt32LE(4)
const header = JSON.parse(headerBuf.subarray(8, 8 + strLen).toString('utf8'))
const DATA_OFFSET = 8 + headerSize

const files = new Map()
function walk(node, prefix) {
  if (node.files === undefined) { files.set(prefix, node); return }
  for (const [name, child] of Object.entries(node.files)) walk(child, prefix === '' ? name : `${prefix}/${name}`)
}
walk(header, '')

async function read(path) {
  const node = files.get(path)
  const buf = Buffer.alloc(node.size)
  await fh.read(buf, 0, node.size, DATA_OFFSET + Number(node.offset))
  return buf.toString('utf8')
}

const prefix = 'dsh/node_modules/@deepseek-ai/'
const targets = [...files.keys()].filter((p) => {
  if (!p.startsWith(prefix)) return false
  const rest = p.slice(prefix.length)
  const pkg = rest.split('/')[0]
  if (!rest.includes('/lib/') || !p.endsWith('.js')) return false
  if (nameFilter !== undefined && !pkg.includes(nameFilter)) return false
  const node = files.get(p)
  return node.size < 6_000_000
})

console.log(`scanning ${targets.length} files for "${needle}"${nameFilter ? ` (packages matching "${nameFilter}")` : ''}\n`)

let hits = 0
for (const path of targets) {
  let src
  try { src = await read(path) } catch { continue }
  const idx = src.indexOf(needle)
  if (idx === -1) continue
  hits++
  const pkg = path.slice(prefix.length).split('/')[0]
  console.log(`HIT ${pkg}  (${path.split('/').pop()})`)
  const snippet = src.slice(Math.max(0, idx - 160), idx + 200).replace(/\s+/g, ' ')
  console.log(`    ...${snippet}...\n`)
  if (hits >= 12) { console.log('(stopping after 12 hits)'); break }
}
if (hits === 0) console.log('no hits')

await fh.close()
