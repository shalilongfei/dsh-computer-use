// 定位 DSH 运行时目录（内含 node_modules/@deepseek-ai/dsh-tools）。
//
// 查找顺序：
//   1. 环境变量 DSH_ROOT（显式指定优先，指向不对会直接报错而不是静默兜底）
//   2. 从插件所在位置往上推：实际布局是 <dsh>/profiles/node_modules/@deepseek-ai/dsh-tools，
//      插件装在 <dsh>/profiles/<name>/node_modules/dsh-computer-use
//   3. 扫 ~/.dsh 及 ~/.dsh/profiles 下的子目录
//
// 找不到就抛错，并给出可以直接粘贴的修复命令 —— 不静默失败，也不让测试假装通过。
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ROOT = join(HERE, '..')

function hasTools(root) {
  return Boolean(root) && existsSync(join(root, 'node_modules/@deepseek-ai/dsh-tools/lib/index.js'))
}

export function findDshRoot() {
  if (process.env.DSH_ROOT) {
    if (hasTools(process.env.DSH_ROOT)) return process.env.DSH_ROOT
    throw new Error(
      `DSH_ROOT 设为 ${process.env.DSH_ROOT}，但该目录下没有 node_modules/@deepseek-ai/dsh-tools/lib/index.js`,
    )
  }

  const candidates = [
    join(PLUGIN_ROOT, '..', '..', '..'), // → <dsh>/profiles
    join(PLUGIN_ROOT, '..', '..'),       // → <dsh>/profiles/<name>
    join(PLUGIN_ROOT, '..'),             // → node_modules
  ]
  for (const c of candidates) if (hasTools(c)) return c

  for (const base of [join(homedir(), '.dsh'), join(homedir(), '.dsh', 'profiles')]) {
    if (!existsSync(base)) continue
    if (hasTools(base)) return base
    for (const name of readdirSync(base)) {
      const c = join(base, name)
      if (hasTools(c)) return c
    }
  }

  throw new Error(
    '找不到 DSH 运行时。请设置 DSH_ROOT 指向含 node_modules/@deepseek-ai/dsh-tools 的目录，例如：\n' +
      '  PowerShell:  $env:DSH_ROOT = "$env:USERPROFILE\\.dsh\\profiles"\n' +
      '  bash/zsh:    export DSH_ROOT="$HOME/.dsh/profiles"',
  )
}

export const DSH_ROOT = findDshRoot()
