# Changelog

## 0.7.0 - 2026-10-07

- 支持 DeepSeek Harness 0.2.0-rc.2 Web，开发依赖与 peer 范围迁到新版公开 API。
- 收敛为一个声明式 Godot Creator preset；安装插件后直接可用，不再复制用户 preset 或提供 Adaptive。
- 使用官方原生 PTC 展示及新版会话投影，移除旧工具名兼容补丁和 Adaptive 状态机。
- 保留 Godot AI 3.1.5 的 45 个工具、16 个内置 Skills、3 个工作流、创作台和签名 Skill 市场。
- 修复旧 onboarding 对整个应用设置 inert 的副作用，并保留初始化取消保护。
- 中文优先重写安装、升级、Addon 版本配对和验证边界；旧 rc8/Adaptive 会话不做无损恢复承诺。


## 0.6.0 - 2026-08-27

- 开始实现 0.6.0 Skill 市场基础：增加固定来源和许可证的 10 个候选审核清单、市场 rank 350 Provider 骨架，以及 Standard composition 继承契约测试。
- 将 npm 随包的 16 个 Godot Skill 从 runtime rank 250 迁移到 DSH 标准 bundled rank 600；项目、自定义目录、市场和用户同名 Skill 现在可以按公开优先级覆盖插件兜底版本。
- 第三方市场 Skill 默认禁止模型自动调用；只有已经安装、通过审核且用户显式启用的 Skill 才能出现在用户调用面。
- 增加基于 `$DSH_HOME/dsh-godot-ai/skill-market/v1` 的不可变内容寻址 Store、schema 1 lockfile、跨进程短租约、revision 冲突检查、三版本历史和默认禁用更新。
- 增加完整性校验回滚、缺失 Artifact 的 fail-closed 启动恢复、30 分钟 inspection TTL、可恢复 trash、七天后清理和 symlink 拒绝测试。
- 增加确定性的 Prompt / 文件风险扫描、稳定 finding/report/approval hash、critical 硬阻断和 high 逐条确认。
- 增加扫描规则升级时的 fail-closed 重审生命周期，并把第三方 scripts、hooks、bin 和可执行文件隔离到永不执行的 quarantine。
- 增加 Ed25519 多 key Catalog 信任根、零状态 hash pin、单调 serial 防回滚/防歧义、过期与未来时间窗，以及并发 last-good 状态保护。
- 增加 24 小时 ETag Catalog 更新和固定 commit GitHub Import；归档仅从 codeload 获取，并限制重定向、大小、文件数、路径穿越和链接。
- 增加 Store-backed 市场 Provider：只暴露已启用、当前扫描规则、批准有效且哈希完整的用户调用 Skill，并避免跨进程状态被 DSH 长期缓存。
- 增加五路由 Host API 的后端闭环：GitHub/精选 Inspect、风险确认、一次性 Install、Enable/Disable/Rollback/GC 等 action，以及 inspection/quarantine TTL 回收。
- 在设置页加入 Godot 风格四标签 Skill 市场：已安装、精选、GitHub 导入和更新，并提供 critical 摘要、high/medium 逐项确认和默认禁用安装。
- 增加 active Artifact 与 update inspection 的有边界差异审阅：最多 2,000 行、Host 响应小于 128 KiB，并以 Artifact hash 对做 32 项/8 MiB 磁盘 LRU 缓存。
- 补齐设置页恢复闭环：可继续或放弃暂存 inspection、回滚历史版本，并列出/恢复七天保留期内的回收站条目。
- 增加可复现的首批市场构建与审计：10 个用户指定候选全部保留状态，8 个固定 commit 完成真实扫描，5 个条目可安装，三个 Godot Starter 默认推荐但不自动安装。
- npm 包内置 Ed25519 多 key 信任根、serial 1 Catalog 与签名；全新环境可离线建立 last-good，随后按 24 小时节流检查 GitHub Release 更新。
- `higgsfield-game-generation` 因 critical 远程执行链保持阻断；`game-engine` 因固定归档超过 16 MiB 安全上限不可导入；`game-design-theory` 在许可证全文审阅 UI 完成前不可安装。

## 0.5.0 - 2026-08-26

- 正式提供稳定 `godot-creator` 与可选 `godot-creator-adaptive` 两种模式，并保持 DSH / Godot AI 上游源码零修改。
- 通过真实 DSH rc8、Godot AI 3.1.5 与 Godot 4.6 的插件能力门：preset、16 个 Godot Skills、Adaptive 只读 bootstrap、promotion、完整工具面与 Classic 隔离均有记录。
- 增加严格插件归因 runner、工具名兼容、安全预算、目标场景作用域和新鲜截图验证；完整 15+15 产品矩阵尚未跑满，继续建议监督使用。
- 增加中文优先的 npm 安装、更新、Godot Addon 手动安装和故障排查说明。

## 0.5.0-rc.1 - 2026-08-26

- 为 Adaptive 增加单轮重复验证硬预算：相同 Godot 请求最多 3 次、项目启动最多 2 次、`game_eval` 最多 8 次。
- 将开发期样本和冻结后的正式矩阵分离；正式 15+15 在模型内近似平衡，并使用可复现的固定随机顺序。
- 收紧正式验收：目标场景必须用 `mode="custom"` 精确启动，截图必须是非 stale，并统一从原始 trace 重新聚合。

## 0.5.0-rc.0 - 2026-08-26

- 新增独立的 `godot-creator-adaptive` 托管 preset，稳定 `godot-creator` 保持不变。
- Adaptive 首轮使用极简完整提示词、单一 `run_code` 入口与只读 Godot SDK 绑定；首轮结束后恢复完整 Code Mode、Skills 和 MCP 能力。
- 新增 Auto / 创建 / 修复路由、确定性分类器、持久化会话状态以及设置页和创作台界面。
- 官方验证基线升级为 DeepSeek Harness `0.1.0-rc.8`，要求 Node.js 24。

## 0.4.2 - 2026-08-26

- Make the main README Chinese-first and rewrite it in more direct language.
- Explain that Godot Creator inherits DSH Standard mode rather than Minimal mode.
- Add a shorter English README and first-use examples.
- Prepare the first public npm package and attached GitHub release artifact.

## 0.4.1 - 2026-08-25

- Add the Godot Creator preset, scoped PTC, 16 Godot skills, and three workflows.
- Add the Godot-themed session workspace, onboarding, integration diagnostics, and version checks.
- Pin and validate the complete Godot AI 3.1.5 tool surface.
- Validate 2D, UI, and 3D game prototypes through real DSH and Godot editor sessions.
