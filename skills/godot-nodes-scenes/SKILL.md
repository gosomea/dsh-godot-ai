---
name: godot-nodes-scenes
description: "设计和编辑 Godot 场景树：节点组合、PackedScene、实例化、autoload、生命周期与场景所有权。搭场景或重构层级时使用。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-nodes-scenes
verified: 2026-08-24
---

# Godot 节点与场景

## 设计原则

- 场景是可复用组件，不只是关卡文件。根节点类型表达场景契约。
- 组合优先于深继承：行为、碰撞、视觉、音频和 UI 按职责拆成子节点或子场景。
- 父节点调用子节点，子节点用 signal 向上通知；跨树广播要谨慎使用 autoload。
- 运行时频繁复用的对象保存为 `PackedScene`；数据保存为 `Resource`，不要把数据模型藏在节点树里。
- 明确 owner/可编辑子节点和资源路径，避免保存后子节点消失、重复命名或悬空 NodePath。

## 编辑流程

1. `scene_get_hierarchy` 读取目标分支，`node_get_properties` 读取关键节点。
2. 用 `node_find` 确认名称和类型不存在冲突，再创建、移动、重挂载或删除。
3. 紧密相关的节点操作可放入 `batch_execute`；保存后重新读取层级。
4. 涉及场景切换、pause 或 deferred tree mutation 时运行验证生命周期，不只检查文件。

使用 `scene_open` / `scene_save` 和 `scene_manage` 管理场景；使用 `autoload_manage` 管理单例，不手改未知的项目配置块。
