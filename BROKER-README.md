# 提权 broker（DSH computer-use 插件配套）

## 为什么需要它

某些加固环境里，**只有管理员启动的进程才能注入鼠标/键盘**。DSH 以中完整性（非管理员）运行，
它的整个进程树（helper 及其派生的任何子进程）调用 `SetCursorPos` / `SendInput` 都会被
静默拒绝：API 报成功，光标却纹丝不动。

实测对照（同一个 exe）：

| 运行方式 | SetCursorPos 结果 |
|---|---|
| 在 DSH 进程树内（被拦截时） | `ok=False`，光标不动 |
| 管理员启动（本 broker / 计划任务 / `-Verb RunAs`） | `ok=True`，光标真的移动 |

要注意这种拦截**不是恒定的** —— 同一台机器上它可能随安全软件策略变化而出现或消失。
所以插件的策略是：优先本地注入，被拦时自动走 broker；两条都不通才报错。

插件把**输入类动作**（移动/点击/拖拽/滚轮/键盘）按需转发给常驻的提权 broker；
**读取类动作**（截图 / UI 元素 / 窗口 / 剪贴板 / 等待）始终走本地 helper，不受影响。

## 安全

broker 拥有管理员权限且能注入输入，因此**每个请求都必须携带令牌**：

- 令牌在首次运行时生成（64 位随机十六进制），存放于 `helper/bin/Release/net9.0-windows/broker.token`
- 插件与 broker 读同一份文件；缺失或不匹配的请求一律被拒绝
  (`{"success":false,"error":"unauthorized: ..."}`)
- broker 只绑定 `127.0.0.1`，不接受外部连接
- 轮换令牌：停止 broker → 删除 `broker.token` → 重新启动

细节与威胁边界见 [SECURITY.md](SECURITY.md)。

## 用法

```powershell
# 启动（会请求一次管理员权限；本机 UAC 已设为管理员静默提权，通常不弹框）
powershell -NoProfile -ExecutionPolicy Bypass -File start-broker.ps1

# 查看状态
powershell -NoProfile -ExecutionPolicy Bypass -File start-broker.ps1   # 已运行会直接回报

# 停止
powershell -NoProfile -ExecutionPolicy Bypass -File start-broker.ps1 -Stop
```

broker 监听 `127.0.0.1:45919`（可用环境变量 `DSH_COMPUTER_USE_BROKER_PORT` 改端口），
日志写在 `broker.log`。它只接受本机回环连接，命令格式是一行 JSON。

## 自检

```powershell
# 令牌（首次运行后生成）
$token = (Get-Content 'helper\bin\Release\net9.0-windows\broker.token' -Raw).Trim()

# broker 是否在线、是否真的能注入
$c = [System.Net.Sockets.TcpClient]::new(); $c.Connect('127.0.0.1', 45919)
$s = $c.GetStream(); $w = [System.IO.StreamWriter]::new($s); $r = [System.IO.StreamReader]::new($s)
$w.AutoFlush = $true
$w.WriteLine('{"action":"ping","token":"' + $token + '"}'); $r.ReadLine(); $c.Close()
# => {"success":true,"data":{"role":"broker","processId":...,"canInjectInput":true}}

# 不带令牌应当被拒绝
# => {"success":false,"error":"unauthorized: missing or invalid broker token"}
```

插件侧用 `computer { "type": "diagnose" }` 可以看到 broker 在线状态 + helper 的注入能力。

## 坐标空间（重要）

- **截图坐标**（模型看到的 1366×853）→ 指针坐标：乘 `1646/1366 ≈ 1.2049`
- **UIA 元素坐标**（物理像素，2880×1800）→ 指针坐标：乘 `1646/2880 ≈ 0.5715`
  （broker 内部按自己上报的 `GetSystemMetrics(0/1)` 与 `GetDeviceCaps(DESKTOPHORZRES/VERTRES)`
  自动换算，所以把 UIA 原始坐标交给 broker 即可）
- `click_element` 走 helper 的 UIA → broker 点击通道，落点会用像素颜色复核。

## 已知限制

- broker 未启动时，输入类动作会明确报错（不会假装成功），读取类动作照常可用。
- broker 以管理员身份运行，因此它的注入能到达普通窗口；但**无法**操作以更高权限
  运行的程序里被 UIPI 保护的窗口（正常使用遇不到）。
