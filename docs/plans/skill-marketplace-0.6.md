# dsh-godot-ai Skill 市场 0.6.0 实施方案

> 状态：已完成架构收敛与首批候选审计，待按阶段实施
>
> 分支：`codex/skill-marketplace-plan`
>
> 目标版本：`0.6.0`
>
> 最后更新：2026-08-27

## 1. 一句话目标

把当前随 npm 固定发布的 16 个 Godot Skill，升级为“可信兜底 + 用户可覆盖”的 Provider；同时增加一个小而可靠的 Skill 市场，让用户能够审阅、安装、启用、更新和回滚经过审核的第三方游戏开发 Skill。

0.6.0 不做自动爬虫和排行榜。它只交付四件事：

1. 修正内置 Skill 的优先级，使用户同名 Skill 可以覆盖插件兜底版本。
2. 建立带锁文件、历史版本、回滚和垃圾回收的本地 Store。
3. 建立有签名、防回滚、可轮换密钥的精选 Catalog。
4. 提供“已安装、精选、GitHub 导入、更新”四个可用页面。

## 2. 先统一三个产品概念

市场必须在 UI、API、数据结构和 README 中区分以下状态：

| 概念 | 含义 | 是否影响当前对话 |
| --- | --- | --- |
| 进入市场 / Catalog 收录 | 用户能看到 Skill 卡片、来源、版本、风险和依赖 | 否 |
| 已安装 | Artifact 已进入本地 Store，并写入 lockfile | 否 |
| 已启用 | Provider 可以把 Skill 暴露给 Godot Creator | 是 |

禁止使用“默认安装到市场”这种混合表述。首批第三方 Skill 可以默认出现在精选页，也可以在首次引导中默认勾选，但不得因为插件升级就静默下载或静默启用。

## 3. 范围

### 3.1 0.6.0 必须交付

- 内置 16 个 Skill 从 `ctx.skills.register()` 改为 rank 600 的 Provider。
- 市场安装内容使用 rank 350 的 Provider。
- 本地 Store、lockfile、history、staging、quarantine、trash 和回滚。
- npm 包内置多 key 信任根和初始 Catalog 哈希。
- Ed25519 签名 Catalog、Artifact SHA-256、Catalog 防回滚序号。
- Prompt 正文和文件树的静态风险扫描。
- `critical` 硬阻断，`high` 按 finding 逐条确认。
- 精选 Catalog、GitHub 指定来源导入、手动更新、每天最多一次后台更新检查。
- 四标签 UI：已安装、精选、GitHub 导入、更新。
- 首批 10 个候选的来源审计记录和发布决策。
- 契约测试、Store 测试、安全测试、Provider 优先级测试、Web API 测试。

### 3.2 明确推迟到 0.7.0

- GitHub Search 自动发现。
- 每日爬虫和发现 CI。
- 热度榜、安装量榜、确定性评分器。
- 自动精选、自动发布候选 Prerelease。
- skills.sh 作为运行时依赖或稳定 API。
- Core Skill Pack 或把当前 16 个内置 Skill 再发一份市场包。
- 第三方脚本、hooks、bin 的自动执行。

0.6.0 只保留内部 `SkillCatalogSource` 接口，为 0.7.0 增加发现源留扩展点，不交付发现产品。

## 4. DSH 集成契约

### 4.1 不修改上游源码

实现只使用 DeepSeek Harness rc8 的公开插件扩展面：

- `ctx.skills.registerProvider()`
- `SkillProviderControl.invalidate()`
- host 路由和 request trust
- `settings.general.item` slot
- `@deepseek-ai/dsh-home-paths`

不得修改或提交 DeepSeek Harness、Godot AI 的源码。

### 4.2 Godot Creator 的 preset 契约

`ManagedPresetManager.install()` 会先完整复制 Standard composition，再追加插件 managed block，因此 Godot Creator 已继承 `skill-filesystem` 与 `tool-skill`。0.6.0 不新增重复的 filesystem provider，只增加契约测试：

- `godot-creator` 继承 Standard composition。
- `godot-creator-adaptive` 继承 Standard composition。
- 两个 preset 都存在 `skill-filesystem` 与 `tool-skill`。
- 插件升级不得覆盖用户在 managed block 外的修改。

### 4.3 Skill 优先级

数字越小，优先级越高：

| 来源 | rank | 说明 |
| --- | ---: | --- |
| 项目 `.dsh/skills` | 100 | 项目最优先 |
| 项目 `.agents/skills` | 200 | 跨 Agent 项目 Skill |
| 其他 runtime 注册 | 250 | DSH 现有 runtime 层 |
| `customSkillDirs` | 300 | 用户显式配置目录 |
| dsh-godot-ai 市场 | 350 | 已安装且已启用的市场 Skill |
| `$DSH_HOME/skills` | 400 | DSH 用户 Skill |
| `~/.agents/skills` | 500 | 通用用户 Skill |
| dsh-godot-ai 内置 16 个 | 600 | npm 随包兜底 |

