// End-to-end: drive the registered tools through their real execute() path.
//
// 需要 DSH 运行时目录，自动探测；探测不到时看 test/_dsh-root.mjs 里的提示。
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { DSH_ROOT, PLUGIN_ROOT } from './_dsh-root.mjs'

const toolsUrl = pathToFileURL(join(DSH_ROOT, 'node_modules/@deepseek-ai/dsh-tools/lib/index.js')).href
const pluginUrl = pathToFileURL(join(PLUGIN_ROOT, 'lib', 'index.js')).href

await import(toolsUrl)
const plugin = await import(pluginUrl)

const byName = new Map()
const scoped = {
  tools: { register(def) { byName.set(def.name, def); return () => {} } },
  systemPrompt: { section() { return () => {} } },
  webServer: { register() { return () => {} } },
}
plugin.apply({ inject: (_s, cb) => cb(scoped), get: () => undefined, on: () => {} }, { escPause: false, autoScreenshot: false })

const show = (label, value) => console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)

try {
  const win = byName.get('windows')
  const listed = await win.execute({ action: 'list' })
  show('windows.list', String(listed.text).split('\n').slice(0, 3).join(' | '))

  const comp = byName.get('computer')
  const cursor = await comp.execute({ type: 'cursor_position' })
  show('computer.cursor_position', cursor.text)

  const clip = byName.get('clipboard')
  const read = await clip.execute({ operation: 'read' })
  show('clipboard.read', String(read.text).slice(0, 80))

  const ui = byName.get('ui_elements')
  const elements = await ui.execute({ maxElements: 5 })
  show('ui_elements', String(elements.text).split('\n').slice(0, 3).join(' | '))

  const shot = await comp.execute({ type: 'screenshot' })
  show('computer.screenshot', `path=${shot.path} ${shot.width}x${shot.height} screen=${shot.screenWidth}x${shot.screenHeight} image=${shot.image ? 'yes' : 'no'}`)

  const skill = byName.get('app_skill')
  show('app_skill.list', String((await skill.execute({ action: 'list' })).text).slice(0, 80))

  const glow = await comp.execute({ type: 'glow', glowAction: 'show', text: 'DSH 正在操控你的电脑' })
  show('computer.glow', glow.text)
  await new Promise((r) => setTimeout(r, 3000))
  const off = await comp.execute({ type: 'glow', glowAction: 'hide' })
  show('computer.glow.hide', off.text)

  console.log('---')
  console.log('OK: every tool executed through its real execute() path')
} catch (error) {
  console.log('FAIL:', error.message)
  process.exitCode = 1
}
