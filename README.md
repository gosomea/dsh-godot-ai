---
description: "在 DeepSeek Harness 中用一个 Godot Creator 模式读取、构建和验证 Godot 游戏，并管理游戏开发 Skills。"
kind: "package-bundle"
---

# dsh-godot-ai

中文 | [English](README.en.md)

## 简介

给 DeepSeek Harness 增加一个专门做 Godot 游戏的 **Godot Creator** 模式。你描述玩法，AI 通过原版 [Godot AI](https://github.com/hi-godot/godot-ai) 操作当前打开的编辑器，搭场景、改脚本、制作 UI，再运行并检查结果。插件同时提供游戏创作台、16 个 Godot Skills、3 个工作流和第三方 Skill 市场。Godot AI Addon 需要你在目标项目中手动安装并启用。

当前版本 `0.7.0`，支持 DSH `0.2.0-rc.2` Web；不支持旧 rc8。所有能力集中在一个 `godot-creator` preset，不再提供 Adaptive 模式。

## 目录

- [安装与开始](#安装与开始)
- [能做什么](#能做什么)
- [这个模式的底座是什么](#这个模式的底座是什么)
- [Skills 与更新](#skills-与更新)
- [实现方式](#实现方式)
- [模型使用方式](#模型使用方式)
- [限制与验证](#限制与验证)
- [开发](#开发)

## 安装与开始

### 1. 准备环境

需要 DSH `0.2.0-rc.2` Web、Node.js `22.19+` 的 22.x 或 `24+`（不使用 Node 23），以及 `uvx`。Godot 最低 `4.5`，推荐 `4.7+`；Godot AI 后端固定在已验证的 `3.1.5`。

先确认：

```bash
uvx --version
```

### 2. 安装或升级插件

使用与你的 Web 实例相同的 profile。例如本机 `dsh-web` 使用 `web-rc2`：

```bash
dsh plugin --profile web-rc2 add dsh-godot-ai@0.7.0
```

如果你的全局 `dsh` 比源码旧，在新版 DSH 源码目录使用对应的 CLI：

```bash
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web-rc2 add dsh-godot-ai@0.7.0
```

安装完成后，在当前任务结束时重新启动原来的 Web 命令。Godot Creator 会自动出现在 Agent 预设列表中，**无需再点击“安装游戏创造模式”**，也不会创建一套用户目录 preset 副本。

如果模式选择不可见，在设置中开启“显示代码工作视图”，再查看 Agent 预设；也可把 Godot Creator 设为新会话默认模式。

### 3. 在 Godot 项目中启用 Addon

1. 用 Godot 打开目标项目。
2. 在 AssetLib 搜索 **Godot AI** 并安装与后端兼容的 `3.1.5` Addon。
3. 打开 **Project → Project Settings → Plugins**，启用 Godot AI。
4. 保持项目在编辑器中打开。

如果 AssetLib 的最新版本已高于 `3.1.5`，使用对应的 [v3.1.5 源码](https://github.com/hi-godot/godot-ai/tree/v3.1.5)中的 `addons/godot_ai`；不要盲目把未经验证的新 Addon 与旧后端混用。插件不自动写入你的项目。安装帮助和连接诊断在 DSH 设置中的 Godot AI 卡片。

### 4. 开始创作

新建会话并选择 **Godot Creator**。打开顶部的游戏创作台，确认连接状态和目标项目；多个项目时先选清楚目标。可以直接输入：

```text
创建一个 480×720 的 2D 躲避游戏。
玩家可以左右移动和跳跃，碰到障碍后重生，走到终点显示胜利，
并提供重新开始按钮。完成后运行游戏，检查日志和画面。
```

创作台中的“2D 游戏骨架”“3D 可玩原型”“菜单与 HUD”只把需求放进输入框，不会自动发送，也不会覆盖已有草稿。

## 能做什么

- 创建和修改场景、节点、GDScript/C# 脚本、资源、信号、输入设置。
- 制作 UI、动画、材质、Shader、粒子、音频、相机和环境。
- 运行游戏，检查场景树、运行状态、报错、警告、日志和画面；在工具支持范围内模拟输入。
- 按“读取 → 小批次修改 → 回读 → 运行 → 验证”工作，失败时从已验证阶段恢复。
- 在创作台查看项目、Addon、后端和版本状态；在 Skill 市场审阅、安装、更新及回滚第三方知识。

Godot 编辑器操作由原版 Godot AI 实现；这个插件负责 DSH 模式、对话规则、知识、工作流和界面，不替代游戏引擎，也不保证一句话就完成整款游戏。

## 这个模式的底座是什么

不是复制 Minimal，也不再复制用户目录中的 Standard。当前模式基于 **DSH 0.2.0-rc.2 官方 Web PTC 预设的声明式配置**，加入 Godot 专属规则、MCP 和技能提供方。

它保留文件、Shell、搜索、Skills、计划、目标、压缩和验证工具；通过原生 PTC 把模型直接调用的入口收敛到 `run_code`。这是聚焦工具编排，不是删除工程能力。Standard、Minimal 等 DSH 自带模式不被修改。

从 `0.6.0` 升级时，需要同时升级 DSH；新会话统一选择 Godot Creator。旧 `godot-creator-adaptive` 会话不做无损恢复承诺，旧用户 preset 文件不会自动删除，请先备份旧配置与会话。

## Skills 与更新

16 个内置 Godot Skills 是离线兜底，跟随 npm 版本更新；正文按任务读取，不把整个目录塞入每轮提示词。项目和用户的同名 Skill 可以按 DSH 的作用域和优先级覆盖兜底版本，来源及许可证见 [Skills 说明](skills/README.md)。

第三方市场继续提供“已安装 / 精选 / GitHub 导入 / 更新”四个标签页：

- 固定 commit 下载，审阅正文、差异、许可证和风险后安装；不运行第三方脚本或安装器。
- 新安装默认禁用；启用后也仅供用户主动调用，不允许模型自动调用。
- critical 风险硬阻断，high/medium 需要逐条确认。静态扫描不是沙箱，也不能证明正文绝对安全。
- Catalog 有 Ed25519 签名、多 key 信任根、防回滚 serial 和初始哈希；签名不等于内容安全背书。
- 手动检查更新为主，后台至多每日一次；更新再次审阅，保留最多三版历史用于回滚。

市场数据保存在 `$DSH_HOME/dsh-godot-ai/skill-market/v1`，不写进插件目录。候选不等于默认安装：Three.js 与网页小游戏技能仍不默认安装，许可证或安全状态不合格的条目保持不可安装。详见 [第三方说明](THIRD_PARTY_NOTICES.md)。

插件更新使用安装相应新版本的同一个命令，然后重启 DSH。Godot AI 新版会显示为待验证更新，不自动更换后端或 Addon。

## 实现方式

<details>
<summary>给开发者的实现说明</summary>

[cordis.patch.yml](cordis.patch.yml) 声明一个 Host 插件和一个 Godot Creator preset；preset 内的 Agent 插件挂载 Persona、Skills 和 Godot AI MCP。Host 提供只读模式状态、集成诊断及 Skill 市场管理；Client 给设置和会话标题贡献界面。模式归属读取新版会话投影，工具展示使用官方 `dsh-agent-tool-presentation` 的 `ptc` 配置。

配置按 DSH 官方 rc.2 PTC 文件固定，契约测试验证其一致性。上游更新不会静默改写用户会话，后续 DSH 版本需要重新适配与验证。没有修改 DSH 源码，也没有工具名改写补丁或首轮自定义路由状态机。

</details>

## 模型使用方式

模型直接看到 `run_code` 和当前生成的 TypeScript SDK；通过 SDK 调用 Godot 与工程工具。创作规则要求先确认目标项目，按需加载 Skill，顺序执行依赖性写入，每批读回，仅返回当前决策需要的摘要。第三方 Skill 仍需用户明确调用。

## 限制与验证

新版测试覆盖 TypeScript、单元与组件契约、tarball 正式安装、真实 rc.2 Web 挂载、45 个 Godot bindings、16 个 Skills、项目 Skill 覆盖、原生 PTC 只读调用和 Standard 隔离；证据见 [插件能力验证](PLUGIN-CAPABILITY.md)。

本次环境没有连接 Godot Addon，没有重新测试三款完整游戏或真实模型生成，因此不宣称新版的游戏创作端到端通过。旧游戏验证属于历史版本证据。Godot AI `4.x` 和 DSH `0.2.1-alpha` 尚未验证；缺少 `uvx`、编辑器连接或兼容后端时请先修复设置页提示。

## 开发

```bash
pnpm install
pnpm check
pnpm test
pnpm build
```

发布前先测试打包产物，再发布同一 tarball；发布后比较 npm、GitHub 附件和本地 SHA-256。迁移计划见 [0.7.0 计划](docs/10-plans/godot-creator-rc2/plan.json)，版本变化见 [CHANGELOG](CHANGELOG.md)。License：MIT。

### 开发备注

没有额外运行时实验模式。
