# dsh-godot-ai

中文 | [English](README.en.md)

给 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 增加一个专门做 Godot 游戏的 **Godot Creator 模式**。

简单说：你在 Godot 里打开项目，AI 就能通过 [Godot AI](https://github.com/hi-godot/godot-ai) 读取编辑器、创建场景、修改脚本、运行游戏，并检查做出来的结果。

> 当前正式版本：`0.5.0`。插件能力门已经通过真实 DSH rc8 + Godot 编辑器验证；完整 15 Classic + 15 Adaptive 产品矩阵尚未跑满，推荐在 Godot 编辑器旁监督使用，暂不承诺完全无人值守。

## 它能帮你做什么

- 从零搭建可玩的 2D、3D 游戏原型。
- 创建和修改场景、节点、脚本、资源、信号和输入设置。
- 制作菜单、HUD、暂停界面、动画、材质、Shader、粒子、音频和相机。
- 运行游戏并模拟键盘、鼠标或手柄输入。
- 检查场景树、运行状态、报错、警告、日志和游戏画面。
- 修改后重新读取结果，避免工具显示成功但项目实际没有改对。
- 出错时从最近一次验证成功的阶段继续，不轻易推倒重来。

它不是 Godot 编辑器的替代品，也不是 Godot AI 的修改版。它是在 DeepSeek Harness 和 Godot AI 之间加了一层更适合“完整做游戏”的对话方式、工作流、知识和安全检查。

## Godot Creator 是从极简模式改的吗？

**不是。当前版本继承的是 DeepSeek Harness 的 Standard（标准）模式。**

安装 Godot Creator 时，插件会：

1. 复制当前 DSH 自带的 `standard` preset。
2. 创建一个独立的 `godot-creator` 用户 preset。
3. 在其中加入 Godot Creator Persona、Godot AI MCP、16 个 Godot Skills 和 3 个游戏工作流。
4. 只在 Godot Creator 里把工具切换为 PTC / Code Mode；其他模式完全不受影响。

所以它的关系是：

```text
DSH Standard 标准模式
        +
Godot Creator 对话规则
        +
Godot AI 全部工具
        +
Godot Skills 与游戏工作流
        =
独立的 Godot Creator 模式
```

它使用起来比较专注，但底座并不是 Minimal / 极简模式。这样做是为了保留 Standard 已有的文件、Shell、检索、Skills、计划和验证能力。

## 五分钟开始

### 1. 准备环境

- DeepSeek Harness：`>=0.1.0-rc.8 <0.2.0`
- Node.js：`22.19.0+`
- Godot：`4.5+`，推荐 `4.7`
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/)

先确认 `uvx` 可以运行：

```bash
uvx --version
```

### 2. 安装 dsh-godot-ai

从 npm 安装：

```bash
dsh plugin --profile web add dsh-godot-ai
```

如果你要使用 GitHub 上的源码：

```bash
git clone https://github.com/gosomea/dsh-godot-ai.git
cd dsh-godot-ai
pnpm install
pnpm build
dsh plugin --profile web add "$(pwd)"
```

安装完成后重新启动 DSH：

```bash
dsh web --port 3080
```

打开 DSH Settings，点击 **安装游戏创造模式**。这个按钮只创建 DSH 用户 preset，不会修改 Godot 项目。

### 3. 给 Godot 项目安装 Addon

这一步需要你自己操作。插件不会自动往项目里写 Addon。

推荐方式：

1. 在 Godot 中打开 **AssetLib**。
2. 搜索 **Godot AI** 并安装。
3. 打开 **Project → Project Settings → Plugins**。
4. 启用 **Godot AI**。
5. 保持目标项目在 Godot 编辑器中打开。

