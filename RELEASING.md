# 发布步骤

按顺序执行即可。带 ⚠️ 的地方要先做决定。

> 仓库地址：`https://github.com/shalilongfei/dsh-computer-use`
> 当前版本：`0.3.0`

---

## 0. 发布前自查

提交前跑一遍这几条（都是开发中真实踩过的坑）：

```powershell
# 1) 不该有个人绝对路径
git grep -n -i "Users\\\\" -- . ':!tools/dsh-internals'   # 应为空

# 2) 不该有运行产物
git ls-files | Select-String "broker\.log|broker\.token|helper/obj"

# 3) 预编译产物里不该有构建者路径
Get-ChildItem helper\bin\Release\net9.0-windows -File |
  ForEach-Object { $t = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($_.FullName))
                   if ($t -match 'Users\\|Documents and Settings') { "检查: $($_.Name)" } }

# 4) 没有残留占位符
Select-String -Path package.json,LICENSE,README.md -Pattern '<YOUR|your-name|your-scope'
```

---

## 1. 初始化仓库并提交

```powershell
git init -b main
git add -A
git status --short          # 先看一眼要提交什么
git commit -m "feat: Windows computer-use plugin for DeepSeek Harness

- screenshot / mouse / keyboard / window control / UI Automation / clipboard
- real verification after every injection (no silent fake success)
- elevated broker fallback for hardened machines
- token-authenticated broker, loopback only"
```

---

## 2. 在 GitHub 建仓库

网页方式：<https://github.com/new>

- **Repository name**：`dsh-computer-use`
- **Description**：`Windows computer-use plugin for DeepSeek Harness: screenshot, mouse, keyboard, window control, UI Automation and clipboard`
- **Public** / **Private** 按需
- ⚠️ **不要**勾选 "Add a README / .gitignore / license" —— 本地已经有了，勾了会冲突

命令行方式（需要 [GitHub CLI](https://cli.github.com/) + `gh auth login`）：

```powershell
gh repo create dsh-computer-use --public --source=. --remote=origin --push
```

---

## 3. 推送

```powershell
git remote add origin https://github.com/shalilongfei/dsh-computer-use.git
git push -u origin main
```

---

## 4. 仓库设置（提升观感，几分钟）

在 <https://github.com/shalilongfei/dsh-computer-use/settings>：

- **Topics**（About 右侧齿轮）：`deepseek-harness` `dsh-plugin` `computer-use` `windows` `automation` `ui-automation` `win32` `agent` `screenshot` `rpa`
- **Website**：留空，或填 DSH 主页
- **Features**：Issues ✅；Discussions 可选
- **Social preview**：传一张 1280×640 的图，链接分享时好看很多

### 可选：补一张演示图

README 现在是纯文字 + 架构图。这类项目的实际效果图影响很大，可以录一段 GIF
（截图 → 移动鼠标 → 点击 → 输入）放到 `docs/demo.gif`，然后在 README 开头插入：

```markdown
![demo](docs/demo.gif)
```

---

## 5. 打版本标签 + Release

```powershell
git tag -a v0.3.0 -m "v0.3.0 — first public release"
git push origin v0.3.0
```

然后在 <https://github.com/shalilongfei/dsh-computer-use/releases/new>：

- **Choose a tag**：`v0.3.0`
- **Release title**：`v0.3.0 — 首个公开版本`
- **Describe**：把 `CHANGELOG.md` 里 `[0.3.0]` 那段粘进去
- 点 **Publish release**

---

## 6. 发布后验证（重要）

换一个**干净的临时目录** clone 一份，确认别人拿到就能用：

```powershell
cd $env:TEMP
git clone https://github.com/shalilongfei/dsh-computer-use.git cu-test
cd cu-test

# JS 语法
node --check lib/index.js

# helper 能跑
'{"action":"diagnose"}' | .\helper\bin\Release\net9.0-windows\Win32Bridge.exe

# 从零编译 helper（验证源码完整）
dotnet build helper\Win32Bridge.csproj -c Release
```

`diagnose` 能返回 JSON 就说明预编译产物可用。

---

## 7.（可选）发布到 npm

`package.json` 已备好 `files` 白名单。想让别人 `pnpm add` 安装：

```powershell
npm login
npm publish --access public
```

⚠️ 先确认包名没被占用：<https://www.npmjs.com/package/dsh-computer-use>

---

## 8.（可选）加 CI

`test/` 里需要真实 Windows 桌面和 DSH 运行时，**不适合**放进 GitHub Actions。
可以只跑不需要桌面的检查，新建 `.github/workflows/ci.yml`：

```yaml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '9.0.x'
      - name: JS syntax
        run: |
          node --check lib/index.js
          node --check lib/client.js
      - name: Build helper
        run: dotnet build helper/Win32Bridge.csproj -c Release
```

---

## 已知会卡人的点（提前说清，省得被 issue 追着问）

1. **点了没反应** —— 加固环境会静默拦截合成输入。README 和 SECURITY 都写了排查方式：
   `computer { "type": "diagnose" }`，必要时启动 broker。
2. **改完 C# 编译"成功"但产物没变** —— broker 占着 exe。必须先停：
   `powershell -File start-broker.ps1 -Stop`，再 `dotnet build`。这条也写进了 CONTRIBUTING。
3. **高 DPI 下点偏** —— 三套坐标系（截图 / 指针 / UIA 物理）已在 README 里列表说明。
4. **broker 令牌失配** —— 令牌文件被删或换掉后，运行中的 broker 仍在用旧令牌，
   此时 `start-broker.ps1` 会报鉴权失败。解决：停掉 broker 再重新启动。
