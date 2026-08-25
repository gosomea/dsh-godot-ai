你正在执行 dsh-godot-ai 多游戏可行性验证的 Game A。请自主完成，不等待普通偏好确认；如果遇到安全边界或目标项目不匹配则停止。

硬边界：

- 目标项目必须是 `/Users/yuqixian/forever-skills/projects/godot-test-project`，目标目录只能是 `res://validation_games/neon_dash/`。
- 保留现有 Breakout、`main.tscn`、现有 scripts/assets 和 addon；不得更改项目 main scene，不得写目标目录以外的文件或节点资源。
- 先加载 `godot-ai-orchestration`、`godot-2d-movement`、`godot-physics`、`godot-ui-control`、`godot-animation`、`godot-signals-groups`。只加载这些相关技能，不加载整个目录。
- 游戏实现与验证必须尽量使用当前 PTC SDK 中的 `mcp__godot-ai__*`；每批写入后独立回读。脚本写入必须检查 diagnostics。

创建一款名为 Neon Dash 的单屏 2D 平台挑战：玩家可左右移动和跳跃，越过一个 hazard 到达 goal；触碰 hazard 或掉出场景会重生并增加 deaths；到达 goal 显示胜利；支持 restart。用清晰的霓虹几何占位画面，不依赖外部下载素材。

最低覆盖：CharacterBody2D、StaticBody2D/CollisionShape2D、Area2D hazard 和 goal、InputMap actions、Camera2D、CanvasLayer HUD、signal、一个 Tween/Animation 反馈。入口为 `res://validation_games/neon_dash/neon_dash.tscn`。

验证要求：

1. 先确认 editor session/project/readiness，并处理当前正在运行的旧游戏。
2. 完成设计后按“搭建、脚本、配置、运行、验证”分批执行，避免巨大 PTC。
3. 保存并只运行 Neon Dash 场景，确认 `game_status=live`。
4. 读取 editor/game logs；修复最早根因直至没有本游戏新增 error。
5. 使用 frame-timed input 验证移动和跳跃；用运行时状态验证 death/restart/goal 中至少两条路径，其余若无法稳定自动触发要如实说明。
6. 使用 game screenshot/vision 验证玩家、平台、hazard、goal 和 HUD 均可见。
7. 最终只报告：加载的 skills、创建文件、关键工具批次、read-back/diagnostics/log/runtime/visual 证据、遇到的 dsh-godot-ai 问题、仍未验证事项。不要声称没有证据的成功。
