# dsh-godot-ai 0.7.0

适配 DeepSeek Harness 0.2.0-rc.2，收敛为一个 Godot Creator 模式。

- 基于 DSH 官方原生 PTC composition；不再复制 Standard 或提供 Adaptive 第二模式。
- 保留 Godot AI 3.1.5 全部 45 个工具绑定、16 个内置 Skills、3 个工作流与 Skill 市场。
- 迁移新版 Host / Agent / Client 接口，移除旧的 preset 安装、同步及工具名称兼容层。
- README 中英文同步：安装步骤、手动启用 Godot Addon、旧版本迁移和验证边界。

## 安装

```sh
dsh plugin --profile <你的 profile> add dsh-godot-ai@0.7.0
```

使用源码启动器时，使用同一份源码 CLI 和相同 profile 安装，随后重启 DSH。模式自动注册，无需另行安装 preset。旧 rc8 用户自建 preset 文件不会被删除。

Godot AI Addon 仍需在目标项目中手动安装并启用，版本与插件固定的 3.1.5 后端保持一致。

## 验证

- 单元 / 插件契约测试：94 passed。
- TypeScript 类型检查与打包：通过。
- 独立 DSH Web profile，通过正式 CLI 安装发布 tarball：通过。
- 实际会话：仅一个 Godot preset、原生 run_code、45 个 Godot 工具绑定、16 个 Skills、项目 Skill 覆盖和 Standard 隔离验证通过。
- 原生 PTC 对 MCP session_manage 的只读调用：通过。
- 设置、市场和模式选择页面检查：通过。

本次没有重新验证完整游戏生成、模型行为或 Godot 编辑器写操作；不声明 DSH 0.2.1 alpha 兼容。线上 npm 与本 Release tarball 的一致性在发布后另行核验。
