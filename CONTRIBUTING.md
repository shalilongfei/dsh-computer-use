# 贡献指南

先谢过。提 PR 之前花两分钟看完这页，能省掉一轮来回。

## 环境准备

```powershell
git clone https://github.com/shalilongfei/dsh-computer-use.git
cd dsh-computer-use

# 目录联接进 DSH 插件目录，改完立即生效
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-computer-use" `
  -Target (Get-Location)
```

需要：Windows 10/11、Node ≥ 18、.NET 9 SDK（改 C# 时才要）。

## 提交前自查

```powershell
node --check lib/index.js
node --check lib/client.js
node test/test-apply.mjs
node test/test-execute.mjs
```

改了 `helper/Program.cs` 的话，**先停 broker 再编译**：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File start-broker.ps1 -Stop
dotnet build helper/Win32Bridge.csproj -c Release
```

> 不停 broker 的话，exe 被占用，构建会「成功」但产物没更新——这个坑排查起来很费时间。

## 代码约定

### JavaScript

- ESM，不引入构建步骤，`lib/` 下的文件要能被 `node --check` 直接过
- 不新增运行时依赖。这个插件的卖点之一就是零依赖
- 工具描述和参数 description 用中文（模型看到的就是这些文字，中文 token 效率更高）
- 错误信息要具体。`"click failed"` 没用，`"cursor did not move: requested (683,420), actual (0,0) — input injection blocked"` 才有用

### C#

- 单个 `Program.cs`，不拆文件。目的是让 helper 保持一次性进程的极简部署形态
- 所有 P/Invoke 声明集中在文件里已有分区的对应位置，不要散落
- 每个 public 方法加注释说明「为什么需要它」，而不是「它做了什么」
- **注入类操作必须回读校验**。这是本项目的核心约定：宁可报错，不要假装成功

### 提交信息

Conventional Commits 风格：

```
feat: add multi-monitor coordinate translation
fix: cursor verification false positive when target equals current position
docs: clarify broker token rotation
```

## 特别欢迎的贡献

| 方向 | 说明 |
|---|---|
| 多显示器 | 目前截图只抓主屏，跨屏场景需要手动算偏移 |
| 新应用笔记 | 你摸索出的某个软件的操作路径，写成 `app_skill` 笔记分享出来 |
| 拦截环境实测 | 哪种安全软件/远程桌面下注入会失败、broker 能否绕过——实测数据非常有用 |
| 文档翻译 | 英文 README 目前没有 |

## 不接受的改动

- 引入 Electron / Playwright / Puppeteer 之类的重依赖
- 把 helper 改成常驻服务（理由见 README 的架构说明）
- 去掉注入后的光标校验来「提升性能」
- 只改文档格式不动内容的大规模重排

## 报告安全问题

不要开公开 issue，走 [GitHub Security Advisory](../../security/advisories/new)。详见 [SECURITY.md](SECURITY.md)。