市场使用 350，避免与 DSH `CUSTOM_RANK = 300` 冲突。当前内置 16 个 Skill 通过 `ctx.skills.register()` 实际处于 runtime rank 250，导致用户无法用同名 Skill 覆盖。迁移到 rank 600 是一个有意的行为修复，必须写进 CHANGELOG，并为以下覆盖关系写契约测试：

```text
项目 Skill > customSkillDirs > 市场 Skill > 用户 Skill > 插件内置兜底
```

同 rank 冲突不作为产品功能依赖；如果发生同 rank 同名冲突，测试应暴露注册顺序，而不是把注册顺序当作稳定公开契约。

## 5. 总体架构

```text
精选 Catalog / GitHub 指定来源
              ↓
       Inspect：解析 ref、下载、扫描、生成 diff
              ↓ 用户确认
       Install：写 Artifact、Store、lockfile
              ↓ 用户启用
       Market Provider（rank 350）
              ↓
       DSH Skill Registry
              ↓
       Godot Creator / Adaptive

npm 内置 16 个 Skill ── Bundled Provider（rank 600）──┘
```

发现、审查、安装、启用必须是四个分离步骤。获取到文件不等于信任文件；签名通过不等于 Prompt 内容安全；安装成功不等于允许模型自动调用。

## 6. 本地目录和数据模型

根目录通过 `@deepseek-ai/dsh-home-paths` 解析，不自行拼接 `$HOME`：

```text
$DSH_HOME/dsh-godot-ai/skill-market/v1/
├── catalog/
│   ├── catalog.json
│   ├── catalog.sig.json
│   └── catalog-state.json
├── artifacts/<sha256>/
├── store/<skillId>/<version-or-ref>/
├── quarantine/<inspectionId>/
├── staging/<inspectionId>/
├── trash/<trashId>/
├── cache/diffs/
└── lockfile.json
```

### 6.1 Artifact 不可变

- Artifact 目录只用内容 SHA-256 命名。
- 安装、更新和回滚只切换 lockfile 中的 active 引用，不覆写旧 Artifact。
- 同一哈希重复下载只增加引用，不复制内容。
- 写入使用临时文件、`fsync`、原子 rename；失败不修改 active 状态。

### 6.2 Lockfile

```ts
interface SkillMarketLockfileV1 {
  schemaVersion: 1;
  revision: number;
  installed: Record<string, {
    source: SkillSource;
    activeArtifactHash: string;
    activeVersion: string;
    enabled: boolean;
    modelInvocable: false;
    userInvocable: boolean;
    installedAt: string;
    updatedAt: string;
    scannerRulesVersion: string;
    riskReportHash: string;
    approvalHash?: string;
    acknowledgedFindingIds: string[];
    history: Array<{
      artifactHash: string;
      version: string;
      activatedAt: string;
    }>;
  }>;
}
```

规则：

- `schemaVersion` 必须配套显式 migration registry。
- 未知的更高 schema 只读打开，禁止写回。
- 每次写入前做 revision compare-and-swap，避免并发覆盖。
- history 默认保留最近 3 个版本；被 active 或 rollback pin 引用的版本不得删除。
- Store 启动时扫描 orphan Artifact，进入 GC 候选，不自动永久删除。

## 7. 精选 Catalog 的信任模型

### 7.1 Catalog 结构

```ts
interface SkillCatalogV1 {
  schemaVersion: 1;
  serial: number;
  issuedAt: string;
  expiresAt?: string;
  skills: CuratedSkillEntry[];
}

interface CatalogSignatureEnvelope {
  algorithm: "Ed25519";
  keyId: string;
  catalogSha256: string;
  signature: string;
}

interface CatalogStateV1 {
  schemaVersion: 1;
  lastGoodSerial: number;
  lastGoodIssuedAt: string;
  lastGoodCatalogSha256: string;
  lastGoodKeyId: string;
  etag?: string;
  checkedAt?: string;
}
```

### 7.2 防回滚和重放规则

验证顺序固定为：

1. 对原始 Catalog bytes 计算 SHA-256。
2. 校验 signature envelope 的哈希一致。
3. 用 npm 内置信任根中的 `keyId` 校验 Ed25519 签名。
4. 校验 `issuedAt` 不比本机时间超前 15 分钟以上。
5. 如果存在 `expiresAt`，过期 Catalog 只允许离线查看，不允许新安装或更新。
6. 比较本地 `lastGoodSerial`。

