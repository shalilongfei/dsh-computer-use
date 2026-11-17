/**
 * Host half of dsh-computer-use —— Windows 电脑控制插件（宿主半）
 *
 * 模型可调用的工具：computer / computer_batch / windows / ui_elements / clipboard / app_skill
 * 底层通过 C# helper（Win32Bridge.exe）调用 Win32 API 完成截图、鼠标、键盘、窗口与 UI Automation。
 */

import { spawn } from 'node:child_process'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRIDGE = join(ROOT, 'helper', 'bin', 'Release', 'net9.0-windows', 'Win32Bridge.exe')

// 提权 broker：本机安全软件只允许"管理员启动的进程"注入鼠标键盘，而 DSH 以中完整性
// 运行、整个进程树都被挡住。broker 由 start-broker.ps1 提权常驻，插件把输入类动作
// 转发过去；读取类动作仍走本地 helper（截图/UIA 在中完整性下本来就好用）。
const BROKER_HOST = '127.0.0.1'
const BROKER_PORT = Number(process.env.DSH_COMPUTER_USE_BROKER_PORT || 45919)
const BROKER_TOKEN_FILE = join(ROOT, 'helper', 'bin', 'Release', 'net9.0-windows', 'broker.token')
const BROKER_START_HINT =
  'start it with: powershell -NoProfile -ExecutionPolicy Bypass -File ' +
  '"' + join(ROOT, 'start-broker.ps1') + '"'

// broker 有管理员权限且能注入输入，所以每个请求都必须带令牌。
// 令牌由 helper 首次运行时生成，落在 exe 同级的 broker.token（只有当前用户可读）。
let brokerTokenCache = { at: 0, token: null }
async function brokerToken() {
  const now = Date.now()
  if (brokerTokenCache.token !== null && now - brokerTokenCache.at < 10000) return brokerTokenCache.token
  let token = null
  try {
    token = (await fs.readFile(BROKER_TOKEN_FILE, 'utf8')).trim() || null
  } catch {
    token = null
  }
  brokerTokenCache = { at: now, token }
  return token
}

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const SKILLS_DIR = join(DSH_HOME, 'computer-use-skills')
const SHOT_DIR = join(DSH_HOME, 'computer-use-shots')
const PAUSE_FILE = join(tmpdir(), 'dsh-computer-use-paused')
const STOP_FILE = join(tmpdir(), 'dsh-computer-use-watch-stop')
const GLOW_STOP_FILE = join(tmpdir(), 'dsh-computer-use-glow-stop')

const name = 'computer-use'

const DEFAULTS = {
  maxScreenshotWidth: 1366,
  screenshotQuality: 70,
  // Off by default: one screenshot after every action costs roughly a thousand
  // tokens each and bloats the conversation until large requests start timing
  // out. Ask for a screenshot explicitly, or turn this on deliberately.
  autoScreenshot: false,
  waitAfterAction: 400,
  authorization: 'per-app',
  forbiddenApps: [],
  showGlow: true,
  escPause: true,
  // 'auto' returns an image for an explicit screenshot and lets DSH substitute a
  // text placeholder on routes that cannot take images; 'file' never puts an
  // image into the conversation at all (only the saved path is returned).
  screenshotMode: 'auto', // auto | file
}

/**
 * 向提权 broker 发一条命令（回环 TCP，一行 JSON 请求 / 一行 JSON 响应）。
 * broker 未运行时返回 null，由调用方决定回退或报错。
 */
function callBroker(cmd, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let socket
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      try { socket && socket.destroy() } catch { /* ignore */ }
      resolve(value)
    }
    try {
      socket = net.connect({ host: BROKER_HOST, port: BROKER_PORT })
    } catch {
      done(null)
      return
    }
    let buf = ''
    const timer = setTimeout(() => done(null), timeoutMs)
    socket.setEncoding('utf8')
    socket.on('connect', async () => {
      try {
        const token = await brokerToken()
        socket.write(JSON.stringify({ token, ...cmd }) + '\n')
      } catch {
        clearTimeout(timer)
        done(null)
      }
    })
    socket.on('data', (chunk) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      clearTimeout(timer)
      const line = buf.slice(0, nl).trim()
      let parsed
      try { parsed = JSON.parse(line) } catch { done(null); return }
      done(parsed)
    })
    socket.on('error', () => { clearTimeout(timer); done(null) })
    socket.on('close', () => { clearTimeout(timer); done(null) })
  })
}

