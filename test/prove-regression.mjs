// 证明 client-boot 回归测试不是空转：它必须在"原始故障包"上失败、在"当前包"上通过。
//
// 原始故障：模块 id 用了短名 'dsh-computer-use'（bundle 必须按 package name 注册），
// 且没有防重复注册的守卫 —— 加载器会重试并执行第二次，触发 duplicate-factory 崩溃。
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CLIENT = join(ROOT, 'lib', 'client.js')
const BROKEN = join(ROOT, 'lib', 'client.broken.tmp.js')
const TEST = join(HERE, 'test-client-boot.mjs')

const original = await readFile(CLIENT, 'utf8')

// 按当初崩掉时的样子重建：短 id + 去掉重复注册守卫
let broken = original.replace(
  /const MODULE_ID = '[^']+'/,
  "const MODULE_ID = 'dsh-computer-use'",
)
broken = broken.replace(/\/\/ Belt and braces[\s\S]*?__DSH_COMPUTER_USE_CLIENT_LOADED__ = true\n/, '')
await writeFile(BROKEN, broken, 'utf8')

const brokenId = /const MODULE_ID = '([^']+)'/.exec(broken)?.[1]
const guardGone = !broken.includes('__DSH_COMPUTER_USE_CLIENT_LOADED__')
console.log(`broken copy: id="${brokenId}"  guard removed=${guardGone}\n`)

const run = (file) => spawnSync(process.execPath, [TEST, file], { encoding: 'utf8' })

console.log('=========== test vs ORIGINAL broken bundle (expect FAIL) ===========')
const bad = run(BROKEN)
console.log((bad.stdout ?? '').trim())
console.log(`-> exit ${bad.status} ${bad.status === 0 ? '(BAD: the test did not catch the bug!)' : '(good: bug detected)'}`)

console.log('\n=========== test vs CURRENT bundle (expect PASS) ===========')
const good = run(CLIENT)
console.log((good.stdout ?? '').trim())
console.log(`-> exit ${good.status} ${good.status === 0 ? '(good)' : '(BAD)'}`)

await unlink(BROKEN).catch(() => {})

const ok = bad.status !== 0 && good.status === 0
console.log(`\n${ok ? 'PROVEN: the regression test discriminates the crash from the fix' : 'NOT PROVEN'}`)
process.exitCode = ok ? 0 : 1
