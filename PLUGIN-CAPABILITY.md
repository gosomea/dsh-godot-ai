# 插件能力验证

当前验证对象：`dsh-godot-ai@0.7.0`、DSH `0.2.0-rc.2` 官方源码 Web、Godot AI `3.1.5`。旧版本三款游戏和 Adaptive 矩阵不作为本版本验收证据。

## 验证范围

- 单元与组件契约：兼容清单、一个声明式 preset、官方 PTC composition 一致性、技能优先级、市场签名/扫描/确认/更新/回滚、页面草稿与焦点行为。
- 类型和构建：直接使用 npm 的 DSH rc.2 开发依赖，不使用旧 rc8 类型或跳过插件自身类型错误。
- 正式安装：通过当前 DSH CLI 的 `plugin --profile ... add <tarball>` 安装打包产物，再检查合成配置和真实 Host。
- 运行行为：公开 registry 识别唯一 Godot 模式；会话绑定到独立测试工作区；真实原生 PTC 调用 `session_manage(op=list)`。
- 数据与隔离：完整 45 个 Godot SDK bindings、16 Skills、项目同名 Skill 覆盖；Standard 不出现 Godot 工具和 Persona。
- 浏览器：正常点击设置与市场标签页，检查加载、Addon 未连接提示、模式列表和创作台；不强制绕过 onboarding。
- 发布：npm 线上包与 GitHub 附件必须等于已测 tarball 的 SHA-256。

测试桥仅位于 `validation/`，不进入 npm 包；它只运行固定的只读 Godot 调用，不接受任意代码或项目修改。测试使用独立 DSH Home/profile/端口，日常 Web profile 不参与。

## 证据与重跑

[单元报告](validation/rc2-release/unit-report.json)、[运行报告](validation/rc2-release/runtime-report.json)和[发布报告](validation/rc2-release/release-report.json)记录各层的实际结果。迁移门禁由 [plan.json](docs/10-plans/godot-creator-rc2/plan.json)管理。

```bash
pnpm check
pnpm test
pnpm build
```

Host 重跑需要先通过正式 CLI 在隔离 profile 安装测试 tarball，并挂载 test-only probe：

```bash
DSH_GODOT_SMOKE_URL=http://127.0.0.1:<测试端口> \
DSH_GODOT_TEST_LOG=<本次隔离Host私有启动日志> \
node validation/rc2-smoke.mjs verify
```

启动日志包含本次 Host 的认证链接，必须留在本地权限受控目录；报告不记录 token 或模型凭据。不要把日常 profile 用作测试目录。

## 明确未覆盖

本次没有连接 Godot Addon，因此不声称编辑器写入、运行输入或完整游戏创作 E2E 通过；真实模型生成亦未重新测试。Godot AI 新版和 DSH alpha 支持需另行验证。静态单元测试和 Web 能力验证不等同于完整游戏验收。
