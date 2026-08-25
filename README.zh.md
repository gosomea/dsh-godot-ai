# dsh-godot-ai

[English](README.md) | 中文

面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的 **Godot 游戏创造模式**。它让 DeepSeek Flash / Pro 通过 [Godot AI](https://github.com/hi-godot/godot-ai) 直接读取和操控正在运行的 Godot 编辑器，并按“发现 → 搭建 → 配置 → 运行 → 验证”的闭环创建可玩的游戏原型。

> 当前版本：`0.4.1` 受控 beta。适合用户打开 Godot 编辑器并监督 Agent 创作；暂不承诺完全无人值守或所有桌面环境零恢复。

## 它能做什么

- 创建和编辑场景、节点、脚本、资源、信号与输入映射。
- 搭建 2D / 3D 玩法、碰撞、相机、菜单、HUD 和暂停流程。
- 配置 UI、材质、Shader、动画、粒子、音频、灯光与环境。
- 运行游戏、注入输入、读取场景树和游戏状态、检查错误与警告。
- 结合截图、视觉描述、结构回读和运行日志验证结果。
- 使用 PTC / Code Mode 把多个 Godot 操作组织成可恢复的小批次。

它不是另一个 Godot 编辑器，也不是 Godot AI 的分叉版本。它是 Godot AI 与 DeepSeek Harness 之间的产品化编排层：

```text
Godot Creator 会话
        ↓  Persona + 16 个 Godot Skills + 3 个工作流
DSH Code Mode / PTC
        ↓  动态 TypeScript SDK
Godot AI MCP backend（固定并验证版本）
        ↓
Godot AI Addon
        ↓
正在运行的 Godot 编辑器与项目
```

## 核心组成

| 组成 | 作用 |
| --- | --- |
| Godot Creator preset | 独立的游戏设计、Godot 工程与验证 Persona，不影响其他 DSH 会话 |
| Godot AI 完整工具面 | 通过 DSH MCP Client 提供当前已验证的 45 个 `mcp__godot-ai__*` bindings |
| Scoped PTC | Creator 中只直接暴露 `run_code`，由动态 SDK 批量编排标准工具和 Godot 工具 |
| 16 个 Godot Skills | 1 个 Godot AI 编排协议，以及 GDScript、场景、信号、2D/3D、UI、物理、Shader 等 15 个领域技能 |
| 3 个快捷工作流 | 创建 2D 游戏骨架、创建 3D 可玩原型、添加菜单/HUD/暂停流程 |
| Godot 创作台 | 在会话页显示项目、Editor/Addon、Backend、版本和运行状态，并插入可审阅的工作流请求 |
| 安全生命周期 | 显式安装、同步、备份重建和卸载 Creator preset；检测兼容版本与端口冲突 |

## 五分钟开始

### 1. 准备环境

- DeepSeek Harness `>=0.1.0-rc.5 <0.2.0`
- Node.js `22.19.0+`
- Godot `4.5+`（推荐 `4.7`）
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/)

确认 `uvx` 可用：

```bash
uvx --version
```

### 2. 安装 dsh-godot-ai

当前首个公开 beta 请从 GitHub 源码安装：

```bash
git clone https://github.com/gosomea/dsh-godot-ai.git
cd dsh-godot-ai
pnpm install
pnpm build
dsh plugin --profile web add "$(pwd)"
```

后续 npm 包发布后，可以直接安装：

```bash
dsh plugin --profile web add dsh-godot-ai
```

安装后重新启动 DSH Web：

```bash
dsh web --port 3080
```

打开 DSH Settings。首次 onboarding 会解释即将写入的用户 preset，然后提供 **安装游戏创造模式** 按钮。仅安装 Bundle 不会静默写入 preset。

### 3. 在 Godot 项目中安装 Addon

DSH Bundle 与 Godot Addon 是两次独立安装。本插件**不会自动修改任何 Godot 项目**。

任选一种方式安装：