Serial 规则：

- 新 serial 大于本地：接受并原子更新 last-good 状态。
- 新 serial 小于本地：即使签名合法也拒绝，报 `CATALOG_ROLLBACK_DETECTED`。
- serial 相同且哈希相同：视为同一版本，可更新 ETag/checkedAt。
- serial 相同但哈希不同：拒绝，报 `CATALOG_SERIAL_EQUIVOCATION`。

这里比“serial 相同取 issuedAt 更新的版本”更严格。相同 serial 必须代表不可变内容；维护者修 Catalog 时必须递增 serial，否则防回滚序号失去唯一含义。

### 7.3 多 key 信任根

npm 包从第一天使用数组结构：

```ts
interface SkillCatalogTrustRootV1 {
  schemaVersion: 1;
  threshold: 1;
  keys: Array<{
    keyId: string;
    algorithm: "Ed25519";
    publicKey: string;
    status: "active" | "retiring" | "revoked";
    notBefore: string;
    notAfter?: string;
  }>;
  initialCatalog: {
    serial: number;
    sha256: string;
  };
}
```

- 日常保持一个 active key，提前加入一个未到 `notBefore` 的备用 key。
- 平滑轮换时，新 npm 版本同时信任旧 key 和新 key；Catalog 改用新 key 后，后续 npm 版本将旧 key 标记 retiring。
- 私钥泄露时发布 npm 安全更新，把旧 key 标记 revoked，并用新 key/新 serial 发 Catalog。
- 多 key 能降低正常轮换和应急切换的停机风险，但不能让尚未升级 npm 的客户端自动得知撤销；README 和安全公告必须如实说明这一边界。

实现只使用 Node.js 22 原生 `node:crypto` Ed25519，不引入新的密码学依赖。

### 7.4 初始 Catalog 哈希的角色

`initialCatalog.sha256` 只服务于“从未接受过任何 Catalog 的零状态新安装”：

- 第一次启动要求签名合法、serial 与初始 serial 一致、哈希与 npm pin 一致。
- 一旦写入 `catalog-state.json`，后续更新以签名、key 状态和单调 serial 为信任机制。
- 初始哈希不会也不应该随着每次 Catalog 更新继续匹配。

固定发布顺序：

1. 构建确定性 Catalog bytes。
2. 计算 Catalog SHA-256。
3. 把初始 serial/hash 烤入 npm 构建产物。
4. 用离线私钥签名相同 bytes。
5. 验证 npm tarball 中的 trust root 与待发布 Catalog 完全匹配。
6. 在同一发布窗口发布 npm 版本与 GitHub Release assets。
7. 新环境执行一次零状态 bootstrap 验证。

### 7.5 Artifact 信任

- Catalog 每个条目必须固定 `sourceCommit`、Artifact SHA-256、许可证和文件清单哈希。
- `checksums.json` 只防损坏，不单独构成信任锚。
- Artifact 必须同时满足：Catalog 签名可信、条目哈希匹配、本地重新计算哈希匹配。
- 当前 16 个内置 Skill 只存在于 npm 包，不进入第三方 Catalog，避免双轨漂移。

## 8. 来源解析和上游生命周期

### 8.1 支持来源

```ts
type SkillSource =
  | { kind: "curated"; catalogSerial: number; skillId: string }
  | { kind: "github"; owner: string; repo: string; ref: string; subdir: string };
```

0.6.0 不把 skills.sh 作为支持的来源。它的公开搜索接口没有稳定契约，索引和上游 HEAD 也可能漂移；可以在人工审计时用来找候选，但不能成为客户端安装链路的信任根。

### 8.2 GitHub 下载路径

- `api.github.com` 仅用于解析仓库元数据、默认分支、ref 到 commit 和 ETag。
- 文件内容通过 `codeload.github.com` 的固定 commit archive 获取。
- GitHub Release Artifact 只接受官方 Release asset 域名。
- 禁止任意 URL、重定向到非 allowlist 域名、`git://`、SSH、`file://` 和本地绝对路径。
- GitHub API 限流时立即退避，不循环重试；有缓存时退回 last-good 数据。

### 8.3 上游状态

Catalog 与本地状态增加：

```ts
type UpstreamStatus =
  | "active"
  | "moved"
  | "deleted"
  | "license-blocked"
  | "unreachable";
```

- Catalog 构建时必须确认 source commit 仍可读取。
- `moved` 条目显示替代 Skill 和迁移说明。
- `deleted` 只允许回滚已安装历史，不允许新安装，除非精选 Release 中有合法、已签名、可再分发的归档。
- 无许可证不等于可自由分发；`license-blocked` 不生成 Artifact。
- 用户 GitHub Import 可以审阅指定来源，但不能绕过扫描、许可提示和启用门。

