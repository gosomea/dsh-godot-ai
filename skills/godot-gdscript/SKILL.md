---
name: godot-gdscript
description: "编写与修复 Godot 4.7 GDScript：静态类型、生命周期、注解、await、脚本诊断和 3.x 迁移。编辑 .gd 文件时使用。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-gdscript
verified: 2026-08-24
---

# Godot 4 GDScript

## 规则

- 优先静态类型；明确公开 API 的参数与返回类型，局部值可用 `:=` 推断。
- `_init()` 阶段子节点尚不可用；节点引用放在 `@onready` 或 `_ready()`。
- 物理移动、碰撞和 `move_and_slide()` 放在 `_physics_process(delta)`；表现更新放 `_process(delta)`。
- 使用 Godot 4 注解：`@export`、`@onready`、`@tool`、`@rpc`；迁移时把 `yield` 改为 `await`。
- 不组合 `@export` 与 `@onready`。`class_name` 必须项目内唯一。
- 事件优先 signal/await，持续状态才轮询。整数除法会截断，需要小数时显式使用 float。

## 实施流程

1. 用 `script_manage(op="read")` 或 `filesystem_manage(op="read_text")` 读取当前脚本和相邻依赖。
2. 小范围修改用 `script_patch` 的稳定 anchor；新文件用 `script_create`，再用 `script_attach` 绑定。
3. 每次写入都检查响应 `diagnostics`，然后回读目标片段。
4. 完成关联文件后 `filesystem_manage(op="scan")`，运行场景并检查 editor/game logs。

不要用 `filesystem_manage(op="reimport")` 证明 `.gd` 可解析；它不是 GDScript 解析验证。
