---
name: godot-physics
description: "配置 Godot 2D/3D 物理：body、area、shape、碰撞层、raycast、连续检测和固定步长调优。处理碰撞或触发器时使用。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-physics
verified: 2026-08-24
---

# Godot 物理

- `StaticBody` 用于静态世界，`CharacterBody` 用于代码驱动角色，`RigidBody` 由物理引擎驱动，`Area` 用于检测与场域。
- 每个 CollisionObject 都要有 shape；用 layer 表示“我是谁”，mask 表示“我检测谁”。先写碰撞矩阵再设位。
- 物理查询和移动放固定 tick；用 delta 处理力/加速度，不重复缩放引擎已经按秒定义的量。
- 高速小物体考虑 CCD；大量 overlap/raycast 先测量再优化，避免每帧全树查询。
- 运行时移动刚体不要直接瞬移 transform，除非是重置/传送并明确清理速度。

使用 `resource_manage(op="physics_shape_autofit")` 或明确尺寸创建 shape，再用节点/资源工具赋值。通过 `game_manage` 输入触发碰撞，回读状态和日志；对 layer/mask 至少验证一次应碰撞和一次不应碰撞路径。
