---
name: godot-2d-movement
description: "实现 Godot 4.7 的 CharacterBody2D 移动：速度、重力、跳跃、斜坡、coyote time 与输入反馈。制作 2D 玩家控制时使用。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-2d-movement
verified: 2026-08-24
---

# 2D 移动

- 使用 `CharacterBody2D.velocity` 与 `_physics_process`，每物理帧只调用一次 `move_and_slide()`。
- 输入来自 InputMap action，不硬编码设备键。用 `Input.get_axis` 获取水平轴，并为手柄保留 deadzone。
- 地面状态基于 `is_on_floor()`；重力只在离地时累计。跳跃、coyote time、jump buffer 和可变跳高分别建模，不混成一个计时器。
- 像素风项目考虑整数缩放、相机平滑与物理位置/渲染位置分离，避免抖动。
- 手感参数用 typed `@export` 暴露：速度、加速度、减速度、跳跃速度和容错窗口。

先用 `input_map_manage` 确保 action 与 bindings 幂等存在，再创建/修改脚本。运行后用 `game_manage(op="input_sequence")` 进行按帧移动和跳跃，回读玩家位置、速度和落地状态；被自动化测试覆盖的 restart / interact 等边缘动作不要只依赖 `_unhandled_input(event)` 或同帧 `is_action_just_pressed`，因为 action 状态注入不等价于 InputEvent，优先轮询 pressed 状态并自行做上一帧边缘检测。Camera2D 在 Godot 4 使用 `enabled`，不猜测旧版 `current` 属性；最后截图检查运动、完整关卡边界与相机 zoom。