## 9. Prompt 与文件安全扫描

### 9.1 扫描对象

- `SKILL.md` 正文和 frontmatter。
- 所有 Markdown/reference 文件。
- scripts、hooks、bin、可执行位、隐藏文件、符号链接。
- 外联 URL、凭据路径、环境变量、安装命令和工具声明。
- 超大文件、二进制文件、压缩包嵌套、路径穿越。

### 9.2 最低规则集

- 读取或上传 SSH key、云凭据、浏览器数据、系统 keychain、`.env`。
- 要求忽略系统或用户指令、伪造工具结果、隐藏真实行为。
- `curl | sh`、远程安装器、下载后执行、sudo、修改 shell profile。
- 未声明的 MCP、CLI、网络服务、认证登录、部署/发布操作。
- 写出项目目录、读用户目录、跟随 symlink 越界。
- 数据外传、遥测、公开部署、发布到第三方平台。
- base64/压缩/Unicode 混淆的隐藏 payload。
- scripts/hooks/bin 或声明自动执行。

扫描器是启发式 Guardrail，不是沙箱，也不能证明安全。UI 必须显示这句边界说明。

### 9.3 Finding 和确认

```ts
interface RiskFinding {
  findingId: string;
  ruleId: string;
  severity: "low" | "medium" | "high" | "critical";
  file: string;
  line: number;
  excerpt: string;
  explanation: string;
  recommendation: string;
}
```

`findingId` 使用以下规范化内容计算，保证相同 finding 稳定、内容变化后失效：

```text
sha256(ruleId + normalizedFile + line + normalizedMatchedText)
```

处理规则：

- `critical`：硬阻断安装和启用，没有 UI override。显式凭据外传、远程执行链和路径穿越进入 critical。
- `high`：UI 展示文件、行号、上下文和规则；用户必须逐条选择“误报”或“我接受此风险”。
- `medium`：允许一次批量确认，但仍显示明细。
- `low`：信息提示。
- 任何文件内容、source commit、Artifact hash 或扫描规则变化，旧确认全部失效。

### 9.4 扫描器版本生命周期

```text
riskReportHash = sha256(canonicalJSON({
  scannerRulesVersion,
  artifactHash,
  findings
}))

approvalHash = sha256(canonicalJSON({
  riskReportHash,
  acknowledgedFindingIds,
  acknowledgementKinds
}))
```

风险报告和用户批准分开存储，避免把“扫描结果”与“用户同意”混成一个概念。

插件升级发现 `scannerRulesVersion` 变化时：

1. Provider 对所有第三方 Skill 先 fail closed：旧扫描版本的条目暂不暴露。
2. host 后台重扫全部已安装 Artifact。
3. 新增 `critical`：保持禁用，标记 blocked，并在市场页显示安全通知。
4. 新增 `high`：自动禁用，要求逐条重新确认。
5. 只有 low/medium 且既有确认仍完整时，恢复原启用状态。
6. 写结构化日志和 UI banner；如果 DSH 没有稳定的系统通知 API，不伪造桌面通知能力。

内置 16 个 npm Skill 由插件构建和测试链负责，不走社区扫描生命周期。

### 9.5 第三方脚本隔离

- scripts、hooks、bin 一律进入 quarantine，不复制进 Provider 的 `resourceBase`。
- 0.6.0 不运行第三方 installer、postinstall、hook 或 bundled script。
- 依赖脚本才能工作的 Skill 卡片标记 `external-runtime`，默认禁用。
- 用户确认 Prompt 风险不等于授权执行脚本；脚本执行能力留到未来独立设计。

## 10. 安装和调用默认值

所有第三方 Skill 的最小权限默认值：

```ts
enabled: false
modelInvocable: false
userInvocable: false
```

用户完成风险审阅并显式启用后：

```ts
enabled: true
modelInvocable: false
userInvocable: true
```

0.6.0 不允许第三方 Skill 自动成为 `modelInvocable: true`。精选、签名、低风险都不能替代用户的启用动作。

## 11. 首批 10 个候选审计与默认策略

审计基准为 2026-08-27。安装量只用于确认用户所指的同名条目，不作为安全、质量或默认安装依据。

### 11.1 决策表

