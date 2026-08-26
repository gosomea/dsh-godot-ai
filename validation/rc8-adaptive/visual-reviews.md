# RC8 游戏视觉复核

自动 PASS 只能证明运行、读回与截图证据存在；以下为通过原始 godot-ai MCP image block 进行的独立像素级复核。

| Run | 画面与可用性 | 结论 |
| --- | --- | --- |
| `02-2d-create-flash-adaptive-3` | 深色背景、青色玩家、4 个灰色固定障碍和中文 HUD；元素边界清楚，适合作为最小躲避玩法切片 | 通过 |
| `04-3d-create-flash-adaptive-1` | 灰色地面、蓝色玩家、黄色收集物、灯光/相机与 `Coins 0/1` HUD；目标和交互层级清楚 | 通过 |
| `04-3d-create-flash-classic-2` | 地面、胶囊玩家、收集物与中文 HUD 完整；最小 3D 原型可辨识 | 通过 |
| `08-ui-animation-flash-adaptive-3` | 880×480 深色响应式 UI，青色标题、黄色计数、明显的聚焦按钮与底部操作提示；无裁切和溢出，截图为 `stale_frame:false` | 通过 |
| `08-ui-animation-flash-classic-2` | 深色标题/计数/按钮布局清楚，原始运行证据截图均非 stale；后续人工截图为 stale，不作为验收证据 | 通过原始证据，附注限制 |
| `10-long-resume-flash-adaptive-3`（正式） | 880×480 深色计时点击界面，中文标题、黄色分数、剩余时间和全宽点击按钮层级清楚；独立截图为 `stale_frame:false`。最高分/重开位于倒计时结束后的结果态，运行 trace 已验证 | 通过 |
| `04-3d-create-flash-adaptive-2`（正式） | 灰色围场、胶囊玩家、阴影和 `Gems: 0/1` HUD 清晰，截图非 stale；收集物节点及运行状态已读回，但初始相机画面没有把 Gem 纳入视野，目标引导较弱 | 自动门通过；视觉质量一般 |
| `07-ui-animation-pro-adaptive-1`（正式） | 880×480 黑色背景上的居中深蓝卡片，黄色标题、操作说明、计数、全宽聚焦按钮和底部状态层级明确；留白、对齐、对比度良好，截图非 stale | 通过 |
| `08-ui-animation-flash-classic-3`（正式） | 880×480 深色背景，紧凑居中的标题、计数、Count +1 与 Reset 双按钮；对齐清楚、无溢出、截图非 stale，但视觉层级和说明信息少于 Pro Adaptive UI | 通过；风格更朴素 |

`08-ui-animation-flash-adaptive-1` 虽然画面良好，但只使用 `mode=current`，无法证明截图对应本次目标场景，按严格门重新判为 FAIL。
