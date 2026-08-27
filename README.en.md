# dsh-godot-ai

[中文](README.md) | English

`dsh-godot-ai` adds a dedicated **Godot Creator mode** to [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). With a Godot project open, DeepSeek Flash / Pro can inspect and operate the running editor through [Godot AI](https://github.com/hi-godot/godot-ai), build a playable prototype, run it, and verify the result.

> Current release: `0.6.0`. The live plugin capability gate passed on DSH rc8 and Godot, but the full 15 Classic + 15 Adaptive product matrix is incomplete. Supervised use with the Godot editor open is recommended.

## What it can do

- Create and edit scenes, nodes, scripts, resources, signals, and input mappings.
- Build 2D / 3D gameplay, UI, collisions, cameras, materials, animation, audio, and environments.
- Run the game, inject input, inspect runtime state, and check errors and warnings.
- Read every write batch back and recover from the latest verified stage after a failure.
- Orchestrate the complete tested Godot AI surface through scoped PTC / Code Mode.

## Is Godot Creator based on Minimal mode?

The precise answer is: **both Creator presets are installed from DSH Standard, while Adaptive uses a controlled minimal first phase.** The plugin does not copy or modify DSH Minimal and does not change DSH source code.

- `godot-creator` keeps the Standard capabilities from the first turn and adds the Creator persona, Godot AI, 16 skills, three workflows, and scoped PTC / Code Mode.
- `godot-creator-adaptive` is also copied from Standard. For a build or repair request, its first phase temporarily replaces the prompt with a short complete prompt and permits `run_code` to orchestrate only two read-only Godot bindings. After a successful inspection it promotes to the full Standard + Godot Creator surface.

Adaptive therefore borrows the focus and tool discipline of a minimal startup without becoming a Minimal-derived preset. Classic and Adaptive remain independent, and other DSH presets are unchanged.

## Quick start

Requirements:

- DeepSeek Harness `>=0.1.0-rc.8 <0.2.0`
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
| Godot Skill Market | Review, install, update, roll back, and recover third-party game-development skills |

## Godot Skill Market

Version 0.6.0 keeps the 16 packaged Godot skills as rank-600 offline fallbacks and adds a separately updated market. Project, custom, market, and user skills can override a fallback with DSH's documented precedence.

The first signed catalog records all ten requested candidates. Five are currently installable after review: `game-feel`, `game-ui-ux`, `game-ui-design`, `game-developer`, and the optional `threejs-game-ui-designer`. Only the first three form the recommended Godot starter set, and none is downloaded automatically. `develop-web-game` and the Three.js skill are explicitly not default-installed.

Every install follows a fixed-commit download, executable/script quarantine, prompt-risk scan, bounded diff, explicit finding review, and disabled-by-default activation. Critical findings cannot be overridden. High and medium findings require per-item acknowledgement. Third-party market skills always remain `modelInvocable: false`; a user must explicitly enable one before it becomes user-invocable.

The catalog is protected by Ed25519 signatures, key IDs, a multi-key npm trust root, an initial hash pin, and monotonically increasing serials. Updates are checked at most once per 24 hours with ETag caching. These controls establish provenance and rollback resistance; they do not prove that third-party prompt content is safe, and the static scanner is not a sandbox.

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
