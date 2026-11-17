<div align="center">

# dsh-computer-use

**让你的 DSH agent 真的会「用电脑」**

截图 · 鼠标 · 键盘 · 窗口 · UI Automation · 剪贴板

<br>

[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4?logo=windows&logoColor=white)](#环境要求)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](#环境要求)
[![.NET](https://img.shields.io/badge/.NET-9-512BD4?logo=dotnet&logoColor=white)](#环境要求)
[![License](https://img.shields.io/badge/license-MIT-3DA639?logo=opensourceinitiative&logoColor=white)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.3.0-blue)](CHANGELOG.md)
[![DSH Plugin](https://img.shields.io/badge/DSH-plugin-5B4B8A)](https://github.com/deepseek-ai/deepseek-harness)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件。装上之后，模型能看屏幕、点按钮、打字、切窗口——也就是常说的 *computer use*。

</div>

---

## 目录

- [它解决什么问题](#它解决什么问题)
- [架构](#架构)
- [特性](#特性)
- [环境要求](#环境要求)
- [安装](#安装)
- [工具一览](#工具一览)
- [快速上手](#快速上手)
- [坐标系（重要）](#坐标系重要)
- [点了没反应怎么办](#点了没反应怎么办)
- [提权 broker](#提权-broker)
- [配置项](#配置项)
- [应用笔记 app_skill](#应用笔记-app_skill)
- [测试](#测试)
- [目录结构](#目录结构)
- [安全说明](#安全说明)
- [FAQ](#faq)
- [许可](#许可)

---

## 它解决什么问题

普通 DSH 插件只能读写文件、跑命令。但有一大类事只能通过「看着屏幕、动鼠标、敲键盘」完成：

- 桌面客户端里的操作（微信、钉钉、企业微信、QQ）
- 只有图形界面的老系统、内网后台、专用软件
- 需要看渲染结果的场景（图表、视频、游戏、设计稿对比）
- 网页上故意用 canvas / 图片挡住 DOM 的地方
- 需要人眼判断的对比任务（截图前后差异）

这个插件把 Windows 的 Win32 / UI Automation 能力包成 6 个工具交给模型，模型自己决定看哪儿、点哪儿、打什么字。

---

## 架构

```
┌─────────────┐   tools    ┌───────────────┐  stdin/stdout  ┌─────────────────┐
│   DSH 模型  │ ─────────► │  lib/index.js │ ─────────────► │ Win32Bridge.exe │
│    (LLM)    │            │ （插件宿主半） │   one-shot     │   （C# / Win32） │
└─────────────┘            └───────┬───────┘                └─────────────────┘
                                   │
                                   │ loopback TCP + 令牌
                                   ▼
                           ┌─────────────────────┐
                           │  提权 broker         │  ← 仅在「合成输入被系统拦截」的机器上需要
                           │ （管理员权限常驻）    │
                           └─────────────────────┘
```

三个组件，职责很清楚：

| 组件 | 角色 | 权限 |
|---|---|---|
| `lib/index.js` | 插件宿主半。向 DSH 注册工具、换算坐标、调度注入通道 | 跟随 DSH |
| `Win32Bridge.exe` | C# 写的 Win32 桥。**每次调用起一个进程**，一行 JSON 进、一行 JSON 出 | 跟随 DSH |
| 提权 broker | 可选。以管理员身份常驻，只在本地注入被拦时接管输入类动作 | 管理员 |

> 为什么 helper 是**一次性进程**而不是常驻服务？因为常驻进程会被安全软件盯上、会持有句柄、会被 AV 拦截得更狠。一次性进程的行为特征最干净，退出后不留痕迹。

---

## 特性

| 能力 | 说明 |
|---|---|
| **截图** | 自动缩放到指定宽度（默认 1366）并压成 JPEG，可直接喂给多模态模型 |
| **鼠标** | 移动、左/右/中键单击、双击、三击、拖拽、滚轮——**每次注入后回读真实光标位置校验** |
| **键盘** | 任意 Unicode 文本输入（走 `KEYEVENTF_UNICODE`，**不污染剪贴板**）、按键与修饰键组合 |
| **窗口** | 枚举可见窗口（标题/类名/进程/位置/是否最小化）、聚焦、最小化/最大化/还原/关闭 |
| **UI Automation** | 读控件树（名称/类型/AutomationId/位置/是否可点击）、按名称点击控件、等待窗口或控件出现 |
| **剪贴板** | 读写文本 |
| **批量动作** | `computer_batch` 顺序执行一串动作，最后只返回一张截图，省 token |
| **交互提示** | 屏幕边缘橙色光晕，让你看得见 agent 正在操作；`Esc` 可暂停 |
| **应用笔记** | `app_skill` 按应用累积操作经验，跨会话复用 |

### 设计上的三个坚持

**1. 绝不假装成功。**
安全软件拦截合成输入时，`SetCursorPos` / `SendInput` 会返回成功但光标纹丝不动。上游就以为「点过了」，其实点的是别的东西。本插件每次注入后都回读真实光标坐标，不到位就明确报错。

**2. 键盘输入不碰剪贴板。**
老方案是「写剪贴板 → Ctrl+V → 还原剪贴板」，中途被别的程序抢了剪贴板就丢数据。这里改用 `KEYEVENTF_UNICODE` 直输，中文/emoji 都能打，剪贴板一动不动。

**3. 高 DPI 不点偏。**
UIA 返回物理像素，鼠标 API 用逻辑像素，175% 缩放下差 1.75 倍。`click_element` 内部完成换算，落点还会用像素颜色复核。

---

## 环境要求

| 项 | 要求 |
|---|---|
| 系统 | Windows 10 / 11 |
| Node.js | ≥ 18（DSH 自带运行时，一般无需单独安装） |
| .NET SDK | 9.x —— **仅编译 helper 时需要**，仓库已含预编译产物 |
| DSH | 桌面版 |

---

## 安装

### 方式一：直接克隆（最省事）

```powershell
git clone https://github.com/shalilongfei/dsh-computer-use.git `
  "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-computer-use"
```

然后在 DSH 配置里启用插件（见 [配置项](#配置项)），重启 DSH。

### 方式二：目录联接（开发用，改完立即生效）

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-computer-use" `
  -Target "C:\path\to\your\dsh-computer-use"
```

改动即时生效，不用反复拷来拷去。

### 验证安装

重启 DSH 后，让模型执行：

```
computer { "type": "diagnose" }
```

返回里应该能看到 `canInjectInput: true`、屏幕尺寸、DPI、broker 状态。**如果这里是 false，先去看 [点了没反应怎么办](#点了没反应怎么办)**。

### 编译 helper（可选）

仓库里的 `helper/bin/Release/net9.0-windows/` 是预编译产物，开箱可用。只有你改了 `helper/Program.cs` 才需要重编：

```powershell
# 先停 broker，否则 exe 被占用 → 构建"成功"但产物没更新
powershell -NoProfile -ExecutionPolicy Bypass -File start-broker.ps1 -Stop

dotnet build helper/Win32Bridge.csproj -c Release
```

---

## 工具一览

插件向模型注册 6 个工具：

| 工具 | 干什么 |
|---|---|
| `computer` | 单个动作（截图 / 鼠标 / 键盘 / 等待 / 剪贴板 / 诊断） |
| `computer_batch` | 一串动作顺序执行，最后返回一张截图 |
| `windows` | 窗口枚举与操作 |
| `ui_elements` | 读控件树 |
| `clipboard` | 剪贴板读写 |
| `app_skill` | 按应用记录操作笔记 |

`computer` 的 `type` 全部取值：

```text
screenshot   left_click   double_click   triple_click   right_click   middle_click
mouse_move   left_click_drag   scroll   type   key   wait   cursor_position
click_element   wait_for   clipboard   glow   diagnose
```

### 参数速查

| 参数 | 用于 | 说明 |
|---|---|---|
| `x` `y` | 点击 / 移动 | **截图像素**坐标 |
| `fromX` `fromY` `toX` `toY` | 拖拽 | 截图像素坐标 |
| `text` | `type` / `clipboard` / `glow` | 要输入或写入的文本 |
| `key` | `key` | 按键名：`return` `tab` `escape` `c` `v` … |
| `modifiers` | `key` | `["ctrl"]` `["alt","shift"]` |
| `amount` / `direction` | `scroll` | 滚动格数与方向 |
| `ms` | `wait` | 等待毫秒 |
| `target` | `click_element` / `wait_for` | 控件名称或 AutomationId |
| `window` | `click_element` | 目标窗口标题，留空用前台窗口 |
| `condition` | `wait_for` | `window` / `element` / `disappear` |
| `timeoutMs` | `wait_for` | 超时毫秒 |
| `operation` | `clipboard` | `read` / `write` |
| `glowAction` | `glow` | `show` / `hide` |
| `liveTest` | `diagnose` | 是否真移一次光标做实测（默认 true） |
| `preferNativeInput` | `type` | 跳过 UIA，强制真实键盘事件（默认 false） |

---

## 快速上手

### 1. 看一眼屏幕

```json
{ "type": "screenshot" }
```

### 2. 点一个按钮

```json
{ "type": "left_click", "x": 683, "y": 420 }
```

坐标是**截图像素**，直接量图上的位置就行。

### 3. 打字

```json
{ "type": "type", "text": "你好，这是一段中文测试 🎉" }
```

### 4. 组合键

```json
{ "type": "key", "key": "v", "modifiers": ["ctrl"] }
```

### 5. 别猜坐标，直接点控件

比量像素稳得多，尤其是窗口位置会变的时候：

```json
{ "type": "click_element", "target": "保存" }
```

### 6. 批量动作省 token

```json
{
  "actions": [
    { "type": "left_click", "x": 200, "y": 300 },
    { "type": "wait", "ms": 600 },
    { "type": "type", "text": "hello" },
    { "type": "key", "key": "return" }
  ]
}
```

只返回最后一张截图。

---

## 坐标系（重要）

**截图坐标和鼠标 API 的坐标不是同一套。** 插件内部已做换算，但你自己调 helper 时要清楚：

| 空间 | 尺寸（示例：175% 缩放的 2880×1800 屏） | 用途 |
|---|---|---|
| 截图 | 1366 × 853 | 模型看到的图；乘 `屏宽/1366` 得指针坐标 |
| 指针逻辑 | 1646 × 1029 | `SetCursorPos` / `GetCursorPos` / `WindowFromPoint` |
| UIA 物理 | 2880 × 1800 | `ui_elements` 返回的 `bounds`；乘 `逻辑/物理` 得指针坐标 |

`click_element` 自动完成 UIA → 指针的换算，你只管给控件名。

---

## 点了没反应怎么办

先说结论：**这不是本插件独有的毛病，是 Windows 这类 API 的通病。** 在加固环境（安全软件、受限桌面、远程会话）里，合成输入的失败是**静默**的——API 报成功，光标不动。

插件的三层处理：

1. **每次注入后回读真实光标位置**校验，没到位就明确报错，绝不假装成功
2. 本地注入被拦时，自动尝试**提权 broker** 通道
3. 两条路都不通时，报错信息直接告诉模型改用 UI Automation（`click_element`）

### 诊断

```json
{ "type": "diagnose" }
```

返回内容包含：本地 helper 的注入能力、broker 在线状态、屏幕尺寸 / DPI / 桌面信息、`virtualScreen` 范围。

看这几个字段：

| 字段 | 正常值 | 不对时说明 |
|---|---|---|
| `canInjectInput` | `true` | 本地注入被拦，需要 broker |
| `broker.online` | `true` / `false` | false 而 `canInjectInput` 也 false → 两条路都断了 |
| `screen` | 你的分辨率 | 对不上说明 DPI 感知有问题 |
| `pointer` | 光标真实位置 | 与请求值不符 = 注入被丢 |

### 常见原因排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `canInjectInput: false` | DSH 以中完整性运行，被安全软件/UIPI 挡了 | 启动 broker，或直接以管理员运行 DSH |
| 截图全黑 | 走了独立显卡 / 远程会话 / 受保护内容 | 关掉硬件加速，或改用 `ui_elements` |
| 点击落在错误位置 | 坐标系用错了（UIA 坐标当截图坐标） | 用 `click_element`，或按上表换算 |
| 打字丢字符 | 目标控件是 UIA 可编辑区但未聚焦 | 先 `left_click` 聚焦，再 `type` |

---

## 提权 broker

### 什么时候需要

某些机器只允许**管理员启动的进程**注入输入。DSH 以中完整性（非管理员）运行时，整个进程树都被挡在外面：

| 运行方式 | `SetCursorPos` 结果 |
|---|---|
| 在 DSH 进程树内（被拦截时） | `ok=False`，光标不动 |
| 管理员启动（broker / 计划任务 / `-Verb RunAs`） | `ok=True`，光标真的动 |

这种拦截**不是恒定的**——同一台机器上可能随安全软件策略变化而出现或消失。所以插件策略是：优先本地注入，被拦自动走 broker，两条都不通才报错。

**读取类动作（截图 / UIA / 窗口 / 剪贴板 / 等待）不需要 broker。**

### 启动

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File start-broker.ps1
```

broker 以管理员身份常驻，监听 `127.0.0.1:45919`（可用环境变量 `DSH_COMPUTER_USE_BROKER_PORT` 改端口），日志写 `broker.log`。

### 停止

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File start-broker.ps1 -Stop
```

### 开机自启（只做一次）

```powershell
schtasks /Create /TN "DSHComputerUseBroker" /SC ONLOGON /RL HIGHEST /F `
  /TR "\"%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-computer-use\helper\bin\Release\net9.0-windows\Win32Bridge.exe\" --broker 45919"
```

移除：`schtasks /End /TN DSHComputerUseBroker` 然后 `schtasks /Delete /TN DSHComputerUseBroker /F`

### 更彻底的做法

**直接以管理员身份运行 DSH**。整个进程树都有注入权限，broker 就不需要了，攻击面也更小。这是推荐的部署方式。

细节见 [BROKER-README.md](BROKER-README.md)。

---

## 配置项

在 DSH 配置里（或 `cordis.patch.yml` 的 `config` 段）：

```js
{
  maxScreenshotWidth: 1366,  // 截图缩放后的宽度
  screenshotQuality: 70,     // JPEG 质量（1-100）
  autoScreenshot: false,     // 每个动作后自动截图（很费 token，默认关）
  waitAfterAction: 400,      // 动作后的固定等待（毫秒）
  authorization: 'per-app',  // 'per-app' | 'allow-all'
  forbiddenApps: [],         // 禁止操作的应用，如 ['1Password', 'WeChat']
  showGlow: true,            // 显示操作提示光晕
  escPause: true,            // 允许 Esc 暂停
  screenshotMode: 'auto',    // 'auto' | 'file'
}
```

### `screenshotMode` 说明

默认配置里是 `file`。

- `file` —— 只返回保存的文件路径。**推荐**，因为内置 DeepSeek provider 的 Files-API 图片通道是 beta 门控的，缺 `anthropic-beta` header 会直接失败
- `auto` —— 把截图作为图片附件直接塞进会话。适合走支持图片的路由（如 pi-ai provider）

### `authorization` 说明

- `per-app` —— 按应用授权，第一次操作某个应用会问
- `allow-all` —— 全部放行（**只在你完全信任当前会话时用**）

---

## 应用笔记 app_skill

模型操作某个应用时踩的坑、记下的路径，可以按应用存下来，下次直接复用，不用重新摸索一遍界面。

```json
{ "action": "append", "app": "Chrome", "content": "地址栏坐标约 (700, 90)；Ctrl+L 更快" }
```

```json
{ "action": "read", "app": "Chrome" }
```

```json
{ "action": "list" }
```

笔记存在 `~/.dsh/computer-use-skills/<应用名>.md`，是纯 Markdown，你可以直接编辑。

---

## 测试

测试脚本会自动探测 DSH 运行时目录（`<dsh>/profiles/node_modules/@deepseek-ai/dsh-tools`）。
探测不到时用环境变量指定：

```powershell
# PowerShell
$env:DSH_ROOT = "$env:USERPROFILE\.dsh\profiles"

# bash / zsh
export DSH_ROOT="$HOME/.dsh/profiles"
```

然后：

```powershell
cd test

node test-apply.mjs        # 验证插件注册了全部工具与提示段落
node test-execute.mjs      # 端到端：通过真实 execute() 驱动工具
node test-client-boot.mjs  # 客户端半能否正常引导
node prove-regression.mjs  # 静默假成功等已知问题的回归验证
node demo.mjs              # 可见的桌面演示（会真的动你的鼠标）
```

或者一条命令跑完：

```powershell
npm test
```

实际输出长这样：

```text
$ node test/test-apply.mjs
tools     : computer, computer_batch, windows, ui_elements, clipboard, app_skill
prompt    : tool:computer
routes    : /dsh-computer-use/state
---
---
OK: 6 tools register cleanly with the real validator
```

```text
$ node test/test-execute.mjs
windows.list: - "微信" handle=134038 pid=18744 964x785 at (3614,380) | ...
computer.cursor_position: cursor at (3921, 1240)
clipboard.read: clipboard (0 chars):
ui_elements: 2 of 2 controls in the foreground window | [0] window "Chrome" ...
computer.screenshot: path=...\shot-1794893566877.jpg 1366x853 screen=1646x1029 image=no
app_skill.list: App skills: - Chrome - FlClash - test
computer.glow: {"shown":true,"text":"DSH 正在操控你的电脑"}
computer.glow.hide: {"shown":false}
---
OK: every tool executed through its real execute() path
```

---

## 目录结构

```
lib/
  index.js               插件宿主半：注册工具、坐标换算、注入通道调度
  client.js              客户端半：光晕、Esc 暂停、右侧栏 UI
helper/
  Program.cs             C# Win32 桥（2300+ 行）：Screenshot / SendInput / UIA / 窗口 / broker
  Win32Bridge.csproj
  bin/Release/net9.0-windows/
                        预编译产物，开箱可用
test/                    插件自测脚本
tools/dsh-internals/     DSH 内部调研脚本（与本插件无关，排查 DSH 本身时用）
start-broker.ps1         提权 broker 启停脚本
cordis.patch.yml         DSH bundle 补丁配置
BROKER-README.md         broker 细节与自检方法
SECURITY.md              安全模型与威胁边界
CHANGELOG.md             更新日志
CONTRIBUTING.md          贡献指南
RELEASING.md             发布流程
```

---

## 安全说明

**这个插件会真实操作你的键鼠。** 使用前请读完 [SECURITY.md](SECURITY.md)，要点：

- broker 拥有**管理员权限**且能注入输入，因此**所有请求都必须携带令牌**（`helper/bin/Release/net9.0-windows/broker.token`，首次运行自动生成）
- broker **只监听回环地址**，不接受外部连接
- 不要让不可信的模型或提示词驱动它处理敏感操作（网银、密码、支付）
- 用 `forbiddenApps` 把密码管理器、即时通讯、银行客户端拉黑
- **截图会进入会话上下文**。敏感桌面上不要开 `autoScreenshot`
- 提供 `Esc` 暂停机制

### 威胁模型摘要

| 场景 | 风险 | 缓解 |
|---|---|---|
| 模型被恶意提示词注入，去操作网银/支付 | 资金损失 | 不做密码/支付类操作是**使用者**的责任；建议独立账号或虚拟机 |
| 本机其他程序连 broker 发指令 | 被以管理员权限控制键鼠 | **强制令牌鉴权** + 只监听回环 |
| broker 令牌文件被其他用户读到 | 同上 | 令牌在用户目录，依赖 NTFS 每用户 ACL |
| 插件被诱导操作敏感应用 | 数据泄露 | `forbiddenApps` + `Esc` 暂停 |
| 截图泄漏屏幕内容 | 隐私 | 截图进入会话上下文，敏感屏幕不要开 |

### 报告漏洞

请通过 GitHub Security Advisory 私下报告，不要开公开 issue。

---

## FAQ

**Q：会不会和现有输入法冲突？**
`type` 走 `KEYEVENTF_UNICODE`，绕过输入法直接送字符，不经过候选词。中文和 emoji 都没问题。

**Q：多显示器支持吗？**
`diagnose` 会返回 `virtualScreen`（`GetSystemMetrics(76..79)`）。截图只抓主屏，跨屏操作需要自己算偏移。

**Q：能和远程桌面一起用吗？**
能，但远程会话里合成输入更容易被丢。先跑 `diagnose` 确认 `canInjectInput`。

**Q：为什么每次调用都起一个新进程？**
行为特征干净、不留常驻句柄、被 AV 误杀的概率低。代价是每次几十毫秒的启动开销，用 `computer_batch` 可以摊薄。

**Q：能在 macOS / Linux 上用吗？**
不能。helper 是纯 Win32 + UI Automation，`package.json` 里 `os` 字段锁了 `win32`。

**Q：和 Anthropic 的 computer use 有什么关系？**
没关系，也没有隶属关系。「computer use」是业界通用术语。

---

## 许可

[MIT](LICENSE)

---

<div align="center">

本项目是社区插件，**与 Anthropic、DeepSeek 官方均无隶属关系**。

如果这个插件帮你省了时间，给个 ⭐ 就行。

</div>
