# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] — 2026-10-10

首个公开版本。相对早期内部版本的主要变化：

### 修复

- **静默假成功（重要）**：`mouse_move`/`click`/`drag` 过去完全不检查 `SetCursorPos`/`mouse_event`
  的返回值，一律返回 `{"success":true}`。在被安全软件拦截的环境里，光标根本没动，插件却报告
  成功，导致上层"以为点了其实没点"。现在每次注入后都回读真实光标位置校验，失败即明确报错。
- **注入层现代化**：改用 `SendInput`，废弃的 `mouse_event`/`keybd_event` 仅作回退。
- **键盘输入不再污染剪贴板**：文本输入改用 `KEYEVENTF_UNICODE` 直输，替换原先
  "写入剪贴板 → Ctrl+V → 还原剪贴板" 的做法。
- **高 DPI 下点击偏移**：修掉 `click_element` 里的坐标换算错误。UIA 返回物理像素、
  鼠标 API 使用逻辑像素，两者在高缩放屏幕上相差可达 1.75 倍，过去会点偏到别的窗口。
- **坐标探针假阳性**：`MoveCursorVerified` 过去在"目标点恰好等于当前位置"时误判成功，
  导致绕过提权通道。现在要求光标位置确实发生变化才算成功。
- 助手在收到空输入时不再抛出难以理解的 JSON 解析错误，改为明确提示。

### 新增

- **提权 broker 通道**：部分加固环境只允许管理员启动的进程注入合成输入。新增常驻
  broker（`start-broker.ps1`），以管理员身份运行并通过回环 TCP 接收输入类动作；
  broker 不在线时自动回退到本地注入并如实报错。读取类动作（截图/UIA/窗口）无需 broker。
- **`computer { type: "diagnose" }`**：一次性实测并报告注入能力、broker 状态、屏幕/DPI/桌面信息，
  让模型在"点了没反应"时能自我诊断，而不是盲目重试。
- **`cursor_info` / `probe_point` / `move_check`** 等诊断动作，便于排查坐标与命中问题。
- **令牌鉴权**：broker 的每个请求都必须携带令牌（首次运行自动生成，存放于 exe 同级
  `broker.token`），拒绝未授权连接。
- **UI Automation 兜底**：注入被拦时尝试用 UIA 的 Invoke/Select/Toggle 模式直接激活控件，
  再退到 MSAA 的默认动作。

### 变更

- 包名由 `@anthropic/dsh-computer-use` 改为 `dsh-computer-use`（原先的 scope 易被误解为
  Anthropic 官方包，本项目与其无隶属关系）。
- 仓库结构整理：调试与调研脚本移入 `tools/dsh-internals/`，插件自测移入 `test/`。
- README / SECURITY / LICENSE / CHANGELOG / CONTRIBUTING 补全。
