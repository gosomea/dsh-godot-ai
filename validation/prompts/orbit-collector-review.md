你是 Orbit Collector 的第二模型审查者。目标项目必须是 `/Users/yuqixian/forever-skills/projects/godot-test-project`。只允许读取和最小修改 `res://validation_games/orbit_collector/`，不得重写整个游戏或修改其他内容。

先加载 `godot-ai-orchestration`、`godot-3d-essentials`、`godot-physics`、`godot-ui-control` 和 `godot-gdscript`。先只读审查场景、脚本、输入、材质/环境、相机、logs 和运行状态，列出按严重度排序的问题。只有证据明确的 P0/P1/P2 问题才做最小修复，每批修复后回读并重跑。

重点检查：错误 session/路径、重复节点、缺失 owner/资源、GDScript diagnostics、碰撞 layer/mask、Camera3D current、共享材质误改、输入未释放、collectibles 计数和 queue_free 时序、出口门控、HUD、game_status、editor/game errors、视觉可读性和性能 monitors。最终给出通过/不通过、修复清单、证据和仍存在的 dsh-godot-ai 缺陷。
