---
name: godot-ai-orchestration
description: "通过 hi-godot/godot-ai 操控运行中的 Godot 编辑器：会话、45 个工具、PTC 批处理、诊断、运行、输入与视觉验证。任何编辑器写入、运行或验收任务都先使用。"
upstream: https://github.com/hi-godot/godot-ai/tree/v3.1.5
verified: 2026-08-24
---

# Godot AI 编排

把 `godot-ai` 当作编辑器事实来源和执行层；把本技能当作控制协议。工具参数始终以当前 TypeScript SDK 为准。

## 开始前

1. 用 `session_manage(op="list")` 发现编辑器；只有一个匹配项时才自动选择，多项目时显式 `session_activate`。
2. 读取 `editor_state`，确认项目、当前场景、readiness、play state 和 `game_status.status`。
3. 写入前读取目标：场景层级、节点属性、脚本、资源或项目设置。不要凭用户描述推断现状。

## 45 个工具的路由

- 高频直达：`editor_state`、`scene_get_hierarchy`、`node_get_properties`、`session_activate`、`batch_execute`、`node_create`、`node_set_property`、`node_find`、`scene_open`、`scene_save`、`script_create`、`script_attach`、`script_patch`、`project_run`、`test_run`、`logs_read`、`editor_screenshot`、`editor_reload_plugin`、`animation_create`。
- 领域 rollup：`scene_manage`、`node_manage`、`script_manage`、`project_manage`、`editor_manage`、`session_manage`、`test_manage`、`animation_manage`、`material_manage`、`audio_manage`、`particle_manage`、`camera_manage`、`signal_manage`、`input_map_manage`、`game_manage`、`autoload_manage`、`filesystem_manage`、`theme_manage`、`ui_manage`、`resource_manage`、`api_manage`、`client_manage`、`tilemap_manage`、`tileset_manage`、`gridmap_manage`、`csg_manage`。
- rollup 使用 `{ op, params, session_id? }`；`session_id` 位于顶层。`batch_execute.commands[].command` 使用插件底层命令名，不是 MCP 工具名。
- 不确定 Godot 类的属性、方法或信号时，先用 `api_manage(op="get_class")` 按 section 查询，避免猜 API。

## PTC 与写入纪律

- 一个 `run_code` 只做一个可恢复批次：发现、搭建、配置、运行或验证。
- 单个原子写批次通常限制在一个子树/资源族、最多约 20 条有副作用命令；超过时按独立子树拆分并逐批回读。
- 可并行：互不依赖的只读查询。必须串行：有依赖的创建、重命名、重挂载、资源赋值和保存。
- `batch_execute` 适合同一编辑器内的紧密原子修改；跨运行、截图、延迟输入或外部文件操作不要假设事务性。
- `batch_execute` 任一命令失败且返回 `rolled_back: true` 时，前面显示 `ok` 的命令也已撤销；修正后必须重放并回读整个批次，不能只补失败项。Vector/Polygon 等复合值使用工具 schema 展示的直接 JSON 结构，不添加自创包装。
- 每批写入后使用另一条读取路径回验。`success: true` 只证明命令被接受。
- `script_create` / `script_patch` 后立即检查响应中的 `diagnostics`；无头环境下它可能是唯一可靠的解析错误通道。

## 运行与验收

1. 保存目标场景，再 `project_run`。用户指定了场景路径、刚新建/切换场景或编辑器存在多个标签时，必须使用 `mode="custom"` 并显式传入目标 `scene`；Godot AI 3.1.5 的 `mode="current"` 可能启动旧标签页，不能用它验证隔离目标。
2. 以 `game_status.status` 判断状态，不只看 `is_playing`：`live` 才证明 helper 在线；`launching` 继续轮询；`break` 先 stop、修最早解析错误再重跑；`no_helper` 只能证明进程存在。run 后立即核对 `editor_state.current_scene` 与目标路径；不一致就 stop 并用 `mode="custom"` 重跑，不读取、修复或复用意外启动的其他场景。
3. 读取 `logs_read(source="editor", include_details=true)` 与本次 run 的 game logs。错误计数是门铃，不是唯一错误数。
4. 交互验收前比较短间隔内的 physics tick / 运行时位置，确认物理帧确实推进；macOS 窗口遮挡时可能出现 `paused=false`、`has_focus=true` 但物理冻结。先聚焦或 stop/re-run，再判断输入逻辑。`monitors_get` 的过滤在 3.1.5 不可靠时取全量后本地筛选。
5. 同一个交互 oracle 最多做两次有界尝试；单次等待通常不超过 300 physics frames，两次合计不超过 600 frames。仍无法稳定复现移动碰撞、时序或焦点行为时，立即换成独立的状态/信号/位置读回，或明确标为“交互未验证”，禁止用更长 input sequence 反复追逐动态目标。Adaptive runtime 还会拒绝第四次完全相同的 Godot 请求、第三次项目启动和第九次 `game_eval`；遇到拒绝时使用已有证据收尾，不要改写参数绕过预算。
6. 交互验收优先 `game_manage(op="input_sequence")`，用 frame-timed press/release，结束时释放仍按下的 action。该操作保证 action 的 pressed 状态，不保证产生 `_input` / `_unhandled_input` 的 `InputEvent`，也不保证脚本在同一帧观察到 `is_action_just_pressed`；需要自动化验证的边缘动作优先用 `is_action_pressed` 加上一帧状态自行判边，或改用明确支持事件注入的操作。
7. 用 `game_manage` 回读运行时节点/UI；视觉任务再用 `editor_screenshot` 的 `game`、`viewport_2d`、`viewport` 或 `cinematic` 模式。
8. 结构化 `game_manage` 查询优先于 `game_eval`。eval 代码的解析/运行异常可能让 helper 进入 `break`，且 3.1.5 的 `EVAL_COMPILE_ERROR` 可能不含实际解析文本；一旦发生，先读最早错误，再 stop、修复并重新 run，不能在 break 状态继续推断游戏行为。临时 eval 改状态只用于诊断/构图，重跑后再做玩法验收，避免污染证据。
9. 截图前确认对应 run 仍为 `live`，记录 `stale_frame` / run token，并在相机 zoom 或窗口尺寸变化后重新截取完整构图。视觉反馈按“模型直接读图 → 可用的专用视觉桥 → 尺寸/像素/颜色 + 运行时 UI 回读”降级；不得声称完成高于实际证据等级的视觉验收。
10. 报告实际证据：读回值、run id、日志结果、测试结果和视觉描述；没有证据就说明未验证。

## 恢复

部分失败时记录已完成副作用和最后一个已验证点。优先修复首个根因；不要在未知状态下重复整批创建，以免产生重复节点、信号或资源。
