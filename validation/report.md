# dsh-godot-ai 多游戏可行性报告

> 状态：完成（2026-08-24）。结论：**GO，适合继续开发并发布 0.4.1 受控 beta**；暂不宣称“完全无人值守、所有环境零恢复”。

## 环境与版本

- dsh-godot-ai `0.4.1`；DeepSeek Harness `0.1.0-rc.5`，HEAD `47f943859bef60e4160492346772ded9b24f765a`。
- Godot AI backend/addon `3.1.5`，Godot `4.6-stable`，45 个工具，tool catalog hash `af75d04a00d4be87421db50c6f51ba709375286178ea02482ef2776acace1470`，无排除域。
- `godot-creator` 新会话实际发现 16 个 `godot-*` skills，全部 `modelInvocable=true`；Flash/Pro 均可路由。
- 目标项目固定为 `godot-test-project`；现有 `run/main_scene="res://main.tscn"` 与 Breakout 保持不变，新内容只进入 `validation_games/`。
- DSH dirty 状态文本 SHA-256 在前后均为 `52ee6b5816a0e82f5f41994e51e8b6488d89e5c10934aea8ce2d65139515de06`，本任务未修改 DSH 源码。

## 游戏结果

| 原型 | 模型 / session | 玩法验收 | 视觉与日志 | 结果 |
| --- | --- | --- | --- | --- |
| Neon Dash | Flash / `session-4a0c8123-d389-432b-8574-d239b2dad001` | 移动、跳跃、hazard/掉落死亡、重生、restart、goal 胜利 | 480×640 截图像素/位置验证；editor/game logs 干净 | PASS |
| Signal Circuit | Pro / `session-931e08b6-f0f9-43dc-bcca-d348da27bf8c` | 错序重置、正确序列、焦点导航、键盘/鼠标 restart、音频 playing | modlens 确认三按钮、胜利面板与最终间距无溢出；logs 干净 | PASS |
| Orbit Collector | Flash build + Pro review / `session-53558303-1082-4b42-a0cc-56d01b321001`、`session-0744a15a-f06c-4005-a65f-0ad65627c613` | 3 球收集、锁门、解锁材质/HUD、出口胜利、输入释放 | 全景/门/玩家视觉；Pro 修复 HUD 裁切和 warning；fps 145、physics 0.05ms | PASS |

四次真实会话共采集 215,216 个 DSH 事件；压缩为 502 个关键事件与约 2.6 MB 可追溯 JSON，避免保存逐 token chunk。

## 能力覆盖矩阵

| 能力域 | 证据 |
| --- | --- |
| Session / editor / scope | 每局预检唯一 editor、路径、addon/backend 版本；16 skills 与 45-tool hash 实测 |
| 2D / physics / input | CharacterBody2D、Area2D、InputMap、Camera2D、帧级移动/死亡/胜利 |
| UI / Theme / Resource / signals | Container、Theme/StyleBox、自定义 Resource、动态信号、焦点、Tween、程序音频 |
| 3D / material / environment | CharacterBody3D、Mesh/Collision、Camera3D、WorldEnvironment、灯光、共享材质状态 |
| Runtime / recovery | `game_status`、scene tree、UI/state read-back、logs、monitors、break/物理冻结恢复 |
| Visual | game/viewport screenshot；direct vision 不可用时切换 modlens，最终再降级为像素/结构证据 |
| PTC | 分阶段发现/搭建/配置/运行/验证；独立 Pro review 只做证据明确的最小修复 |

## 缺陷与修复

共登记 22 项（11×P1、11×P2，0×P0），分属 validation harness、persona/skill、PTC、Godot AI 3.1.5、项目实现、模型与环境。

- 插件 0.4.1 已修：PTC 单一子树且通常 ≤20 个副作用命令、batch rollback 全批重放、action/InputEvent 区分、Camera2D `enabled`、Control anchor/offset/autowrap、视觉分层 fallback、eval break 恢复、物理 tick 前置检查、证据压缩。
- 项目已修：Neon Dash 掉落死亡/restart/相机 zoom；Signal Circuit 运行时布局与面板间距；Orbit Collector Status 裁切与未使用参数 warning。
- 上游已适配但仍需跟进：`filesystem_manage` 路径过滤、Control fields 定点回读、`game_eval` 错误文本/break、`monitors_get` 过滤、无实体手柄时 A 键注入偶发丢失。
- 完整复现、处置与回归见 `validation/issues.md`。

## 恢复与稳定性

- Polygon 类型错误触发原子 batch 回滚；Agent 回读发现首两项也被撤销并完整重放。
- 单工具失败曾留下重复碰撞节点；Agent 通过 hierarchy 清理副作用后从最后验证点继续。
- 无效 eval 让 helper 进入 break；两模型均能 stop/re-run 后恢复，不误报成功。
- macOS 窗口遮挡可冻结 physics tick，即使 `has_focus=true`；加入 tick 增长检查后能识别环境假失败。
- Flash 创建、Pro 独立审查能接力；Pro 未重写游戏，只修复 1 个 P1 UI 与 1 个 P2 warning。

## 可行性结论

**GO。** dsh-godot-ai 已证明不修改 DSH 源码、不自动安装 addon 的前提下，可以让 DeepSeek Flash/Pro 通过真实 Godot AI 3.1.5 工具创建并验证互补的 2D、UI 和 3D 可玩垂直切片。完整 skills 不是装饰性注入：模型按领域加载并实际影响了批次、输入、UI、视觉和恢复行为。

边界结论：适合“用户在 Godot 编辑器旁监督、Agent 自动执行并提供证据”的受控 beta；暂不把 macOS 后台物理、视觉桥可用性、gamepad 注入与 eval 诊断描述为全环境可靠。

## 发布建议

1. 发布/提交 0.4.1：包含 persona/skill 恢复规则、验证 runner 压缩与版本一致性更新。
2. 继续精确 pin `godot-ai==3.1.5`；新上游版本先跑本 campaign，再更新 compatibility 与 tool hash。
3. 保持 addon 手动安装/启用提醒与快速更新状态卡，不自动写 Godot 项目。
4. 向 Godot AI 上游提交 `filesystem_manage`、Control fields、eval error/break、monitors filter 和 gamepad 注入复现。
5. npm tarball 只发布正式 `assets/lib/skills/templates/workflows/docs`；本次 dry-run 已确认不含 `validation/`、测试项目或证据。

## 发布级回归

- `pnpm check`：PASS
- `pnpm test`：34 passed，1 live-only skipped
- `pnpm build`：PASS
- `pnpm pack --dry-run`：PASS，`dsh-godot-ai-0.4.1.tgz`
- `pnpm test:live`：1 passed，真实 45-tool catalog
- 运行中 dsh-web：wrapper 0.4.1、backend/addon 3.1.5、editor connected、play state stopped
