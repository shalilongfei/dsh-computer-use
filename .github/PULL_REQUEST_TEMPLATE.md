## Pull Request

### 这个 PR 做什么

（一句话说清，不要写"优化了一些东西"）

关联 issue：#

### 改动类型

- [ ] 新功能
- [ ] 修 bug
- [ ] 文档
- [ ] 重构（不改行为）
- [ ] 其他

### 自查

- [ ] `node --check lib/index.js` / `lib/client.js` 通过
- [ ] `node test/test-apply.mjs` 通过
- [ ] `node test/test-execute.mjs` 通过
- [ ] 改了 `helper/Program.cs` 的，已停 broker 后重新编译并确认产物更新
- [ ] 涉及输入注入的改动，保留了注入后的光标回读校验
- [ ] 没有引入新的运行时依赖
- [ ] 没有提交 `broker.token` / `broker.log` / `helper/obj/`

### 测试说明

（怎么验证的？如果只能在特定环境复现，说清环境）