1. 在 Godot 打开 **AssetLib**，搜索 **Godot AI**，下载并安装。
2. 下载最新 [Godot AI GitHub Release](https://github.com/hi-godot/godot-ai/releases/latest)，把 `addons/godot_ai` 复制到项目。
3. Clone 上游源码，把 `plugin/addons/godot_ai` 复制到项目。

然后打开 **Project → Project Settings → Plugins**，启用 **Godot AI**，并保持目标项目在 Godot 编辑器中打开。

### 4. 开始创作

1. 在 DSH 新建会话，选择 **Godot Creator**。
2. 确认会话顶部显示目标项目并处于“已连接”状态。
3. 点击 **Godot Creator** 状态入口，可选择 2D、3D 或菜单/HUD 快捷工作流。
4. 工作流只会把一段可审阅请求插入输入框；检查并补充需求后再发送。

也可以直接输入自然语言需求：

```text
创建一个 480×720 的 2D 躲避游戏。玩家左右移动和跳跃，
碰到障碍后重生，到达终点后显示胜利，并提供重新开始按钮。
请先读取当前项目，分阶段实现，每批修改后回读，最后运行并检查日志和画面。
```

```text
读取当前 3D 项目，制作一个第三人称收集原型：收集 3 个能量球后打开出口，
加入跟随相机、碰撞、状态 HUD、基础材质和灯光，并完整验证游戏流程。
```

```text
为当前游戏添加主菜单、响应式 HUD、暂停、恢复和返回主菜单流程，
保持现有游戏逻辑的所有权不变，并测试键盘和鼠标导航。
```

## Godot Creator 如何工作

Creator 首先确认目标 editor session、项目路径、当前场景、选择和运行状态。随后把需求缩小成可运行的垂直切片，并执行：

1. **发现**：读取现有场景、节点、脚本、资源、输入和项目约束。
2. **搭建**：按单一子树或资源族创建结构，通常每个副作用批次不超过 20 条命令。
3. **配置**：连接脚本、信号、输入、UI、材质和其他行为。
4. **运行**：保存并运行项目，遍历核心玩法路径。
5. **验证**：独立回读结果，检查状态、错误、警告、日志和视觉证据。

工具返回 `success` 不等于任务完成。Creator 会在每批写入后回读；发生部分失败时记录已经产生的副作用，从最近一个验证通过的阶段恢复。

## PTC、Skills 与工作流的区别

- **Godot AI 工具**负责真正读取和修改编辑器。
- **PTC / Code Mode**负责把多个工具调用编排成较少、可恢复的程序批次。
- **Godot Skills**提供领域知识、参数约束、验证方法和已知问题规避策略。
- **工作流模板**保存目标、输入、阶段、验收与恢复条件，不硬编码 TypeScript 或上游工具参数。
- **Godot Creator Persona**把以上能力组织成一段完整、可解释的创作过程。

完整 Skill 来源、快照与更新策略见 [`skills/README.md`](skills/README.md) 和 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## Backend 与版本策略

只有 `godot-creator` 会话会挂载 Godot MCP。当前通过以下固定版本命令启动 backend：

```bash
uvx --link-mode copy --from godot-ai==3.1.5 \
  godot-ai attach --port 8000 --ws-port 9500
```

首次启动可能下载并缓存对应 Python 包，但不会安装 Godot Addon，也不会写入 Godot 项目。所有 Godot 工具域默认开启，单次调用超时为 360 秒，连接使用有界重试。

若 8000 端口被其他进程占用，状态卡会报告 foreign listener，并以 `PORT_OCCUPIED` 失败关闭；插件不会杀掉或替换无法识别的进程。

安全更新会让 wrapper 和兼容矩阵一起前进：

```bash
dsh plugin --profile web update dsh-godot-ai
```

更新后重启 DSH。已受管的 preset 引用稳定的 `dsh-godot-ai/agent` export，通常不需要重建。尚未写入 `compatibility.json` 的 Godot AI 新版只显示为“等待 wrapper 验证”，不会自动切换。

## 已验证的游戏原型

`0.4.1` 已通过真实 DSH、Godot AI 和 Godot 编辑器会话创建并验证三种互补原型：

| 原型 | 覆盖能力 | 结果 |
| --- | --- | --- |
| Neon Dash | 2D 移动、跳跃、危险区、重生、相机、胜利与重新开始 | PASS |
| Signal Circuit | 响应式 UI、信号、焦点导航、键盘/鼠标、Tween 与程序音频 | PASS |
| Orbit Collector | 3D 移动、相机、碰撞、材质、灯光、HUD、收集与出口逻辑 | PASS |

Flash 负责创建，Pro 可独立读取项目并做证据驱动的最小修复。完整环境、缺陷和恢复证据见 [`validation/report.md`](validation/report.md) 与 [`validation/issues.md`](validation/issues.md)。

## 状态与故障排查

| 现象 | 检查方式 |
| --- | --- |
| 没有 Godot Creator preset | 打开 Settings onboarding，显式安装游戏创造模式，然后重启 DSH |
| `uvx` 未安装 | 安装 `uv`，确认 `uvx --version` 可执行 |
| Backend 等待启动 | 新建或打开 Godot Creator 会话；首次启动可能需要下载固定版本 |
| Editor / Addon 未连接 | 保持 Godot 项目打开，并在 Project Settings → Plugins 启用 Godot AI |
| 8000 端口冲突 | 检查占用进程；插件不会自动终止未知 listener |
| Web boot 中大量插件为 `pending` | 先确认 `dsh web` 进程仍在运行；基础运行时连接断开会导致依赖插件连锁等待 |

## 安全边界

- npm lifecycle 和插件启动 hook 不会写 `$DSH_HOME/.agent-presets`。
- 安装、同步、重建和卸载都由用户触发，并且串行执行。
- 已存在的非受管 `godot-creator` 永不覆盖。
- Composition、marker 或 sidecar 被用户修改后会标记为 user-modified，不自动删除。
- 重建前把旧 preset 移动为隐藏 sibling 备份；失败时恢复。
- 管理 HTTP 路由只接受 loopback、同源请求。
- Bundle 不修改 Godot 项目或 `addons/` 目录。
- 版本检查只读取公开 PyPI metadata；网络失败不影响本地集成。
- 未验证的 Godot AI 新版永远不会自动成为运行版本。

## 卸载

先在插件界面卸载受管的 Godot Creator preset，再删除 Bundle：

```bash
dsh plugin --profile web remove dsh-godot-ai
```

DSH 当前没有 package-removal hook。若先删除 npm 包，受管 preset 会留在磁盘，并因 `dsh-godot-ai/agent` 无法解析而变成 broken。

## 开发与测试

```bash
pnpm check
pnpm test
pnpm build
```

真实协议联调：

```bash
pnpm test:live
```

Live test 会经过真实的 `uvx → godot-ai attach → DSH MCP Client → Code Mode` 路径，断言 Creator wire catalog 只有 `run_code`、SDK 包含 45 个 Godot bindings，并执行只读 `session_manage(list)`。它不写 Godot 项目，没有连接编辑器也可以验证协议。

## 兼容性

| 组件 | 已验证版本 |
| --- | --- |
| dsh-godot-ai | `0.4.1` |
| DeepSeek Harness | `0.1.0-rc.5` 基线 |
| Node.js | `>=22.19.0` |
| Godot AI | `3.1.5` |
| Godot | `>=4.5`，推荐 `4.7` |

机器可读矩阵见 [`compatibility.json`](compatibility.json)。

## License

[MIT](LICENSE)。Godot AI 与社区 Skill 来源及许可证见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
