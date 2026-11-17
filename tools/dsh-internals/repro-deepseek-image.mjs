// Does the real DeepSeek API accept an IMAGE content block for deepseek-flash?
// The 0.2.0 catalog declares inputModalities ["text","image"], so DSH will send
// screenshots rather than substituting a placeholder.
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
const KEY = refs.DEEPSEEK_API_KEY

// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function post(label, body) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  console.log(`--- ${label}: HTTP ${res.status}`)
  console.log(`    ${text.slice(0, 500)}`)
  return res.status
}

for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
  console.log(`\n########## model = ${model} ##########`)

  const base = (content) => ({
    model,
    messages: [{ role: 'user', content }],
    max_tokens: 16,
  })

  await post('text only', base('say ok'))

  await post('with image (openai image_url form)', base([
    { type: 'text', text: 'what is in this image?' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
  ]))
}

console.log('\n如果 text 是 200 而 with image 是 4xx，就证明：')
console.log('DSH 认为 deepseek-flash 支持图片，于是把截图发出去了，而真实 API 拒收 → TRANSPORT 错误')