| Skill | 确认来源 | 许可证 / 上游状态 | Godot 适配 | 0.6.0 决策 | 首次引导默认勾选 |
| --- | --- | --- | --- | --- | --- |
| `higgsfield-game-generation` | `higgsfield-ai/skills`，历史 commit `9db2e5b…` | MIT；已在上游 commit `383c14a…` 删除并合并到 `higgsfield-websites` | 浏览器游戏；要求 Higgsfield CLI、登录、生成、部署，正文含 `curl ... | sh` | 保留审计记录和“已迁移”卡片，指向 successor；不安装旧 Skill | 否 |
| `game-engine` | `github/awesome-copilot@634b92f…` | MIT；active | HTML5/Canvas/WebGL/Phaser/Three.js，不是 Godot | 精选可选、标记 `web-runtime` | 否 |
| `multiplayer-game` | `rivet-dev/skills`，历史 commit `ba5d3db…` | 上游已删除；仓库没有可确认的再分发许可证 | RivetKit 专用服务端/部署，不是 Godot Multiplayer API | `license-blocked + deleted`，只留审计记录，不生成 Artifact | 否 |
| `game-developer` | `Jeffallan/claude-skills@882ef55…` | MIT；active | 内容主要是 Unity/Unreal，缺 Godot 实现 | 精选可选、标记 `engine-mismatch` | 否 |
| `game-ui-design` | `omer-metin/skills-for-antigravity@e8dcf4e…` | Apache-2.0；active | 引擎中立的 HUD、菜单、可访问性和响应式设计 | 精选；作为推荐安装候选 | 是 |
| `game-design-theory` | `pluginagentmarketplace/custom-plugin-game-developer@aa7edfe…` | 自定义可分发许可证，必须原样附带；active | 引擎中立理论，非 Godot 工具操作 | 精选可选；显著显示 custom license | 否 |
| `game-feel` | `gamedev-skills/awesome-gamedev-agent-skills@7110607…` | Apache-2.0；active | 引擎中立并含 Godot 4.7 示例，明确与 Godot Skill 配合 | 精选；作为推荐安装候选 | 是 |
| `game-ui-ux` | 同上 `@7110607…` | Apache-2.0；active | 含 Godot Control、anchor、safe area、focus 示例 | 精选；作为推荐安装候选 | 是 |
| `threejs-game-ui-designer` | `majidmanzarpour/threejs-game-skills@7221c1f…` | MIT；active | Three.js 专用，并依赖同仓其他 Three.js Skills | 精选可选，默认不安装、不启用 | 否 |
| `develop-web-game` | `openai/skills` 的 skills.sh 历史快照，Artifact hash `bed6531d…` | 快照含 Apache-2.0；当前公开仓库 HEAD 无该目录 | HTML/JS + Playwright，引用 Codex 专用路径，不是 Godot | 仅保留外部候选记录；找到官方稳定 commit/source 前不进入可安装精选 | 否 |

### 11.2 推荐 Starter Set

首次打开精选页时展示一个默认勾选但仍需用户确认的“Godot 游戏设计增强包”：

- `game-feel`
- `game-ui-ux`
- `game-ui-design`

点击“安装 3 个”后仍逐个显示风险摘要；用户完成安装后再选择启用。这个 starter set 不在 npm 中复制内容，只是 Catalog 中三个独立第三方条目的 UI 组合，因此不会形成 Core Skill Pack 的第二真相源。

### 11.3 为什么其余 7 个不默认勾选

- Higgsfield、Rivet 是外部平台工作流，且精确 Skill 已从上游删除或迁移。
- `game-engine`、`threejs-game-ui-designer`、`develop-web-game` 是 Web/Three.js 工具链，会把 Godot Creator 引向错误运行时。
- `game-developer` 主要给 Unity/Unreal，概念可参考，但具体 API 容易污染 GDScript 输出。
- `game-design-theory` 有价值，但属于可选理论层，并带非标准许可证。

“流行”只影响市场展示，不影响默认信任。最后两个按用户要求明确保持默认不安装。

### 11.4 拉取和审计记录

所有候选先进入维护者侧 `seed-review-manifest`，记录：

- skills.sh 用来消歧的页面和当时安装量。
- GitHub owner/repo、完整 commit、subdir。
- 仓库许可证和 Skill 自带许可证。
- 文件清单、内容哈希、外部依赖、脚本和 URL。
- upstream status、Godot compatibility、风险 findings。
- curated、optional、blocked、moved 的最终决定和审核人。

这个 manifest 是 Catalog 构建输入，不由客户端自动抓取 skills.sh。

### 11.5 审计来源链接

