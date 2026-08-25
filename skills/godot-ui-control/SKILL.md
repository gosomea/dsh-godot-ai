---
name: godot-ui-control
description: "构建 Godot Control UI：anchors、containers、themes、焦点导航、响应式 HUD/菜单与可访问性。制作界面时使用。"
upstream: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/godot/godot-ui-control
verified: 2026-08-24
---

# Godot UI / Control

- 结构布局优先 Container，anchors 表达相对父级的伸缩关系；不要同时用脚本和 Container 争夺尺寸/位置。
- HUD 通常放在 `CanvasLayer`；世界空间 UI 与屏幕 UI 分开。
- 样式集中在 Theme，局部 override 只用于例外；同一语义控件复用 type variation。
- 为键盘和手柄设置 focus neighbor、初始 focus 和返回路径；按钮触控目标留足尺寸。
- 文字要适应翻译、字体 fallback、长文本和窗口缩放；不要用硬编码空格对齐。
- full-rect 根 Control 使用零 offsets；`set_anchor_preset` 可能重置 offsets，先设 preset、再设边距并回读实际 anchors/offsets。长文 Label 开启 autowrap，否则最小尺寸会把 VBox/HBox 撑出视口。

先读 UI 树和当前 Theme。用 `ui_manage(op="build_layout")`、anchor/text 操作搭结构，用 `theme_manage` 创建和应用主题；anchor preset 不要与大量普通 set_property 混在同一批后仅凭 transient 返回值判断成功。运行后用 `game_manage(op="get_ui_elements")` 回读真实尺寸、可见性、文本和 focus。Control 的焦点/激活依赖 InputEvent，使用 `input_key` / `input_gamepad`；`input_action` 只设置 action 状态。手柄按下与释放之间保留游戏帧，再截图验证多分辨率布局。
