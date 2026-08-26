# dsh-godot-ai 插件能力验证

这份验证只回答一个问题：`dsh-godot-ai` 自己提供的能力是否真的被 DSH 使用。
它不把“游戏最后做得好不好”混进插件能力结论；游戏创建矩阵属于另一个产品级回归层。

## 验证对象

- Host：集成状态、Godot AI 版本、编辑器连接、更新探测和两个 managed preset 路由。
- Agent：`godot-creator` 稳定模式、`godot-creator-adaptive` 独立模式、16 个 Godot Skills 和 Godot MCP 工具注入。
- Adaptive：手动 `build`、`auto` 关键词分类、只读 bootstrap、`run_code`、promotion 到 `full`、第二条消息实际使用完整工具面、首条消息后的选择锁定。
- 安全与兼容：bootstrap 只允许 `session_manage(list)` / `editor_state`，不产生写工具或空工具名；Classic 不产生 Adaptive 路由事件。

## 执行方式

在 DSH Web 和 Godot 编辑器已启动的环境中：

```bash
pnpm test:capability:static
pnpm test:capability:live
# 或一条命令执行两层
pnpm test:capability
```

live 脚本只发送一次只读请求，不创建、修改、运行或保存 Godot 项目。它保存精简事件摘要到 `validation/plugin-capability-report.json`，不会把整份 session history 当作成功证据。

## 最近一次结果（2026-08-26）

环境：DSH 官方 rc8（commit `141eb6fef83422698aef7a981029e843e8161534`）、dsh-godot-ai `0.5.0-rc.1`、Godot AI `3.1.5`、Godot `4.6`、DeepSeek Flash。

| 检查 | 结果 | 直接证据 |
| --- | --- | --- |
| Host 集成与更新探测 | PASS | backend ready、editor connected、addon 3.1.5、update probe 有结果 |
| Classic 对照 | PASS | `godot-creator`、16 个 Skills、`mcp__godot-ai__*`；无 Adaptive 路由 |
| Adaptive 手动 build | PASS | `manual build → bootstrap → full`、`run_code`、两个只读 bootstrap binding、第二轮 `scene_get_hierarchy` |
| Adaptive auto | PASS | `classifier clear-build-intent → bootstrap → full`，第二轮实际使用 Adaptive 工具 |
| 安全/生命周期 | PASS | 无写工具、无空工具名、正常 `turn/end`、首条消息后拒绝更改选择 |

这次能力门是 `host + classic + adaptive/manual + adaptive/auto` 全部通过，才允许进入游戏矩阵的发布决策。它证明插件的注入、路由和边界工作；不证明模型在复杂游戏任务上的成功率、视觉质量或效率。

正式游戏 runner 也会把同一组归因字段写入每个 run：新的报告必须包含实际 preset、16 个可调用 Skills、对应 MCP namespace、Adaptive 生命周期和首轮只读 bootstrap；旧报告会标记为 `legacyEvidence`，不能冒充新候选的插件证据。

## 与游戏矩阵的关系

游戏矩阵仍然有价值：它验证真实 Godot 项目能否被交付、运行和回读。但它只能作为产品级端到端回归，不能单独回答“这个结果是不是插件带来的”。发布顺序固定为：

```text
插件能力门通过
    ↓
有限游戏回归 / Classic 对照
    ↓
安全、真实性、效率与成功率发布判断
```
