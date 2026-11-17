// NOTE: 下面这个 DSH 安装路径是示例，请改成你自己的。
// Minimal ASAR reader: parse the archive header and extract selected files,
// so we can inspect the DSH build the desktop app actually runs.
import { open } from 'node:fs/promises'

const ASAR = 'D:/DeepSeek Harness/resources/app.asar'

const fh = await open(ASAR, 'r')

const sizeBuf = Buffer.alloc(8)
await fh.read(sizeBuf, 0, 8, 0)
const headerSize = sizeBuf.readUInt32LE(4)

const headerBuf = Buffer.alloc(headerSize)
await fh.read(headerBuf, 0, headerSize, 8)
const strLen = headerBuf.readUInt32LE(4)
const header = JSON.parse(headerBuf.subarray(8, 8 + strLen).toString('utf8'))

const DATA_OFFSET = 8 + headerSize

function walk(node, prefix, visit) {
  if (node.files === undefined) {
    visit(prefix, node)
    return
  }
  for (const [name, child] of Object.entries(node.files)) {
    walk(child, prefix === '' ? name : `${prefix}/${name}`, visit)
  }
}

const files = new Map()
walk(header, '', (path, node) => { files.set(path, node) })

console.log(`archive entries: ${files.size}`)

async function readEntry(path) {
  const node = files.get(path)
  if (node === undefined) return undefined
  const buf = Buffer.alloc(node.size)
  await fh.read(buf, 0, node.size, DATA_OFFSET + Number(node.offset))
  return buf.toString('utf8')
}

// 1. Which DSH build is this?
const dshPkg = await readEntry('dsh/node_modules/@deepseek-ai/dsh/package.json')
if (dshPkg !== undefined) {
  const parsed = JSON.parse(dshPkg)
  console.log(`\n@deepseek-ai/dsh version: ${parsed.version}`)
}

// 2. Which @deepseek-ai packages are bundled?
const prefix = 'dsh/node_modules/@deepseek-ai/'
const pkgs = [...files.keys()]
  .filter((p) => p.startsWith(prefix) && p.slice(prefix.length).split('/').length === 2 && p.endsWith('/package.json'))
  .map((p) => p.slice(prefix.length, -'/package.json'.length))
  .sort()
console.log(`bundled @deepseek-ai packages: ${pkgs.length}`)

for (const probe of [
  'dsh-client-ui-sidebar-right',
  'dsh-client-ui-sidebar',
  'dsh-experimental-agent-team-profile',
  'dsh-tools',
  'dsh-attachment',
  'dsh-client-modules',
]) {
  console.log(`  ${probe}: ${pkgs.includes(probe) ? 'present' : 'MISSING'}`)
}

// 3. Does this build still require output{schema,render} on register()?
const toolsSrc = await readEntry('dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js')
if (toolsSrc !== undefined) {
  const idx = toolsSrc.indexOf('must declare output')
  console.log(`\nregister() output requirement: ${idx === -1 ? 'NOT FOUND (API changed!)' : 'present'}`)
  if (idx !== -1) console.log(`  ...${toolsSrc.slice(idx - 120, idx + 60).replace(/\s+/g, ' ')}`)
}

await fh.close()
