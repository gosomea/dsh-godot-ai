---
name: godot-multiplayer
description: "设计 Godot 高层多人游戏：authority、RPC、MultiplayerSpawner/Synchronizer、状态复制、延迟与安全边界。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-multiplayer
verified: 2026-08-24
---

# Godot Multiplayer

- 先定义 authoritative peer。客户端发送意图，权威端验证并修改状态；不要信任客户端传来的伤害、位置或物品结果。
- RPC 显式声明 mode、transfer mode、channel 和 call_local；可靠通道用于关键离散事件，不可靠有序通道用于高频状态。
- `MultiplayerSpawner` 管出生/销毁，`MultiplayerSynchronizer` 管可复制属性；NodePath 和场景结构必须在各 peer 一致。
- 输入、本地预测、服务器校正和插值分层，先让两端确定性状态正确，再优化手感。
- 单编辑器成功不代表联网正确；至少覆盖 host、client、断线、重连和权限拒绝。

`godot-ai` 可用于构建场景、脚本和单实例运行验证，但多进程/多 peer 拓扑可能需要项目现有测试或外部进程。明确哪些路径已在编辑器验证，哪些仍需真实网络测试；不要把单 session 结果冒充多人验收。