/** broker 是否在线（带短缓存，避免每个动作都探测一次）。 */
let brokerState = { at: 0, alive: false }
async function brokerAlive() {
  const now = Date.now()
  if (now - brokerState.at < 5000) return brokerState.alive
  const pong = await callBroker({ action: 'ping' }, 2500)
  brokerState = { at: now, alive: !!(pong && pong.success === true) }
  return brokerState.alive
}

/**
 * 输入类动作的统一入口：优先走提权 broker，broker 不在线时回退到本地 helper，
 * 并把"本机拦截合成输入"这件事明确告诉模型，而不是让它一路点空。
 */
async function callInput(cmd, timeoutMs = 30000) {
  if (await brokerAlive()) {
    const resp = await callBroker(cmd, timeoutMs)
    if (resp && resp.success === true) return resp.data ?? {}
    if (resp && resp.error) throw new Error(String(resp.error))
    // broker 掉线：标记并在下面回退
    brokerState = { at: Date.now(), alive: false }
  }

  const direct = await callBridge(cmd, timeoutMs)
  return direct
}

/** 调用 C# helper：写入一行 JSON 命令，读取一行 JSON 结果。 */
function callBridge(cmd, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(BRIDGE, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      reject(new Error(`cannot start computer-use helper: ${error.message}`))
      return
    }
    let out = ''
    let err = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill() } catch { /* already gone */ }
      reject(new Error(`computer-use helper timed out after ${timeoutMs}ms (${cmd.action})`))
    }, timeoutMs)
    child.stdout.on('data', (d) => { out += d.toString('utf8') })
    child.stderr.on('data', (d) => { err += d.toString('utf8') })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`computer-use helper failed: ${error.message}`))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const text = out.trim()
      if (text.length === 0) {
        reject(new Error(`computer-use helper returned nothing (exit ${code})${err.trim() ? `: ${err.trim()}` : ''}`))
        return
      }
      let parsed
      try {
        parsed = JSON.parse(text.split('\n').pop())
      } catch {
        reject(new Error(`computer-use helper returned invalid JSON: ${text.slice(0, 300)}`))
        return
      }
      if (parsed.success !== true) {
        reject(new Error(parsed.error || 'computer-use helper reported failure'))
        return
      }
      resolve(parsed.data ?? {})
    })
    child.stdin.end(JSON.stringify(cmd))
  })
}

async function isPaused() {
  try {
    await fs.access(PAUSE_FILE)
    return true
  } catch {
    return false
  }
}

