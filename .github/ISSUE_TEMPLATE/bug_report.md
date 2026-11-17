---
name: Bug report
about: 报告一个可复现的问题
title: '[bug] '
labels: bug
---

## 环境

```
Windows 版本:            （winver 里的完整版本号）
DSH 版本:
插件版本:                （package.json 里的 version）
屏幕分辨率:
缩放比例:                （例如 175%）
是否以管理员运行 DSH:    是 / 否
是否启动 broker:         是 / 否
```

## `diagnose` 输出

请先跑这一条，把返回的 JSON 贴上来。敏感信息可以打码，但
`canInjectInput` / `broker.online` / `screen` / `pointer` 这几个字段请保留：

```json
{ "type": "diagnose" }
```

```json
（贴这里）
```

## 复现步骤

1.
2.
3.

## 期望行为

## 实际行为

## 补充信息

- 是否装了安全软件 / 虚拟化 / 远程桌面：
- 出问题的动作是输入类（鼠标键盘）还是读取类（截图 / UIA / 窗口）：
- 相关日志（`broker.log` 等）：
