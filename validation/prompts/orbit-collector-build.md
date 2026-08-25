你正在执行 dsh-godot-ai 多游戏可行性验证的 Game C 构建阶段。目标项目必须是 `/Users/yuqixian/forever-skills/projects/godot-test-project`，只写 `res://validation_games/orbit_collector/`；不得改 main scene、Breakout、addon 或其他游戏。

先加载 `godot-ai-orchestration`、`godot-3d-essentials`、`godot-physics`、`godot-shaders`、`godot-resources`、`godot-ui-control`、`godot-signals-groups` 和 `godot-gdscript`。

创建 Orbit Collector：一个小型 3D 灰盒场地，玩家用键盘移动，收集 3 个明显的能量球后出口解锁并可获胜。必须有 CharacterBody3D、地面与边界碰撞、Camera3D、DirectionalLight3D、WorldEnvironment、CSG 或基础 Mesh、不同材质、Area3D collectibles/exit 和 HUD。入口 `res://validation_games/orbit_collector/orbit_collector.tscn`。

全部通过 Godot AI 的分批读改验完成。脚本检查 diagnostics；运行目标 scene、读 logs、用 frame-timed actions 和运行时节点状态证明收集计数/消失/出口门控；检查相机 current 与 performance monitors；用 game 或 cinematic screenshot/vision 验证角色、场地、三个球、出口和 HUD。遇到不能证明的项必须记录，禁止用工作区脚本批量生成整个游戏。
