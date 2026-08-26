# dsh-godot-ai

[中文](README.md) | English

`dsh-godot-ai` adds a dedicated **Godot Creator mode** to [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). With a Godot project open, DeepSeek Flash / Pro can inspect and operate the running editor through [Godot AI](https://github.com/hi-godot/godot-ai), build a playable prototype, run it, and verify the result.

> Current version: `0.4.2` controlled beta. Supervised use with the Godot editor open is recommended.

## What it can do

- Create and edit scenes, nodes, scripts, resources, signals, and input mappings.
- Build 2D / 3D gameplay, UI, collisions, cameras, materials, animation, audio, and environments.
- Run the game, inject input, inspect runtime state, and check errors and warnings.
- Read every write batch back and recover from the latest verified stage after a failure.
- Orchestrate the complete tested Godot AI surface through scoped PTC / Code Mode.

## Is Godot Creator based on Minimal mode?

No. It copies the current DSH **Standard** preset into an independent `godot-creator` user preset, then adds the Creator persona, Godot AI MCP integration, 16 Godot skills, three workflows, and scoped PTC. Other DSH presets remain unchanged.

Standard is used so Creator retains normal file, shell, search, skill, planning, and verification capabilities.

## Quick start

Requirements:

- DeepSeek Harness `>=0.1.0-rc.5 <0.2.0`
- Node.js `22.19.0+`
- Godot `4.5+` (`4.7` recommended)
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/)

Install the bundle and restart DSH:

```bash
dsh plugin --profile web add dsh-godot-ai
dsh web --port 3080
```

Open DSH Settings and choose **Install Godot Creator mode**.

Then install the separate Godot addon:

1. Open **AssetLib** in Godot and install **Godot AI**.
2. Open **Project → Project Settings → Plugins** and enable **Godot AI**.
3. Keep the target project open.

Create a DSH session with the **Godot Creator** preset, confirm the project is connected, and describe the game you want:

```text
Create a 480×720 2D avoidance game with movement, jumping, hazards,
respawn, a goal, and restart. Run the game and verify logs and visuals.
```

## Included layers

| Layer | Purpose |
| --- | --- |
| Godot AI tools | 45 currently tested bindings that read and operate the editor |
| Godot Creator persona | A game-design, implementation, runtime, and verification process |
| Scoped PTC | Small TypeScript orchestration batches through DSH Code Mode |
| 16 Godot skills | Godot AI orchestration plus 15 engine domains |
| 3 workflows | 2D foundation, playable 3D prototype, and menus/HUD/pause |
| Creator workspace | Project, Addon, backend, version, runtime status, and workflow prompts |

## Validated prototypes

Version `0.4.1` was validated by creating three real prototypes:

- **Neon Dash**: 2D movement, hazards, respawn, camera, victory, and restart.
- **Signal Circuit**: responsive UI, signals, focus navigation, tween, and audio.
- **Orbit Collector**: 3D movement, collisions, camera, materials, lighting, HUD, and collection gameplay.

See [`validation/report.md`](validation/report.md) and [`validation/issues.md`](validation/issues.md) for evidence and limitations.

## Version and safety policy

The current tested backend is pinned to Godot AI `3.1.5`:

```bash
uvx --link-mode copy --from godot-ai==3.1.5 \
  godot-ai attach --port 8000 --ws-port 9500
```

The bundle never modifies DeepSeek Harness source, never installs the Godot addon automatically, never overwrites an unmanaged Creator preset, and never switches to an untested Godot AI release automatically.

Update with:

```bash
dsh plugin --profile web update dsh-godot-ai
```

Uninstall the managed Creator preset in the UI before removing the package:

```bash
dsh plugin --profile web remove dsh-godot-ai
```

## Development

```bash
pnpm check
pnpm test
pnpm build
pnpm test:live
```

## License

[MIT](LICENSE). Third-party sources and licenses are documented in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
