# Changelog

## Unreleased

- 开始实现 0.6.0 Skill 市场基础：增加固定来源和许可证的 10 个候选审核清单、市场 rank 350 Provider 骨架，以及 Standard composition 继承契约测试。
- 将 npm 随包的 16 个 Godot Skill 从 runtime rank 250 迁移到 DSH 标准 bundled rank 600；项目、自定义目录、市场和用户同名 Skill 现在可以按公开优先级覆盖插件兜底版本。
- 第三方市场 Skill 默认禁止模型自动调用；只有已经安装、通过审核且用户显式启用的 Skill 才能出现在用户调用面。

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