// ---- 输入通道说明 ----
// 本机（安全软件按进程树拦截合成输入）的可用路径：
//   1) 提权 broker 在线  -> 输入类动作全部走它（唯一能真正点到的方式）
//   2) broker 不在线      -> 回退本地 helper；helper 会如实报错而不是假装成功
// 读取类动作（截图 / ui_elements / window_text / wait_for / clipboard）始终走本地 helper。
async function requireInputChannel(actionLabel) {
  if (await brokerAlive()) return 'broker'
  const ok = await callBridge({ action: 'diagnose', liveTest: true }, 15000)
    .then((d) => d && d.canInjectInput === true)
    .catch(() => false)
  if (ok) return 'helper'
  throw new Error(
    `${actionLabel} cannot be delivered: this machine blocks synthetic mouse/keyboard input from the ` +
    'computer-use helper (SetCursorPos/SendInput report success but the cursor never moves), because DSH runs ' +
    'at medium integrity while the security software only allows admin-launched processes to inject input. ' +
    `Fix: ${BROKER_START_HINT} then retry. ` +
    'Meanwhile these still work: screenshot, windows, ui_elements, wait_for, clipboard, click_element.',
  )
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function int(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** 截图：保存文件 + 可选以图片附件形式返回。 */
async function capture(ctx, opts) {
  const shot = await callBridge({ action: 'screenshot' }, 20000)
  const buffer = Buffer.from(shot.image, 'base64')
  await fs.mkdir(SHOT_DIR, { recursive: true })
  const filePath = join(SHOT_DIR, `shot-${Date.now()}.jpg`)
  await fs.writeFile(filePath, buffer)
  let attachment
  if (opts.screenshotMode !== 'file') {
    const attachments = ctx.get('attachments')
    if (attachments !== undefined) {
      try {
        const ref = await attachments.saveImage({ data: buffer, mediaType: 'image/jpeg', name: 'screenshot.jpg' })
        attachment = { attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height }
      } catch {
        attachment = undefined
      }
    }
  }
  return {
    path: filePath,
    width: shot.width,
    height: shot.height,
    screenWidth: shot.origWidth,
    screenHeight: shot.origHeight,
    ...(attachment === undefined ? {} : { image: attachment }),
  }
}

/** 执行一个动作；返回 { data?, shot? }。 */
async function runAction(ctx, opts, action) {
  const type = String(action.type || '').toLowerCase()
  switch (type) {
    case 'screenshot':
      return { shot: await capture(ctx, opts) }
    case 'left_click':
      await requireInputChannel('left_click')
      await callInput({ action: 'click', x: int(action.x), y: int(action.y), button: 'left', count: 1 })
      break
    case 'double_click':
      await requireInputChannel('double_click')
      await callInput({ action: 'click', x: int(action.x), y: int(action.y), button: 'left', count: 2 })
      break
    case 'triple_click':
      await requireInputChannel('triple_click')
      await callInput({ action: 'click', x: int(action.x), y: int(action.y), button: 'left', count: 3 })
      break
    case 'right_click':
      await requireInputChannel('right_click')
      await callInput({ action: 'click', x: int(action.x), y: int(action.y), button: 'right', count: 1 })
      break
    case 'middle_click':
      await requireInputChannel('middle_click')
      await callInput({ action: 'click', x: int(action.x), y: int(action.y), button: 'middle', count: 1 })
      break
    case 'mouse_move':
      await requireInputChannel('mouse_move')
      await callInput({ action: 'mouse_move', x: int(action.x), y: int(action.y) })
      break
    case 'left_click_drag':
      await requireInputChannel('left_click_drag')
      await callInput({
        action: 'drag',
        fromX: int(action.fromX ?? action.x),
        fromY: int(action.fromY ?? action.y),
        toX: int(action.toX),
        toY: int(action.toY),
      })
      break
    case 'scroll':
      await requireInputChannel('scroll')
      await callInput({ action: 'scroll', amount: int(action.amount ?? 3) || 3, direction: String(action.direction || 'down') })
      break
    case 'type':
      if (typeof action.text !== 'string') throw new Error('type requires a text string')
      // 键盘输入同样优先走 broker（提权通道）；broker 不在线时 helper 会先试 UI Automation
      // 的 ValuePattern 写值，失败才回落到真实键盘事件。
      await requireInputChannel('type')
      await callInput({ action: 'type', text: action.text, preferNativeInput: action.preferNativeInput === true }, 180000)
      break
    case 'key':
      await requireInputChannel('key')
      await callInput({
        action: 'key',
        key: String(action.key || ''),
        modifiers: Array.isArray(action.modifiers) ? action.modifiers.map(String) : [],
      })
      break
    case 'wait':
      await sleep(Math.max(0, Math.min(60000, int(action.ms ?? 1000))))
      break
    case 'diagnose':
      return {
        data: {
          broker: await callBroker({ action: 'ping' }, 3000),
          helper: await callBridge({ action: 'diagnose', liveTest: action.liveTest !== false }, 20000),
        },
      }
    case 'cursor_position':
      return { data: await callInput({ action: 'cursor_position' }) }
    case 'click_element':
      return {
        data: await callBridge({
          action: 'click_element',
          title: typeof action.window === 'string' ? action.window : '',
          target: String(action.target || ''),
        }, 20000),
      }
    case 'wait_for':
      return {
        data: await callBridge({
          action: 'wait_for',
          condition: String(action.condition || 'window'),
          target: String(action.target || ''),
          timeoutMs: Math.max(100, Math.min(60000, int(action.timeoutMs ?? 5000))),
        }, 70000),
      }
    case 'clipboard':
      return {
        data: await callBridge({
          action: 'clipboard',
          operation: String(action.operation || 'read'),
          text: typeof action.text === 'string' ? action.text : '',
        }),
      }
    case 'glow':
      return { data: setGlow(action.glowAction, action.text) }
    default:
      throw new Error(`unknown action "${type}"`)
  }
  if (opts.waitAfterAction > 0) await sleep(opts.waitAfterAction)
  return {}
}

/** 把截图结果渲染成模型可见内容块。 */
function shotContent(shot, note) {
  const head = note ? `${note}\n` : ''
  if (shot.image !== undefined) {
    return [
      { type: 'text', text: `${head}screenshot ${shot.width}x${shot.height} (screen ${shot.screenWidth}x${shot.screenHeight}) · file ${shot.path}` },
      // `attachment` must be a complete ImageAttachmentRef (attachmentId, mediaType,
      // bytes, width, height) — the same shape capture() builds and IMAGE_VALUE_SCHEMA
      // declares. Passing only `attachmentId` made the DeepSeek adapter read undefined
      // dimensions while preparing the request image target, so every deepseek-official
      // request containing a screenshot died with `TRANSPORT` before reaching the network.
      { type: 'image', attachment: shot.image },
    ]
  }
  return [{
    type: 'text',
    text: `${head}screenshot ${shot.width}x${shot.height} (screen ${shot.screenWidth}x${shot.screenHeight}) saved to ${shot.path}. This model route cannot receive images, so only the path is returned.`,
  }]
}

// NOTE: register() takes plain JSON Schema — `required` is an object-level array,
// never a per-property boolean (that is defineTool's spec format, not this one).
const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string' },
    mediaType: { type: 'string' },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
  },
  required: ['attachmentId'],
}

const SHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    screenWidth: { type: 'integer' },
    screenHeight: { type: 'integer' },
    image: IMAGE_VALUE_SCHEMA,
    text: { type: 'string' },
  },
  required: ['path', 'width', 'height', 'screenWidth', 'screenHeight'],
}

const TEXT_OUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { text: { type: 'string' } },
  required: ['text'],
}

const ACTION_ENUM = [
  'screenshot', 'left_click', 'double_click', 'triple_click', 'right_click', 'middle_click',
  'mouse_move', 'left_click_drag', 'scroll', 'type', 'key', 'wait', 'cursor_position',
  'click_element', 'wait_for', 'clipboard', 'glow', 'diagnose',
]

function actionProps() {
  return {
    type: { type: 'string', enum: ACTION_ENUM, description: '要执行的动作。' },
    x: { type: 'number', description: '点击/移动的 X 坐标（截图像素）。' },
    y: { type: 'number', description: '点击/移动的 Y 坐标（截图像素）。' },
    fromX: { type: 'number', description: '拖拽起点 X。' },
    fromY: { type: 'number', description: '拖拽起点 Y。' },
    toX: { type: 'number', description: '拖拽终点 X。' },
    toY: { type: 'number', description: '拖拽终点 Y。' },
    text: { type: 'string', description: 'type：要输入的文本；clipboard：要写入的文本；glow：提示条文字。' },
    key: { type: 'string', description: 'key：按键名，如 return / tab / escape / c / v。' },
    modifiers: { type: 'array', items: { type: 'string' }, description: 'key：修饰键，如 ctrl / alt / shift。' },
    amount: { type: 'number', description: 'scroll：滚动格数。' },
    direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'scroll：方向。' },
    ms: { type: 'number', description: 'wait：等待毫秒数。' },
    target: { type: 'string', description: 'click_element / wait_for：控件名称或 AutomationId。' },
    window: { type: 'string', description: 'click_element：目标窗口标题（留空用当前前台窗口）。' },
    condition: { type: 'string', enum: ['window', 'element', 'disappear'], description: 'wait_for：等待条件。' },
    timeoutMs: { type: 'number', description: 'wait_for：超时毫秒数。' },
    operation: { type: 'string', enum: ['read', 'write'], description: 'clipboard：读或写。' },
    glowAction: { type: 'string', enum: ['show', 'hide'], description: 'glow：显示或隐藏橙色光晕。' },
    liveTest: { type: 'boolean', description: 'diagnose：是否真的试着移动一次光标来实测注入能力（默认 true）。' },
    preferNativeInput: { type: 'boolean', description: 'type：跳过 UI Automation，强制用真实键盘事件输入（默认 false）。' },
  }
}

