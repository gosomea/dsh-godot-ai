# dsh-godot-ai multi-game issue ledger

| ID | Run | Layer | Priority | Symptom / reproduction | Status | Regression |
| --- | --- | --- | --- | --- | --- | --- |
| VAL-001 | neon-dash | validation-harness | P1 | `session.history` 原样保存 50,672 个 `assistant/chunk`，单局证据达到 22 MB。 | Fixed：只保留回合、消息与工具结果摘要，长值带 SHA-256；648 KB。 | 后续每局检查 `omittedEvents` 与文件大小。 |
| GODOT-001 | neon-dash | godot-ai | P1 | `batch_execute` 第 3 项 polygon 类型错误后返回 `rolled_back: true`；前两项虽标为 `ok` 也被撤销，Player 回到 `(0,0)` 且 shape 为空。 | Mitigated in skill：整批重放并回读；上游参数/回滚语义仍需关注。 | Game B/C 故意使用多项 batch 并回读首项。 |
| SKILL-001 | neon-dash | persona-skill | P1 | `input_sequence` 的 action press 不产生 `_unhandled_input` 事件，且同帧 `is_action_just_pressed` 未被脚本观察到，restart 连续失败。 | Fixed in skill：自动化边缘动作改用 pressed 状态 + 上一帧判边。 | Game B 的 Restart 必须由输入序列通过。 |
| SKILL-002 | neon-dash | persona-skill | P2 | Flash 猜测 Camera2D `current` 属性；Godot 4 应使用 `enabled` / `camera_manage`。 | Fixed in 2D skill。 | Game C 检查 Camera3D 时先读 API/使用 `camera_manage`。 |
| ENV-001 | neon-dash | environment | P2 | 当前模型不支持图片输入且 `describe_image` 后端未配置；无法完成人眼级视觉描述。 | Accepted degradation：截图 + 像素/位置 + UI 回读，并明确限制。 | 每局必须记录视觉等级，不以截图成功替代描述。 |
| GODOT-002 | neon-dash | godot-ai | P2 | 后台游戏截图可能复用旧帧；首次视觉分析受相机 zoom 与窗口状态干扰。 | Mitigated in skill：核对 live/run token/stale_frame，调整后重截。 | Game B/C 记录截图元数据与完整构图。 |
| GODOT-003 | signal-circuit | godot-ai | P2 | `filesystem_manage` 的 path / `res://` 过滤均未返回已存在的 `validation_games`，只能退回只读文件系统确认边界。 | Open：保留复现，待对照 3.1.5 schema/上游。 | Game C 再用一次 search/list 并记录参数。 |
| PTC-001 | signal-circuit | dsh-ptc | P2 | UI 树一次 `batch_execute` 含 57 条写命令；虽全部成功，但末项失败会导致大范围重做。 | Fixed in persona/skill：单一子树且通常 ≤20 个副作用命令。 | Game C 观察 Agent 是否按子树拆批。 |
| GODOT-004 | signal-circuit | godot-ai | P1 | `batch_execute` 内 `anchors_preset` 返回 transient 0，运行时 RootLayout 宽 683px；必须单独 `ui_manage(set_anchor_preset)` 并回读实际布局。 | Mitigated in UI skill。 | 后续 UI 必须用 runtime size 验收。 |
| GODOT-005 | signal-circuit | godot-ai | P2 | `node_get_properties(fields=[anchor/offset...])` 返回 `unknown_fields`，无法用于 Control 布局定点回读。 | Open：优先 `get_ui_elements`，必要时受控 eval。 | Game C HUD 不依赖该 fields 过滤。 |
| SKILL-003 | signal-circuit | persona-skill | P1 | full-rect 根 offsets 叠加导致 960×1280；长 HintLabel 的 683px 最小宽又撑破 VBox。 | Fixed in UI skill：preset 后 offsets、full-rect 零 offset、长文 autowrap、runtime size。 | Signal Circuit 最终 RootLayout 440×608。 |
| SKILL-004 | signal-circuit | persona-skill | P1 | `input_action(ui_right/ui_accept)` 不产生 Control 所需 InputEvent；键盘焦点不起作用。 | Fixed in UI skill：Control 使用 `input_key`/`input_gamepad`，press/release 间留帧。 | 键盘完整流程通过；Game C HUD 输入按类型选择。 |
| GODOT-006 | signal-circuit | godot-ai | P1 | 两次无效 `game_eval` 代码将 helper 推入 `break`，必须 stop/re-run 才能恢复。 | Mitigated in orchestration skill：结构化查询优先，明确 break 恢复。 | Game C 禁止用 eval 作首选探测。 |
| ENV-002 | signal-circuit | environment | P2 | Pro 不能直接读本地图片，`describe_image` 仅收 HTTP URL，但 `modlens_read_image` 可用。 | Fixed in skill：视觉按直接读图→视觉桥→程序化降级探测。 | Game C 必须记录实际视觉路径。 |
| GODOT-007 | signal-circuit | godot-ai | P2 | 无实体手柄时 `input_gamepad` 轴导航稳定，A 键激活偶发丢失。 | Open：键盘/鼠标完成闭环；建议实体手柄补测。 | Game C 记录是否复现，不能声称完整手柄验收。 |
| GODOT-008 | orbit-collector-build | godot-ai | P1 | 失败的节点/碰撞调用已留下副作用，重试产生 `GroundCollision2`；错误结果不等于零写入。 | Mitigated：错误后读 hierarchy、删除残留再继续；persona 已要求副作用清单。 | Pro 确认无重复节点，仅保留命名痕迹。 |
| MODEL-001 | orbit-collector-build | model | P2 | 为构图与状态探测多次使用 eval，临时改相机/门状态，若不重跑会污染玩法证据。 | Fixed in skill：eval 诊断与玩法验收隔离，最终从磁盘重跑。 | Build 最终 run_token 验证初始状态；Review 独立重玩。 |
| GODOT-009 | orbit-collector-build/review | godot-ai | P1 | `EVAL_COMPILE_ERROR` 经常不返回真实解析文本，并可让 helper 进入 break，后续 input 超时。 | Mitigated in skill：结构化查询优先，break 后 stop/re-run。 | 两模型均成功恢复；仍是 3.1.5 上游缺陷。 |
| ENV-003 | orbit-collector-review | environment | P1 | macOS 游戏窗口被遮挡时 physics tick 冻结，尽管 `paused=false`、`has_focus=true`；输入状态 true 但角色不动。 | Fixed in skill：输入前检查 physics tick，冻结时聚焦或 stop/re-run。 | Review 重启后 physics tick 422→452，完整流程通过。 |
| GODOT-010 | orbit-collector-review | godot-ai | P2 | `game_manage(op="monitors_get")` 的 monitors 过滤返回空 dict，取全量 30 项后才能本地筛选。 | Mitigated in skill；上游待修。 | 最终读取 fps 145、physics 0.05ms、process 1.3ms。 |
| GAME-001 | orbit-collector-review | godot-project | P1 | HUD Status 使用 center_top，264px 文本末端到 x=503.5，在 480px 视口被裁切。 | Fixed by Pro：top_wide + 居中，运行时 rect 0..480，视觉回归通过。 | Review 最终截图与 UI rect。 |
| GAME-002 | orbit-collector-review | godot-project | P2 | `player.gd` 的 orb 参数未使用，editor log 有 GDScript reload warning。 | Fixed by Pro：参数改 `_orb`，diagnostics/logs 归零。 | Review 最终日志。 |

Layer values: `model`, `persona-skill`, `dsh-ptc`, `godot-ai`, `plugin-host-ui`, `godot-project`, `environment`, `validation-harness`.