也可以下载最新 [Godot AI Release](https://github.com/hi-godot/godot-ai/releases/latest)，把 `addons/godot_ai` 复制到项目。

### 4. 开始做游戏

1. 在 DSH 中新建会话。
2. 选择 **Godot Creator**。
3. 确认顶部显示正确的 Godot 项目，并且状态为“已连接”。
4. 直接描述游戏，或者打开 Godot Creator 面板选择快捷工作流。

例如：

```text
创建一个 480×720 的 2D 躲避游戏。
玩家可以左右移动和跳跃，碰到障碍后重生，走到终点显示胜利，
并提供重新开始按钮。完成后运行游戏，检查日志和画面。
```

```text
读取当前 3D 项目，制作一个第三人称收集游戏。
收集 3 个能量球后打开出口，加入跟随相机、碰撞、HUD、材质和灯光，
最后完整玩一遍并修复发现的问题。
```

```text
给当前游戏添加主菜单、HUD、暂停、恢复和返回主菜单功能，
保留现有游戏逻辑，并测试键盘和鼠标操作。
```

## 三个快捷工作流

| 工作流 | 适合做什么 |
| --- | --- |
| 创建 2D 游戏骨架 | 玩家、世界、相机、输入、HUD 和基础玩法循环 |
| 创建 3D 可玩原型 | 空间、角色、碰撞、相机、灯光和基础交互 |
| 添加菜单与 HUD | 主菜单、状态显示、暂停、恢复和界面导航 |

点击工作流不会立刻修改项目。它只会把一段可以检查和补充的需求放进输入框，发送以后 AI 才开始工作。

## 插件里包含什么

| 能力 | 通俗解释 |
| --- | --- |
| Godot AI 工具 | 真正负责读取和操作 Godot 编辑器，当前验证了 45 个工具 bindings |
| Godot Creator Persona | 告诉 AI 应该怎样设计、实现、运行和验收游戏 |
| PTC / Code Mode | 把多次工具调用组合成较小的程序批次，减少来回等待 |
| 16 个 Godot Skills | 补充 GDScript、2D/3D、UI、物理、动画、Shader、音频等知识 |
| 3 个工作流 | 规定每类任务需要哪些输入、阶段、验收和出错恢复方式 |
| 游戏创作台 | 显示项目、Addon、Backend、版本和运行状态，并提供工作流入口 |

工作路径如下：

```text
Godot Creator 对话
    ↓
PTC / Code Mode 编排
    ↓
Godot AI MCP backend
    ↓
Godot AI Addon
    ↓
当前打开的 Godot 编辑器
```

完整 Skills 来源和许可证见 [`skills/README.md`](skills/README.md) 与 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 它怎样保证修改更可靠

Godot Creator 默认按以下过程工作：

1. **先看**：确认目标项目、场景、已有节点、脚本和运行状态。
2. **再做**：把任务拆成场景、脚本、UI 等小批次。
3. **回头检查**：每批修改后重新读取关键结果。
4. **实际运行**：启动游戏并走一遍主要玩法。
5. **最后验收**：检查错误、警告、日志、状态和画面。

单个工具返回 `success` 不代表整个任务完成。只有项目可以运行、核心玩法走通、结果已经回读，Creator 才会把它当作完成。

## 已经做过哪些真实验证

我们使用真实的 DSH、Godot AI 和 Godot 编辑器创建了三款不同类型的原型：

| 原型 | 验证内容 | 结果 |
| --- | --- | --- |
| Neon Dash | 2D 移动、跳跃、障碍、重生、相机、胜利和重新开始 | PASS |
| Signal Circuit | UI、信号、焦点导航、键鼠、Tween 和程序音频 | PASS |
| Orbit Collector | 3D 移动、相机、碰撞、材质、灯光、HUD 和收集玩法 | PASS |

完整报告见 [`validation/report.md`](validation/report.md)，已知问题见 [`validation/issues.md`](validation/issues.md)。

需要区分两类验证：上面的游戏原型是产品级端到端回归，证明“从对话到 Godot 项目”的链路能否交付；它不能单独证明插件自己的路由、注入和安全守卫有效。插件能力还会单独执行以下检查：

- 静态契约：`godot-creator` 与 `godot-creator-adaptive` 的 preset 组成、16 个 Godot Skills、45 个工具目录、兼容性、工作流和 preset 更新保护。
- 实机能力：Adaptive 是否先走只读 bootstrap、是否在检查成功后 promotion 到 full、是否真的挂载 Adaptive MCP 工具、是否阻止写入工具和空工具名。
- 上游边界：检查只通过公开的 DSH rc8 扩展面工作，不把改动写入 DeepSeek Harness 或 Godot AI 源码。

在已启动 DSH Web（默认 `http://127.0.0.1:3081`）和 Godot 编辑器后，可以运行：

```bash
pnpm test:capability:static   # 不访问网络，不修改 Godot 项目
pnpm test:capability:live     # 真实 DSH → 插件 → MCP → Godot，只做一次只读检查
pnpm test:capability          # 先跑静态，再跑实机能力门
```

实机报告写入 [`validation/plugin-capability-report.json`](validation/plugin-capability-report.json)，验证说明见 [`PLUGIN-CAPABILITY.md`](PLUGIN-CAPABILITY.md)。只有插件能力门通过后，才把游戏矩阵结果作为发布决策的补充证据；不能用游戏 PASS 代替插件能力门。

## Godot AI 版本与更新

当前固定并验证的 Godot AI 版本是 `3.1.5`：

```bash
uvx --link-mode copy --from godot-ai==3.1.5 \
  godot-ai attach --port 8000 --ws-port 9500
```

第一次打开 Godot Creator 时，`uvx` 可能需要下载 Python 包。它仍然不会自动安装 Godot Addon。

更新本插件：

```bash
dsh plugin --profile web update dsh-godot-ai
```

更新后重启 DSH。新的 Godot AI 版本只有通过兼容性验证后才会成为默认版本，不会因为 PyPI 出现新版本就自动切换。

## 常见问题

| 现象 | 怎么处理 |
| --- | --- |
| 找不到 Godot Creator | 到 Settings 安装游戏创造模式，然后重启 DSH |
| 提示没有 `uvx` | 安装 `uv`，再运行 `uvx --version` |
| Backend 等待启动 | 打开一个 Godot Creator 会话；首次启动可能需要下载依赖 |
| Editor / Addon 未连接 | 打开 Godot 项目，并在 Plugins 中启用 Godot AI |
| 8000 端口被占用 | 检查占用进程；插件不会自动结束未知进程 |
| Web boot 显示很多插件 `pending` | 先确认 `dsh web` 仍在运行；基础连接断开会让很多插件一起等待 |

## 安全边界

- 不修改 DeepSeek Harness 源码。
- 不自动安装 Godot Addon，也不自动修改项目的 `addons/`。
- 安装、同步、重建和卸载 Creator preset 都需要用户主动操作。
- 不覆盖已经存在但不属于本插件管理的 `godot-creator`。
- 重建 preset 前会创建备份，失败时恢复。
- 只连接本机 loopback 服务。
- 不会杀掉占用端口的未知进程。
- 不会自动使用未经验证的 Godot AI 新版本。

## 卸载

先在插件界面卸载 Godot Creator preset，再删除插件：

```bash
dsh plugin --profile web remove dsh-godot-ai
```

如果先删除 npm 包，磁盘上的 Creator preset 会因为找不到 `dsh-godot-ai/agent` 而损坏。

## 开发与测试

```bash
pnpm check
pnpm test
pnpm build
pnpm test:live
```

`test:live` 会走真实的 `uvx → godot-ai → DSH MCP Client → Code Mode` 路径，但只执行只读检查，不会修改 Godot 项目。

## 兼容性

| 组件 | 版本 |
| --- | --- |
| dsh-godot-ai | `0.5.0` |
| DeepSeek Harness | `>=0.1.0-rc.8 <0.2.0` |
| Node.js | `>=22.19.0` |
| Godot AI | `3.1.5` |
| Godot | `>=4.5`，推荐 `4.7` |

机器可读配置见 [`compatibility.json`](compatibility.json)。

## License

[MIT](LICENSE)。第三方来源和许可证见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