function apply(ctx, config) {
  const opts = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }

  ctx.inject(['systemPrompt'], (scoped) => {
    scoped.systemPrompt.section({
      name: 'tool:computer',
      order: 120,
      text: `You can operate the user's Windows desktop with the computer tool (screenshot, mouse, keyboard, clipboard) plus the windows, ui_elements, clipboard, and app_skill tools.

Rules:
- Screenshot first to see the current state; screenshot again after acting to verify.
- Coordinates are pixels in the returned screenshot's own frame (the screenshot is downscaled from the real screen; use its width/height as the reference).
- Prefer click_element with a control name over raw coordinates when the target has a name; call ui_elements to discover names and read a window as text.
- Use wait_for to wait for a window or control to appear rather than guessing with wait.
- Use computer_batch to run several steps in one call; it returns one screenshot at the end.
- If the user presses Esc, control is paused and actions fail with a paused error — stop and let the user resume.
- Never type passwords or payment details and never solve CAPTCHAs; hand those back to the user.
- app_skill stores per-application operating notes; read it before driving an unfamiliar app and append what you learn.
- Some hardened machines block synthetic mouse/keyboard input from the helper: the calls report success but the cursor
  never moves, so clicks land nowhere. On this machine that is fixed by the elevated broker channel
  (start-broker.ps1). If a click/move/key action reports "cannot be delivered", run computer { type: "diagnose" } to
  see whether the broker is online, then tell the user to start it with start-broker.ps1.`,
    })
  })

  // ---- computer：单个动作 ----
  ctx.inject(['tools'], (scoped) => {
    scoped.tools.register({
      name: 'computer',
      description:
        'Operate the Windows desktop: take a screenshot, move/click the mouse, drag, scroll, type text, press keys, ' +
        'click a UI control by name, wait for a window or control, read/write the clipboard, or show the control overlay. ' +
        'Always screenshot first to see the current state.',
      parameters: { type: 'object', properties: actionProps(), required: ['type'], additionalProperties: false },
      output: {
        schema: SHOT_SCHEMA,
        render(args, value) {
          if (String(args && args.type).toLowerCase() === 'screenshot') return shotContent(value)
          return [{ type: 'text', text: value && value.text ? value.text : `${String((args && args.type) || 'action')} ok · ${value ? value.path : ''}` }]
        },
      },
      timeoutMs: 180000,
      isConcurrencySafe: () => false,
      async execute(args) {
        await assertAllowed(opts)
        const type = String(args.type).toLowerCase()
        const result = await runAction(ctx, opts, args)
        if (result.shot !== undefined) return result.shot
        if (type === 'cursor_position') {
          return { path: '', width: 0, height: 0, screenWidth: 0, screenHeight: 0, text: `cursor at (${result.data.x}, ${result.data.y})` }
        }
        if (type === 'diagnose') {
          const d = result.data || {}
          const helper = d.helper || {}
          const broker = d.broker
          const lines = [
            broker && broker.success === true
              ? `broker(提权通道): 在线 — ${JSON.stringify(broker.data)}`
              : `broker(提权通道): 未运行 — 需要鼠标键盘时先执行 ${BROKER_START_HINT}`,
            `helper canInjectInput: ${String(helper.canInjectInput)}`,
            `session=${helper.sessionId} threadDesktop=${helper.threadDesktop} inputDesktop=${helper.inputDesktop}`,
            `screen=${helper.screenWidth}x${helper.screenHeight} cursor=${(helper.cursor || []).join(',')}`,
            helper.liveTest ? `helper 实测: sendInputWorked=${helper.liveTest.sendInputWorked} setCursorPosWorked=${helper.liveTest.setCursorPosWorked}` : '',
            helper.canInjectInput === false && !(broker && broker.success === true)
              ? '结论：本地 helper 被拒绝注入，且提权 broker 不在线 → 鼠标键盘动作无法送达。'
              : '',
          ].filter(Boolean)
          return { path: '', width: 0, height: 0, screenWidth: 0, screenHeight: 0, text: lines.join('\n') }
        }
        if (result.data !== undefined) {
          return { path: '', width: 0, height: 0, screenWidth: 0, screenHeight: 0, text: JSON.stringify(result.data) }
        }
        if (opts.autoScreenshot) return await capture(ctx, opts)
        return { path: '', width: 0, height: 0, screenWidth: 0, screenHeight: 0, text: `${type} ok` }
      },
      presentCall(args) {
        return { card: 'terminal', title: `computer ${String((args && args.type) || '')}`.trim() }
      },
    })

    // ---- computer_batch：批量动作 ----
    scoped.tools.register({
      name: 'computer_batch',
      description:
        'Run several desktop actions in sequence in one call, then return one final screenshot. ' +
        'Stops at the first failure. Much cheaper than many separate computer calls.',
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            description: '按顺序执行的动作列表。',
            items: { type: 'object', properties: actionProps(), required: ['type'], additionalProperties: false },
          },
        },
        required: ['actions'],
        additionalProperties: false,
      },
      output: {
        schema: SHOT_SCHEMA,
        render(_args, value) {
          return shotContent(value, 'batch finished')
        },
      },
      timeoutMs: 600000,
      isConcurrencySafe: () => false,
      async execute(args) {
        const list = Array.isArray(args.actions) ? args.actions : []
        if (list.length === 0) throw new Error('actions must contain at least one action')
        for (const action of list) {
          await assertAllowed(opts)
          await runAction(ctx, opts, action)
        }
        return await capture(ctx, opts)
      },
      presentCall(args) {
        const n = Array.isArray(args && args.actions) ? args.actions.length : 0
        return { card: 'terminal', title: `computer_batch (${n} actions)` }
      },
    })

    // ---- windows：窗口管理 ----
    scoped.tools.register({
      name: 'windows',
      description: 'List visible desktop windows, or focus / minimize / maximize / restore / close one by title or handle.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'focus', 'minimize', 'maximize', 'restore', 'close'], description: '窗口操作。' },
          title: { type: 'string', description: 'focus 用：窗口标题片段。' },
          handle: { type: 'number', description: 'minimize/maximize/restore/close 用：窗口句柄。' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: TEXT_OUT_SCHEMA,
        render(_args, value) {
          return [{ type: 'text', text: value.text }]
        },
      },
      timeoutMs: 25000,
      isConcurrencySafe: () => true,
      async execute(args) {
        const action = String(args.action).toLowerCase()
        if (action === 'list') {
          const windows = await callBridge({ action: 'list_windows' })
          const list = Array.isArray(windows) ? windows : []
          const text = list.length === 0
            ? 'No visible windows.'
            : list.map((w) => `- "${w.title}" handle=${w.handle} pid=${w.processId} ${w.width}x${w.height} at (${w.x},${w.y})${w.minimized ? ' [minimized]' : ''}`).join('\n')
          return { text }
        }
        if (action === 'focus') {
          if (typeof args.title !== 'string' || args.title.trim().length === 0) throw new Error('focus requires a non-empty title')
          const data = await callBridge({ action: 'focus_window', title: args.title })
          return { text: `focused "${args.title}" (handle=${data.handle ?? '?'})` }
        }
        await callBridge({ action: 'window_op', handle: int(args.handle), operation: action })
        return { text: `${action} ok` }
      },
      presentCall(args) {
        return { card: 'terminal', title: `windows ${String((args && args.action) || '')}`.trim() }
      },
    })

    // ---- ui_elements：UI Automation ----
    scoped.tools.register({
      name: 'ui_elements',
      description:
        'Read the UI Automation tree of a window: every control with its name, role, AutomationId, screen bounds, and whether it is clickable. ' +
        'Use it to find control names for click_element, or to read a window as text.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '窗口标题片段；留空表示当前前台窗口。' },
          includeText: { type: 'boolean', description: '是否同时读出每个控件的文本内容（更慢、更长）。' },
          maxElements: { type: 'number', description: '最多返回多少个控件（默认 200，上限 500）。' },
        },
        additionalProperties: false,
      },
      output: {
        schema: TEXT_OUT_SCHEMA,
        render(_args, value) {
          return [{ type: 'text', text: value.text }]
        },
      },
      timeoutMs: 60000,
      isConcurrencySafe: () => true,
      async execute(args) {
        const data = await callBridge({
          action: 'ui_elements',
          title: typeof args.title === 'string' ? args.title : '',
          includeText: args.includeText === true,
        }, 60000)
        const elements = Array.isArray(data.elements) ? data.elements : []
        // Keep one listing from swallowing the conversation: fewer rows by
        // default, and a hard cap on the rendered text.
        const cap = Math.max(1, Math.min(300, int(args.maxElements ?? 120)))
        const shown = elements.slice(0, cap)
        const lines = shown.map((e) => {
          const b = e.bounds || {}
          const flags = [e.clickable ? 'clickable' : '', e.focused ? 'focused' : '', e.enabled === false ? 'disabled' : ''].filter(Boolean).join(',')
          const text = e.text ? ` text="${String(e.text).slice(0, 120)}"` : ''
          return `[${e.index}] ${String(e.role || '').replace('ControlType.', '')} "${String(e.name).slice(0, 120)}" id="${e.automationId}" at (${b.x},${b.y}) ${b.width}x${b.height}${flags ? ` {${flags}}` : ''}${text}`
        })
        const where = typeof args.title === 'string' && args.title ? `in window matching "${args.title}"` : 'in the foreground window'
        const body = `${shown.length} of ${elements.length} controls ${where}\n${lines.join('\n')}`
        const MAX_TEXT = 12000
        return {
          text: body.length <= MAX_TEXT
            ? body
            : `${body.slice(0, MAX_TEXT)}\n… (truncated at ${MAX_TEXT} chars; narrow the listing with maxElements or title)`,
        }
      },
      presentCall() {
        return { card: 'terminal', title: 'ui_elements' }
      },
    })

    // ---- clipboard ----
    scoped.tools.register({
      name: 'clipboard',
      description: 'Read or write the Windows clipboard text.',
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['read', 'write'], description: '读或写。' },
          text: { type: 'string', description: 'write 时写入的文本。' },
        },
        required: ['operation'],
        additionalProperties: false,
      },
      output: {
        schema: TEXT_OUT_SCHEMA,
        render(_args, value) {
          return [{ type: 'text', text: value.text }]
        },
      },
      timeoutMs: 10000,
      isConcurrencySafe: () => true,
      async execute(args) {
        const operation = String(args.operation).toLowerCase()
        if (operation === 'read') {
          const data = await callBridge({ action: 'clipboard', operation: 'read' })
          const text = String(data.text || '')
          return { text: `clipboard (${text.length} chars):\n${text}` }
        }
        if (typeof args.text !== 'string') throw new Error('write requires a text string')
        await callBridge({ action: 'clipboard', operation: 'write', text: args.text })
        return { text: `clipboard written (${args.text.length} chars)` }
      },
      presentCall(args) {
        return { card: 'terminal', title: `clipboard ${String((args && args.operation) || '')}`.trim() }
      },
    })

    // ---- app_skill ----
    scoped.tools.register({
      name: 'app_skill',
      description:
        'Manage per-application operating notes (one Markdown file per app, under $DSH_HOME/computer-use-skills). ' +
        'list shows known apps; read returns one app\'s notes; append adds lines; write replaces them.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'read', 'append', 'write'], description: '技能操作。' },
          app: { type: 'string', description: '应用名，如 Word / Chrome / 记事本。' },
          content: { type: 'string', description: 'append/write 的内容。' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: TEXT_OUT_SCHEMA,
        render(_args, value) {
          return [{ type: 'text', text: value.text }]
        },
      },
      timeoutMs: 15000,
      isConcurrencySafe: () => true,
      async execute(args) {
        const action = String(args.action).toLowerCase()
        await fs.mkdir(SKILLS_DIR, { recursive: true })
        if (action === 'list') {
          const files = await fs.readdir(SKILLS_DIR)
          const apps = files.filter((f) => f.toLowerCase().endsWith('.md')).map((f) => f.replace(/\.md$/iu, ''))
          return { text: apps.length === 0 ? 'No app skills yet.' : `App skills:\n${apps.map((a) => `- ${a}`).join('\n')}` }
        }
        const app = typeof args.app === 'string' ? args.app.trim() : ''
        if (app.length === 0) throw new Error(`${action} requires an app name`)
        if (/[\\/:*?"<>|]/u.test(app)) throw new Error('app name must not contain path characters')
        const file = join(SKILLS_DIR, `${app}.md`)
        if (action === 'read') {
          try {
            return { text: `skill "${app}":\n${await fs.readFile(file, 'utf8')}` }
          } catch {
            return { text: `no skill recorded for "${app}" yet` }
          }
        }
        const content = typeof args.content === 'string' ? args.content : ''
        if (action === 'append') {
          let existing = ''
          try { existing = await fs.readFile(file, 'utf8') } catch { existing = `# ${app}\n` }
          await fs.writeFile(file, `${existing.trimEnd()}\n${content}\n`, 'utf8')
          return { text: `appended ${content.length} chars to skill "${app}"` }
        }
        await fs.writeFile(file, content, 'utf8')
        return { text: `wrote skill "${app}" (${content.length} chars)` }
      },
      presentCall(args) {
        return { card: 'terminal', title: `app_skill ${String((args && args.action) || '')}`.trim() }
      },
    })
  })

  // ---- 侧边栏面板 / 设置页 的数据接口 ----
  ctx.inject(['webServer'], (scoped) => {
    const off = scoped.webServer.register({
      kind: 'exact',
      path: '/dsh-computer-use/state',
      handler: (req, res) => {
        const respond = (payload) => {
          const body = JSON.stringify(payload)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(body)
        }
        Promise.resolve()
          .then(async () => {
            const paused = await isPaused()
            let windows = []
            try {
              const list = await callBridge({ action: 'list_windows' }, 8000)
              windows = (Array.isArray(list) ? list : []).slice(0, 30).map((w) => ({ title: w.title, handle: w.handle, pid: w.processId }))
            } catch {
              windows = []
            }
            respond({ ok: true, paused, windows, config: opts })
          })
          .catch((error) => respond({ ok: false, error: String(error && error.message ? error.message : error), paused: false, windows: [] }))
      },
    })
    ctx.on('dispose', () => {
      try { off() } catch { /* already gone */ }
    })
  })

  // ---- Esc 暂停监视器 ----
  if (opts.escPause !== false) startEscWatcher()
  ctx.on('dispose', () => {
    stopEscWatcher()
    setGlow('hide')
  })
}

