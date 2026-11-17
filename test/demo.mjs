// Visible demo driven through the plugin's own registered tools.
//
// 需要 DSH 安装目录（内含 node_modules/@deepseek-ai/dsh-tools）。默认从环境变量
// DSH_ROOT 读取，未设置时用下面这个占位路径 —— 请改成你自己的 DSH 运行时目录。
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DSH_ROOT = process.env.DSH_ROOT ?? 'C:/path/to/dsh/runtime'
await import(pathToFileURL(join(DSH_ROOT, 'node_modules/@deepseek-ai/dsh-tools/lib/index.js')).href)
const plugin = await import(pathToFileURL(join(HERE, '..', 'lib', 'index.js')).href)

const byName = new Map()
const scoped = {
  tools: { register(def) { byName.set(def.name, def); return () => {} } },
  systemPrompt: { section() { return () => {} } },
  webServer: { register() { return () => {} } },
}
plugin.apply({ inject: (_s, cb) => cb(scoped), get: () => undefined, on: () => {} }, { escPause: false, autoScreenshot: false })

const computer = byName.get('computer')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await computer.execute({ type: 'glow', glowAction: 'show', text: 'DSH 电脑控制插件 · 已就绪' })
console.log('glow on')
await sleep(1200)

const box = [[700, 350], [1050, 350], [1050, 620], [700, 620], [700, 350]]
for (const [x, y] of box) {
  await computer.execute({ type: 'mouse_move', x, y })
  console.log(`moved to (${x}, ${y})`)
  await sleep(350)
}

const pos = await computer.execute({ type: 'cursor_position' })
console.log('cursor:', pos.text)
await sleep(2500)
await computer.execute({ type: 'glow', glowAction: 'hide' })
console.log('glow off — demo done')
