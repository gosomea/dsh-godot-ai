# RC8 实机对照问题台账

> 判定口径：只接受目标目录内写入、`project_run(mode=custom)` 精确启动目标场景、日志与场景回读、非 stale 运行截图，以及正常结束的 turn。开发期数据保留在 `calibration-runs/`，冻结后的正式报告单独写入 `formal-runs/`。

| ID | 归属 | 严重度 | 现象 | 处理 | 状态 |
| --- | --- | --- | --- | --- | --- |
| EVAL-001 | test environment | P1 | Godot 会异步给旧 `.tscn` 补 UID/unique id，造成样本之间 project diff 污染 | 每次运行前把已有矩阵游戏隔离到 `game-artifacts/<run>/snapshot-N`，并把编辑器恢复到 `res://main.tscn` | 已修复 |
| EVAL-002 | godot-ai usage | P1 | `project_run(mode=current)` 可能启动编辑器旧标签页，而不是刚创建的目标场景 | Adaptive 对显式矩阵目标强制 `mode=custom`；技能要求新场景、用户指定场景和多标签页场景使用 custom；聚合器重新审计旧报告 | 已修复 |
| EVAL-003 | plugin prompt | P1 | Adaptive 完成两个 bootstrap 只读调用后可能停在“计划”，不继续执行用户任务 | promotion 后注入一次简短 continuation，要求继续原任务 | 已修复 |
| EVAL-004 | DSH/model compatibility | P1 | IOA 流式片段偶发空 tool name，导致工具分发失败 | 插件边界增加流式空名兼容包装并回归测试；矩阵持续检查 `emptyToolNames == 0` | 已修复 |
| EVAL-005 | plugin routing | P2 | bootstrap 成功后 reason 仍显示 `bootstrap-inspection-not-confirmed` | 以 root `run_code` 和同 root 两个只读调用均成功为 promotion 条件，reason 改为 `bootstrap-inspection-succeeded` | 已修复 |
| EVAL-006 | prompt/skill | P2 | Agent 会重复加载同一个领域 skill，增加上下文和无效调用 | 每轮 orchestration + 最多两个领域 skill；重复 skill 调用直接拒绝 | 已修复 |
| EVAL-007 | prompt/skill | P2 | Agent 为交互 oracle 反复输入数千帧，真实完成后仍持续验证直到超时 | 每项 oracle 最多两次、单次通常不超过 300 physics frames、累计不超过 600；失败后换 oracle 或如实报告 | 已修复，持续观察 |
| EVAL-008 | test runner | P1 | `--dry-run` 会写入正式 JSON，未执行样本随后被当成 existing 跳过 | dry-run 现在只输出 planned/existing，不创建 session、报告或 summary；已删除 20 份占位 JSON | 已修复 |
| EVAL-009 | model capability | P2 | DeepSeek IOA 模型未声明图像输入，Agent 只能收到截图元数据，无法直接看像素 | 自动门使用 `stale_frame:false`；主代理通过原始 MCP image block 独立视觉复核并记录 | 接受限制 |
| EVAL-010 | test environment | P2 | macOS 后台输入注入不稳定，部分验证只能依赖 helper/runtime state | 允许状态 oracle，但必须披露；玩法输入仍优先使用短、确定性操作 | 持续观察 |
| PERF-001 | plugin/model | P2 | Adaptive full prefix 的冷启动输入 token 显著高于 classic；3D 样本没有速度或成功率优势 | 按 Flash/Pro 与任务类别分别做启用决策；未通过效率门不默认替代 classic | 未决 |
| PERF-002 | model | P2 | Pro `max` reasoning 容易生成很长 PTC 程序并撞 12 分钟预算 | 保持真实产品配置，不放宽门槛；完成 Pro 分组后决定是否只给 Flash 开 Adaptive | 未决 |
| EVAL-011 | experiment design | P1 | 旧 30 次排列使 Pro 固定偏向 Classic、Flash 固定偏向 Adaptive，模型与模式混杂；同时插件/runner 在样本间升级 | 旧 11 次全部改为 calibration；冻结 `rc.1` 后按类别 3/3、模型内 8/7 与 7/8、固定随机 seed 重跑正式 30 次 | 已修复，待正式执行 |
| EVAL-012 | plugin runtime | P1 | Bugfix Adaptive 已收齐证据仍持续 159 次子调用、4 次启动并超时 | 单轮相同 Godot 请求最多 3 次、`project_run` 最多 2 次、`game_eval` 最多 8 次；拒绝信息要求使用已有证据收尾 | 已修复，待实机复测 |
| FORMAL-001 | model/prompt | P2 | 正式 2D Flash Adaptive 完成场景、运行、日志和回读后，停止游戏并只截 `viewport_2d`，缺少非 stale 的 game screenshot | 严格判 FAIL，不补拍、不重写；矩阵结束后判断是否需要在下一候选把“运行中截图”提升为硬约束 | 正式观察 |
| FORMAL-002 | model / validation-harness | P1 | 新 runner 的 Pro Classic UI 重跑在 12 分钟预算内被取消；目标场景、日志、截图和插件字段均已产生，插件 namespace/preset/16 Skills/PTC 全部通过，只有 turn completion 失败 | 按模型/效率问题处理，不归因于插件；保留原始报告并要求后续同类样本独立计时 | 已记录 |