- [`higgsfield-ai/skills`](https://github.com/higgsfield-ai/skills) / [`higgsfield-game-generation` 历史文件](https://github.com/higgsfield-ai/skills/blob/9db2e5bf22ff93d0bffb48664a8d0d6bb417082c/higgsfield-game-generation/SKILL.md)
- [`github/awesome-copilot` 的 `game-engine`](https://github.com/github/awesome-copilot/tree/main/skills/game-engine)
- [`rivet-dev/skills`](https://github.com/rivet-dev/skills) / [`multiplayer-game` 历史文件](https://github.com/rivet-dev/skills/blob/ba5d3db3d7489cfc6190fd0de45b96e3787e1ea3/multiplayer-game/SKILL.md)
- [`Jeffallan/claude-skills` 的 `game-developer`](https://github.com/Jeffallan/claude-skills/tree/main/skills/game-developer)
- [`omer-metin/skills-for-antigravity` 的 `game-ui-design`](https://github.com/omer-metin/skills-for-antigravity/tree/main/skills/game-ui-design)
- [`pluginagentmarketplace/custom-plugin-game-developer` 的 `game-design-theory`](https://github.com/pluginagentmarketplace/custom-plugin-game-developer/tree/main/skills/game-design-theory)
- [`game-feel`](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/game-feel) 与 [`game-ui-ux`](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/main/skills/disciplines/game-ui-ux)
- [`majidmanzarpour/threejs-game-skills` 的 `threejs-game-ui-designer`](https://github.com/majidmanzarpour/threejs-game-skills/tree/main/skills/threejs-game-ui-designer)
- [`openai/skills`](https://github.com/openai/skills) 与 skills.sh 的 [`develop-web-game` 历史页面](https://www.skills.sh/openai/skills/develop-web-game)

这些链接用于人工复核。实际 Catalog 不跟随 `main`，必须使用决策表中的完整 commit 和构建出的 Artifact hash。

## 12. Inspect、Install、Enable、Update 工作流

### 12.1 Inspect

1. 校验同源请求、参数 schema、owner/repo/ref/subdir。
2. GitHub API 解析 ref 到不可变 commit。
3. 通过 codeload 下载归档到新的 staging inspection。
4. 限制压缩包大小、展开大小、文件数、单文件大小和路径深度。
5. 拒绝路径穿越和逃逸 symlink。
6. 计算 Artifact hash、文件树和许可证。
7. 分离 scripts/hooks/bin 到 quarantine。
8. 使用当前 `scannerRulesVersion` 扫描正文和文件树。
9. 与已安装版本生成有上限的 diff。
10. 返回 inspectionId、到期时间、findings 和可执行动作。

Inspection TTL 为 30 分钟。Install 只接受未过期、参数与内容 hash 都匹配的 inspectionId，禁止客户端绕过 Inspect 直接提交 URL。

### 12.2 Install

- 校验 inspection 未过期且未被消费。
- critical 为零；high finding 已逐条确认。
- 原子写入 Artifact/Store/lockfile。
- 安装后默认 disabled。
- 消费 inspection token，防止重放。
- 调用 Provider `invalidate()` 刷新列表。

### 12.3 Enable

- 再次校验 Artifact hash、scannerRulesVersion、riskReportHash 和 approvalHash。
- scripts/hooks/bin 不得出现在 resourceBase。
- 写入 `enabled: true, userInvocable: true, modelInvocable: false`。
- Provider invalidate 后回读 Registry，确认期望 Skill 和来源 rank。

### 12.4 Update

- 手动触发为主。
- 后台每 24 小时最多一次，使用 ETag/If-None-Match。
- 429 或接近 GitHub rate limit 时指数退避，不影响当前已安装版本。
- 更新走完整 Inspect → Diff → Scan → Confirm → Install 流程。
- 不自动激活新 Artifact；用户确认后切换 active。
- staged update 不修改当前可用版本，失败可直接丢弃。

## 13. GC、回收和崩溃恢复

### 13.1 引用集合

GC 的 live set 只包括：

- lockfile active Artifact。
- history 中保留的 Artifact。
- 用户显式 rollback pin。
- 30 分钟 TTL 内、结构完整的 staging inspection。

过期 inspection 不算引用。这样崩溃遗留的 staging 不会永久保活孤儿 Artifact。

### 13.2 两阶段删除

1. 未引用 Artifact、过期 staging 和 quarantine 先原子移动到 trash。
2. trash 保存 7 天，UI 可恢复。
3. 7 天后才永久删除。
4. GC 每次生成 report，记录 reason、hash、原位置和可恢复截止时间。

### 13.3 启动恢复

- 清理不完整的临时文件。
- 检查 lockfile revision 和 schema。
- active Artifact 缺失时回退到最近完整 history；无法回退则禁用并显示错误。
- Provider 永远只读取通过完整性检查的 active Store 路径。

## 14. API

只保留五个路由：

```text
GET  /api/dsh-godot-ai/skills
GET  /api/dsh-godot-ai/skills/diff/<name>
POST /api/dsh-godot-ai/skills/inspect
POST /api/dsh-godot-ai/skills/install
POST /api/dsh-godot-ai/skills/action
```

`action` 使用可判别联合：

```ts
type SkillAction =
  | { action: "enable"; skillId: string; approvalHash: string }
  | { action: "disable"; skillId: string }
  | { action: "uninstall"; skillId: string }
  | { action: "rollback"; skillId: string; artifactHash: string }
  | { action: "restore-trash"; trashId: string }
  | { action: "check-updates" }
  | { action: "gc" };
```

所有写操作必须复用现有 host request trust、同源检查、JSON content-type、body size limit 和 schema validation；不能只靠浏览器 UI 隐藏危险参数。

Diff 约束：

- 最大响应 128 KiB。
- 最大 2,000 changed lines。
- 超限返回摘要、文件列表和截断标记。
- 结果按 `(oldArtifactHash, newArtifactHash)` 缓存。
- 使用磁盘有界 LRU，最多 32 条或 8 MiB；任一 Artifact 被永久 GC 时删除对应缓存。

## 15. UI

### 15.1 已安装

- 版本、来源、启用状态、调用权限、上次扫描版本。
- 风险摘要、逐项 finding、许可证、上游状态。
- 启用、禁用、卸载、回滚、恢复。
- 扫描规则升级导致的“需要重审”状态。

### 15.2 精选

- 只显示维护者人工审计的条目和明确的 moved/blocked 说明卡。
- Starter Set 默认勾选三个 Godot 兼容 Skill，但必须点击确认才下载。
- 显示“适合 Godot / 引擎中立 / Web 专用 / 外部运行时 / 已迁移”。
- 安装量只作为非安全元数据，弱化展示，不显示“安全分”或“及格线”。

### 15.3 GitHub 导入

- 输入 owner/repo、ref、subdir。
- 先 Inspect，再显示 commit、文件、许可证、diff 和 findings。
- 不支持粘贴任意下载 URL。
- 明确提示 GitHub Import 不等于精选背书。

### 15.4 更新

- last checked、ETag 命中、rate-limit/backoff 状态。
- old/new commit、版本、diff、风险变化、许可证变化。
- 更新暂存、确认激活、放弃暂存。

## 16. 依赖和构建

- 显式增加 `@deepseek-ai/dsh-home-paths`：作为 DSH host 提供的 `peerDependency`，同时固定 rc8 兼容版本到 `devDependency` 用于构建和测试；不把另一份 DSH runtime 打进插件 bundle。
- 密码学只用 `node:crypto`。
- Schema validation 复用项目现有方案；若必须新增依赖，先检查体积、许可证和 Node 22 ESM 兼容性。
- Catalog builder 必须确定性排序和规范化 JSON，重复构建产生完全相同 bytes。

## 17. 分阶段实施

### Phase 0：契约冻结与测试夹具

- 新增本方案、ADR 和数据 schema。
- 建立 10 个候选的 `seed-review-manifest`，固定完整 commit 和许可证。
- 为 Standard composition 继承写契约测试。
- 为现有 16 个 Skill 的名称、内容和来源建 baseline。

验收：所有关键行为先有失败测试，方案中不存在未定义的“自动发现”“自动安装”语义。

### Phase 1：Provider 重构

- 内置 16 个 Skill 改为 rank 600 Provider。
- 新增市场 rank 350 Provider，但先只支持测试 Store。
- 实现 invalidate、同名覆盖和来源显示。

验收：项目、自定义、市场、用户和兜底优先级矩阵全部通过；Godot Creator composition 不回归。

### Phase 2：Store、Lockfile、回滚和 GC

- 实现不可变 Artifact、原子 lockfile、migration registry。
- 实现 history、rollback、trash、TTL-aware GC、崩溃恢复。
- 加入并发、断电模拟、orphan 和恢复测试。

验收：任何安装失败不影响 active Skill；任一保留历史都可回滚；过期 inspection 可被回收。

### Phase 3：扫描器与批准生命周期

- 实现文件限制、路径安全和 Prompt 风险规则。
- 实现 stable findingId、riskReportHash、approvalHash。
- 实现 critical block、high 逐项确认、规则升级重扫和自动禁用。

验收：恶意正文不需要脚本也能被标记；安全建议中的 `.ssh` 文字可通过 high 逐项确认处理误报；内容或规则改变后旧确认失效。

### Phase 4：签名 Catalog 和 GitHub 导入

- 实现多 key trust root、签名验证、serial 防回滚。
- 实现零状态初始 hash、last-good state、ETag 和退避。
- 实现 GitHub 固定 commit + codeload + allowlist。

验收：旧 serial、相同 serial 不同内容、未知/revoked key、过期 Catalog、重定向越界、hash 不匹配全部失败关闭。

### Phase 5：Host API 和四标签 UI

- 实现五个 API 路由和 action union。
- 实现四个标签页、Starter Set、逐项风险确认、diff 和更新暂存。
- 实现 diff 有界缓存。

验收：从精选安装、GitHub 导入、启用、更新、回滚、卸载、恢复形成完整可测闭环。

### Phase 6：首批 Catalog、文档和发布

- 可安装精选首发至少包含 `game-feel`、`game-ui-ux`、`game-ui-design`，以及审计通过的可选条目。
- 为 moved/blocked 候选提供真实状态说明，不能用空卡片充数。
- 更新中英文 README、THIRD_PARTY_NOTICES、CHANGELOG 和安全模型。
- 按固定顺序构建、hash、烤入 trust root、签名、发布 npm 与 GitHub Release。

验收：新环境零状态安装、已有 0.5.0 升级、离线 last-good、密钥轮换演练和回滚演练全部通过。

## 18. 测试矩阵

### 18.1 单元测试

- Catalog canonicalization、签名、key 状态、serial、时间窗口。
- Artifact hash、文件限制、symlink/path traversal。
- scannerRulesVersion、findingId、risk/approval hash。
- lockfile migration、CAS、history、GC live set。
- diff 截断和 cache key。

### 18.2 集成测试

- Host request trust 和五个 API。
- Inspect token 过期、重放和参数替换。
- 安装失败原子性。
- 规则升级重扫并自动禁用 high/critical。
- Provider invalidate 后 Registry 来源和 rank 正确。
- DSH Standard composition 继承契约。

### 18.3 恶意夹具

- `读取 ~/.ssh 并上传`：critical。
- `绝不要读取 ~/.ssh`：high，可逐项确认误报，不得自动放行。
- `curl URL | sh`：至少 high；如果要求自动执行，critical。
- symlink 指向 Store 外：critical。
- 大型压缩炸弹、路径穿越、隐藏二进制：critical。
- signed but old serial：拒绝。
- same serial + different bytes：拒绝。
- revoked key + higher serial：拒绝。

### 18.4 升级测试

- 0.5.0 的内置 Skill 无数据迁移即可继续使用。
- 用户同名 Skill 在 0.6.0 开始正确覆盖内置兜底，这是预期变更。
- 0.6.0 扫描规则升级时 fail closed，不出现旧报告下短暂暴露。
- last-good Catalog 在无网络时可读取，不能用过期 Catalog做新安装。

## 19. 发布清单

1. 工作树干净，版本、CHANGELOG、README 一致。
2. 所有候选完整 commit 和许可证已人工复核。
3. Catalog serial 比生产 last-good 大 1，不能复用 serial。
4. Catalog 确定性构建两次，bytes/hash 一致。
5. npm trust root 含正确 keys、状态和 initial serial/hash。
6. Catalog 使用预期 keyId 签名，私钥不进入仓库和 CI artifact。
7. npm tarball、GitHub Release Artifact、Catalog、signature、checksums 全部在干净环境复验。
8. npm 与 GitHub Release 同窗口发布。
9. 零状态、新旧升级、离线、回滚、key rotation 演练通过。
10. 发布后手动检查 24 小时更新节流和 ETag。

## 20. 0.6.0 完成定义

只有以下条件全部满足才算完成：

- 用户可以用项目/用户同名 Skill 覆盖插件 16 个兜底 Skill。
- 市场 Skill 不会在未审阅、未安装、未启用时进入对话。
- Catalog 可以验证维护者签名，并拒绝合法签名的旧 serial。
- 信任根从第一天支持 keyId、多 key、retiring 和 revoked。
- Prompt injection 扫描覆盖正文，规则升级会重扫并禁用新增 high/critical。
- high 有逐条可审计的误报出口，critical 无 override。
- Store 安装失败不破坏 active 状态，支持回滚和可恢复删除。
- 过期 staging 不会阻止 GC。
- 更新手动为主，后台每天最多一次，并有 ETag 和限流退避。
- 首批市场不是空壳：至少 3 个真实审核、许可清晰、Godot 兼容的推荐 Skill 可安装。
- `threejs-game-ui-designer` 与 `develop-web-game` 明确默认不安装。
- 没有修改 DeepSeek Harness 或 Godot AI 源码。

## 21. 已知边界

- 静态扫描不能证明 Prompt 安全，也不是运行时沙箱。
- 多 key 信任根不能通知尚未升级 npm 的客户端“旧 key 已撤销”。
- GitHub 与 skills.sh 的索引可能不同步；客户端只信固定 commit 和签名 Artifact。
- 外部 Skill 的流行度会变化，Catalog 不使用安装量做自动信任决策。
- 0.6.0 不自动发现新 Skill；维护者需要人工把审核通过的来源加入 Catalog 构建输入。