let watcher = null

function startEscWatcher() {
  if (watcher !== null) return
  try { unlinkSync(STOP_FILE) } catch { /* absent */ }
  try {
    watcher = spawn(BRIDGE, [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
    watcher.on('error', () => { watcher = null })
    watcher.on('close', () => { watcher = null })
    watcher.stdin.end(JSON.stringify({ action: 'esc_watch', pauseFile: PAUSE_FILE, stopFile: STOP_FILE }))
  } catch {
    watcher = null
  }
}

function stopEscWatcher() {
  const current = watcher
  watcher = null
  if (current === null) return
  try { writeFileSync(STOP_FILE, 'stop') } catch { /* ignore */ }
  setTimeout(() => {
    try { current.kill() } catch { /* already gone */ }
  }, 400)
}

let glowProcess = null

/** 显示 / 隐藏橙色光晕：光晕是一个独立的常驻进程，超出一句话的调用生命周期。 */
function setGlow(glowAction, text) {
  const hide = String(glowAction || 'show').toLowerCase() === 'hide'
  const previous = glowProcess
  glowProcess = null
  if (previous !== null) {
    try { previous.kill() } catch { /* already gone */ }
  }
  if (hide) {
    try { writeFileSync(GLOW_STOP_FILE, 'stop') } catch { /* ignore */ }
    return { shown: false }
  }
  try { unlinkSync(GLOW_STOP_FILE) } catch { /* absent */ }
  try {
    glowProcess = spawn(BRIDGE, [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
    glowProcess.on('error', () => { glowProcess = null })
    glowProcess.on('close', () => { glowProcess = null })
    glowProcess.stdin.end(JSON.stringify({ action: 'glow_run', text: String(text || ''), stopFile: GLOW_STOP_FILE }))
  } catch {
    glowProcess = null
  }
  return { shown: true, text: String(text || '') }
}

/** 暂停校验 + 禁用应用校验。 */async function assertAllowed(opts) {
  if (await isPaused()) {
    throw new Error('computer use is paused: the user pressed Esc. Ask the user to press Esc again to resume.')
  }
  const forbidden = Array.isArray(opts.forbiddenApps) ? opts.forbiddenApps : []
  if (forbidden.length === 0) return
  let focused = ''
  try {
    const windows = await callBridge({ action: 'list_windows' }, 8000)
    focused = String((Array.isArray(windows) && windows[0] && windows[0].title) || '')
  } catch {
    focused = ''
  }
  const lower = focused.toLowerCase()
  for (const block of forbidden) {
    if (lower.includes(String(block).toLowerCase())) {
      throw new Error(`computer use is not allowed on "${focused}" (matches forbidden entry "${block}")`)
    }
  }
}

export { apply, name, DEFAULTS, callBridge, PAUSE_FILE }
