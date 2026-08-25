---
name: godot-animation
description: "创建 Godot AnimationPlayer、AnimationTree 与 Tween：轨道、状态机、混合、过渡和程序动画。制作角色或 UI 动画时使用。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-animation
verified: 2026-08-24
---

# 动画

- 固定、可编辑的时间线使用 `AnimationPlayer`；状态与混合使用 `AnimationTree`；一次性程序过渡使用 Tween。
- 动画轨道使用稳定 NodePath，重命名或重挂载后调用 validate，防止轨道静默失效。
- 游戏规则不依赖纯视觉帧；关键命中/结束事件用 method track、signal 或显式状态同步。
- Tween 由节点创建并持有适当生命周期；重复触发前 kill/replace 旧 tween，避免属性争用。
- 角色移动和动画参数解耦：控制器提供速度/状态，动画层消费它们。

用 `animation_create` 和 `animation_manage` 创建 player、clip、property/method tracks、autoplay 和预设效果。修改后 `validate`、`list/get` 回读，并在运行中 `play`；截图或运行时属性证明起止状态和过渡正确。
