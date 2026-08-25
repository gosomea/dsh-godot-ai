---
name: godot-3d-essentials
description: "搭建 Godot 3D 场景：Node3D、Camera3D、灯光、WorldEnvironment、CSG/GridMap、材质与坐标约定。制作 3D 原型时使用。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-3d-essentials
verified: 2026-08-24
---

# Godot 3D 基础

- Godot 3D 以米为常用尺度，Y 向上，前向通常为局部 -Z。导入资产先检查尺度、朝向和 origin。
- 一个可玩镜头必须有 current Camera3D；灯光、环境、阴影和曝光共同决定可读性。
- 灰盒先用 CSG/GridMap/基础 Mesh 验证尺度、路线和交互，再替换美术资产。
- 静态关卡、动态角色和 UI 分层；Environment/全局后处理通常由关卡根拥有。
- 材质资源的共享语义要明确，避免为小差异制造大量独立材质和 draw calls。

用 `csg_manage` / `gridmap_manage` 搭灰盒，`camera_manage` 创建和配置相机，`resource_manage(op="environment_create")` 与 `material_manage` 配置环境和材质。运行后用 game/cinematic 截图验证构图、尺度、曝光和遮挡，并回读相机 current 与关键 transform。
