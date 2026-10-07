---
description: "Read, build, and verify Godot games in DeepSeek Harness with one Godot Creator mode and a game-development Skill market."
kind: "package-bundle"
---

# dsh-godot-ai

[中文](README.md) | English

## Summary

Add **Godot Creator**, a dedicated game-making mode, to DeepSeek Harness. Describe your gameplay and the AI uses the original [Godot AI](https://github.com/hi-godot/godot-ai) to build scenes, edit scripts, make UI, run the game, and check results in the open editor. The plugin also provides a workspace panel, 16 Godot Skills, three workflows, and a third-party Skill market. You must manually install and enable the Godot AI Addon in each target project.

Version `0.7.0` supports DSH `0.2.0-rc.2` Web, not legacy rc8. All capabilities belong to one `godot-creator` preset; there is no Adaptive mode.

## Table of Contents

- [Install and start](#install-and-start)
- [What you can do](#what-you-can-do)
- [What is the preset based on](#what-is-the-preset-based-on)
- [Skills and updates](#skills-and-updates)
- [Implementation](#implementation)
- [Model experience](#model-experience)
- [Limitations and validation](#limitations-and-validation)
- [Development](#development)

## Install and start

### 1. Prerequisites

Use DSH `0.2.0-rc.2` Web, Node.js `22.19+` on the 22.x line or `24+` (not Node 23), and `uvx`. Godot minimum is `4.5`, recommended `4.7+`; the backend stays pinned to verified Godot AI `3.1.5`.

First check:

```bash
uvx --version
```

### 2. Install or update the plugin

Use the same profile as your Web instance. The local `dsh-web` launcher uses `web-rc2`:

```bash
dsh plugin --profile web-rc2 add dsh-godot-ai@0.7.0
```

If your global `dsh` is older than the source checkout, run its matching CLI from the newer DSH directory:

```bash
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web-rc2 add dsh-godot-ai@0.7.0
```

Restart your original Web command when ongoing tasks finish. Godot Creator appears automatically in the Agent preset list: **no separate mode-install button** and no copied user-directory preset.

If selection is hidden, enable “Show code work view” in settings and open Agent presets. You can also make Godot Creator the default for new sessions.

### 3. Enable the Addon in Godot

1. Open the target project in Godot.
2. Search AssetLib for **Godot AI** and install the backend-compatible `3.1.5` Addon.
3. Open **Project → Project Settings → Plugins** and enable Godot AI.
4. Keep the project open in the editor.

If AssetLib only offers a newer version, use `addons/godot_ai` from the matching [v3.1.5 source](https://github.com/hi-godot/godot-ai/tree/v3.1.5). Do not mix an unverified new Addon with the old backend. The plugin does not automatically write to your project. Installation guidance and connection diagnostics are in the Godot AI settings card.

### 4. Start creating

Create a session and select **Godot Creator**. Open the workspace panel in the header and check the connection and target project; resolve multiple projects first. For example:

```text
创建一个 480×720 的 2D 躲避游戏。
玩家可以左右移动和跳跃，碰到障碍后重生，走到终点显示胜利，
并提供重新开始按钮。完成后运行游戏，检查日志和画面。
```

The “2D skeleton”, “3D playable prototype”, and “Menus and HUD” shortcuts only fill an empty composer. They neither send automatically nor overwrite an existing draft.

## What you can do

- Create and edit scenes, nodes, GDScript/C# scripts, resources, signals, and input settings.
- Build UI, animation, materials, shaders, particles, audio, cameras, and environments.
- Run games and inspect scene trees, status, errors, warnings, logs, and images; simulate input where the tools support it.
- Work through “read → small mutation batch → read-back → run → verify” and recover from the last verified stage.
- Check project, Addon, backend, and version status; review, install, update, and roll back third-party knowledge.

The original Godot AI owns editor operations. This plugin supplies DSH composition, conversation guidance, knowledge, workflows, and UI; it does not replace the engine or guarantee a complete game from one sentence.

## What is the preset based on

It neither copies Minimal nor copies a user-directory Standard preset. The current declaration derives from the **official DSH 0.2.0-rc.2 Web PTC composition**, adding Godot guidance, MCP, and Skill providers.

Files, shell, search, Skills, planning, goals, compaction, and verification remain available. Native PTC reduces direct model calls to `run_code`, focusing orchestration without removing engineering tools. DSH Standard, Minimal, and other built-in presets are unchanged.

Upgrading from `0.6.0` also requires upgrading DSH. Use Godot Creator for new sessions. Lossless recovery of legacy `godot-creator-adaptive` sessions is not promised. Legacy user preset files are not automatically deleted; back up configurations and sessions first.

## Skills and updates

The 16 bundled Godot Skills are offline fallbacks updated with npm releases. Their bodies load on demand, not wholesale into every prompt. Project and user Skills can override same-name fallbacks under DSH scope and rank rules; see [Skill sources](skills/README.md).

The third-party market retains four tabs: Installed / Curated / GitHub import / Updates:

- Download pinned commits and review content, differences, licenses, and risks before installation. Third-party scripts and installers never run.
- New installations are disabled. Enabled third-party Skills remain user-invocable only, not automatically model-invocable.
- Critical findings block installation; high/medium findings require individual confirmation. Static scanning is not a sandbox or proof of safe content.
- Catalogs use Ed25519 signatures, multiple trust keys, anti-rollback serials, and an initial hash. Signatures do not endorse content safety.
- Manual checks are primary; background checks run at most daily. Updates require fresh review and retain up to three historical versions.

Market data lives in `$DSH_HOME/dsh-godot-ai/skill-market/v1`, not the plugin directory. Candidates are not default installations: Three.js and web-game Skills remain non-default, and unacceptable license or risk status blocks installation. See [third-party notices](THIRD_PARTY_NOTICES.md).

Update the plugin with the same installation command targeting the new version, then restart DSH. New Godot AI releases appear as pending verification; neither the backend nor Addon updates automatically.

## Implementation

<details>
<summary>Implementation details for contributors</summary>

[cordis.patch.yml](cordis.patch.yml) declares one Host plugin and one Godot Creator preset. Its Agent plugin mounts the Persona, Skills, and Godot AI MCP. The Host provides read-only preset status, integration diagnostics, and market management; the Client contributes settings and header UI. Mode identity uses current session projections, and tools use official `dsh-agent-tool-presentation` with `ptc`.

The composition is pinned to the official rc.2 PTC file and checked by a contract test. Upstream updates do not silently rewrite user sessions; later DSH versions require fresh adaptation and verification. No DSH source changes, tool-name patches, or custom first-turn routing state machine are required.

</details>

## Model experience

The model directly sees `run_code` and the generated TypeScript SDK for Godot and engineering tools. Creator guidance requires target-project confirmation, on-demand Skill loading, sequential dependent mutations, batch read-back, and concise results. Third-party Skills still require explicit user invocation.

## Limitations and validation

Checks cover TypeScript, unit/component contracts, tarball installation, real rc.2 Web mounting, 45 Godot bindings, 16 Skills, project Skill overrides, native PTC read-only execution, and Standard isolation; see [capability evidence](PLUGIN-CAPABILITY.md).

No Godot Addon was connected during this release's validation. Three complete games and real-model generation were not re-tested, so game-creation E2E is not claimed. Earlier game evidence belongs to historical versions. Godot AI `4.x` and DSH `0.2.1-alpha` are unverified. Resolve missing `uvx`, editor, or compatible backend diagnostics before proceeding.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm build
```

Test the packed artifact before publishing the same tarball, then compare local, npm, and GitHub SHA-256 values. See the [0.7.0 plan](docs/10-plans/godot-creator-rc2/plan.json) and [CHANGELOG](CHANGELOG.md). License: MIT.

### Dev Note

No additional experimental runtime modes.
