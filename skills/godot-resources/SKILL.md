---
name: godot-resources
description: "用 Godot Resource、.tres 与 ResourceLoader/Saver 做数据驱动设计，管理共享/独立资源、UID 和序列化边界。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-resources
verified: 2026-08-24
---

# Godot Resources

- Resource 保存数据和可复用配置，Node 保存运行时行为与树关系。物品、技能、敌人配置和曲线优先自定义 Resource。
- typed `@export` 字段构成编辑器数据契约；不要把 live Node、Callable 或场景瞬态状态直接持久化。
- 明确资源是共享还是每实例唯一。修改共享 `.tres` 会影响所有引用者；需要独立状态时 duplicate 并确认 subresources。
- 保留 `res://` 路径、UID 与 ext_resource/sub_resource 引用完整性，不手工猜 UID。
- 存档只保存可重建的纯数据和 schema version，运行时从资源模板恢复对象。

用 `resource_manage(op="search|get_info|load|create|assign")` 发现和操作资源；曲线、环境、碰撞形状、渐变和噪声使用对应专用 op。赋值后回读节点属性与资源信息，再保存/运行验证引用能够加载。
