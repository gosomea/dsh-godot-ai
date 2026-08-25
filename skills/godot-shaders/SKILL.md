---
name: godot-shaders
description: "编写 Godot canvas_item/spatial shader，配置 uniforms、材质、UV、光照与常见视觉效果，并做截图和性能验证。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-shaders
verified: 2026-08-24
---

# Godot Shaders

- 2D 使用 `canvas_item`，3D 使用 `spatial`；先定义视觉目标和渲染阶段，再选 shader_type/render_mode。
- uniforms 是美术调参接口：命名清晰、给合理默认值和范围，避免把常量散落在代码中。
- 先用 UV、COLOR/NORMAL 和少量采样实现最小效果，再增加噪声、屏幕纹理或多 pass。
- 注意透明、深度、背面剔除和 blend mode 对排序/性能的影响；移动端限制采样、分支和 overdraw。
- ShaderMaterial 可共享；需要每实例独立参数时明确复制资源或使用 instance uniform，避免改一个影响全部。

用 `material_manage` 创建 ShaderMaterial、设置 shader 参数、赋给节点并回读。需要纹理/噪声/渐变时用 `resource_manage` 创建。用 viewport/game/cinematic 截图比较目标区域，并读取 monitors；视觉变化和性能预算都要有证据。
