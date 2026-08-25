你正在执行 dsh-godot-ai 多游戏可行性验证的 Game B。请自主完成；安全边界或项目不匹配时停止。

硬边界：目标项目必须是 `/Users/yuqixian/forever-skills/projects/godot-test-project`，只写 `res://validation_games/signal_circuit/`。不得更改现有 Breakout、main scene、addon 或其他 validation game。

先加载 `godot-ai-orchestration`、`godot-ui-control`、`godot-signals-groups`、`godot-resources`、`godot-animation`、`godot-audio` 和 `godot-gdscript`。

创建 Signal Circuit：三个可聚焦电路节点按钮，玩家必须按给定顺序激活。正确输入提供颜色/Tween/音效反馈，错误顺序显示提示并重置；完成后显示胜利和 Restart。支持鼠标与键盘/手柄 focus。使用 Theme 和一个自定义 Resource 保存关卡序列，不下载外部素材。入口 `res://validation_games/signal_circuit/signal_circuit.tscn`。

必须通过 Godot AI 分批创建、回读、检查 diagnostics、运行、读 editor/game logs；用 `get_ui_elements` 与输入 action 验证 focus、错误重置、胜利和 restart；用 screenshot/vision 验证 480×640 及当前窗口下无明显溢出。最终报告实际证据和插件问题，不以 tool success 代替验收。
