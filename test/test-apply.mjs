// Validates that the host plugin's apply() registers every tool with a
// definition the real DSH tool registry accepts.
//
// 需要 DSH 安装目录（内含 node_modules/@deepseek-ai/dsh-tools）。默认从环境变量
// DSH_ROOT 读取，未设置时用下面这个占位路径 —— 请改成你自己的 DSH 运行时目录。
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(HERE, '..')

const DSH_ROOT = process.env.DSH_ROOT ?? 'C:/path/to/dsh/runtime'
const toolsUrl = pathToFileURL(join(DSH_ROOT, 'node_modules/@deepseek-ai/dsh-tools/lib/index.js')).href
const pluginUrl = pathToFileURL(join(PLUGIN_ROOT, 'lib', 'index.js')).href

const { assertSupportedJsonSchema, assertObjectJsonSchema } = await import(toolsUrl)
const plugin = await import(pluginUrl)

const registered = []
const sections = []
const routes = []

const scoped = {
  tools: { register(def) { registered.push(def); return () => {} } },
  systemPrompt: { section(def) { sections.push(def); return () => {} } },
  webServer: { register(def) { routes.push(def); return () => {} } },
}

const ctx = {
  inject(_services, callback) { callback(scoped) },
  get() { return undefined },
  on() {},
}

plugin.apply(ctx, { escPause: false })

console.log('tools     :', registered.map((t) => t.name).join(', ') || '(none)')
console.log('prompt    :', sections.map((s) => s.name).join(', ') || '(none)')
console.log('routes    :', routes.map((r) => r.path).join(', ') || '(none)')
console.log('---')

let problems = 0
for (const tool of registered) {
  if (tool.output === undefined || typeof tool.output.render !== 'function') {
    console.log(`FAIL ${tool.name}: missing output { schema, render }`)
    problems++
    continue
  }
  try {
    assertSupportedJsonSchema(tool.output.schema)
  } catch (error) {
    console.log(`FAIL ${tool.name}: unsupported output schema — ${error.message}`)
    problems++
  }
  if (tool.parameters === undefined) {
    console.log(`FAIL ${tool.name}: missing parameters`)
    problems++
  } else {
    try {
      assertObjectJsonSchema(tool.parameters)
    } catch (error) {
      console.log(`FAIL ${tool.name}: unsupported parameters schema — ${error.message}`)
      problems++
    }
  }
  if (typeof tool.execute !== 'function') {
    console.log(`FAIL ${tool.name}: missing execute`)
    problems++
  }
  if (typeof tool.timeoutMs === 'number' && !(tool.timeoutMs > 0)) {
    console.log(`FAIL ${tool.name}: bad timeoutMs`)
    problems++
  }
}

console.log('---')
if (problems === 0 && registered.length > 0) {
  console.log(`OK: ${registered.length} tools register cleanly with the real validator`)
} else {
  console.log(`PROBLEMS: ${problems}`)
  process.exitCode = 1
}
