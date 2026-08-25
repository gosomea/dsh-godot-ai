# dsh-godot-ai

English | [中文](README.zh.md)

A dedicated **Godot game-creation mode** for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). It lets DeepSeek Flash / Pro inspect and operate a running Godot editor through [Godot AI](https://github.com/hi-godot/godot-ai), then builds playable prototypes through a discover → scaffold → configure → run → verify loop.

> Current release: `0.4.1` controlled beta. It is intended for supervised creation with the Godot editor open; fully unattended operation and recovery across every desktop environment are not yet claimed.

## What it can do

- Create and edit scenes, nodes, scripts, resources, signals, and input mappings.
- Build 2D / 3D gameplay, collisions, cameras, menus, HUDs, and pause flows.
- Configure UI, materials, shaders, animations, particles, audio, lighting, and environments.
- Run the game, inject input, inspect scene trees and runtime state, and check errors and warnings.
- Verify results with screenshots, visual descriptions, structural read-back, and runtime logs.
- Use PTC / Code Mode to organize many Godot operations into small, recoverable batches.

This is not another Godot editor or a fork of Godot AI. It is the product and orchestration layer between Godot AI and DeepSeek Harness:

```text
Godot Creator session
        ↓  Persona + 16 Godot skills + 3 workflows
DSH Code Mode / PTC
        ↓  generated TypeScript SDK
Godot AI MCP backend (tested version pin)
        ↓
Godot AI addon
        ↓
Running Godot editor and project
```

## Core components

| Component | Purpose |
| --- | --- |
| Godot Creator preset | A game-design, Godot-engineering, and verification persona scoped away from other DSH sessions |
| Complete Godot AI surface | The currently tested 45 `mcp__godot-ai__*` bindings through DSH MCP Client |
| Scoped PTC | Only `run_code` is directly exposed in Creator; a generated SDK orchestrates standard and Godot tools |
| 16 Godot skills | One Godot AI orchestration contract and 15 domains including GDScript, scenes, signals, 2D/3D, UI, physics, and shaders |
| 3 quick workflows | Create a 2D game foundation, create a playable 3D prototype, or add menus/HUD/pause flows |
| Godot workspace | Session-level project, Editor/Addon, backend, version, and runtime status plus reviewable workflow prompts |
| Safe lifecycle | Explicit Creator preset install, sync, backup/rebuild, and uninstall with compatibility and port diagnostics |

## Five-minute quick start

### 1. Prepare the environment

- DeepSeek Harness `>=0.1.0-rc.5 <0.2.0`
- Node.js `22.19.0+`
- Godot `4.5+` (`4.7` recommended)
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/)

Confirm that `uvx` is available:

```bash
uvx --version
```

### 2. Install dsh-godot-ai

Install the first public beta from a GitHub source checkout:

```bash
git clone https://github.com/gosomea/dsh-godot-ai.git
cd dsh-godot-ai
pnpm install
pnpm build
dsh plugin --profile web add "$(pwd)"
```

After the npm package is published, direct installation will be available:

```bash
dsh plugin --profile web add dsh-godot-ai
```

Restart DSH Web after installation:

```bash
dsh web --port 3080
```

Open DSH Settings. The first-run onboarding explains the user-preset write before offering **Install Godot Creator mode**. Installing the bundle alone never writes a preset silently.

### 3. Install the addon in the Godot project

The DSH bundle and the Godot addon are separate installations. This plugin **never modifies a Godot project automatically**.

Choose one installation path:

1. Open **AssetLib** in Godot, search for **Godot AI**, then download and install it.
2. Download the latest [Godot AI GitHub release](https://github.com/hi-godot/godot-ai/releases/latest) and copy `addons/godot_ai` into the project.
3. Clone the upstream repository and copy `plugin/addons/godot_ai` into the project.

Open **Project → Project Settings → Plugins**, enable **Godot AI**, and keep the target project open in the Godot editor.

### 4. Start creating

1. Create a DSH session and select **Godot Creator**.
2. Confirm that the session header shows the intended project as connected.
3. Open the **Godot Creator** status entry and choose the 2D, 3D, or menus/HUD quick workflow.
4. A workflow only inserts a reviewable request into the composer. Add your requirements and send it when ready.

You can also describe the task directly:

```text
Create a 480×720 2D avoidance game. The player can move left/right and jump,
respawns after touching a hazard, wins at the goal, and can restart.
Inspect the current project first, work in recoverable stages, read back each batch,
then run the game and check its logs and visuals.
```

```text
Inspect the current 3D project and build a third-person collection prototype.
Collecting three energy orbs should unlock the exit. Add a follow camera, collisions,
a status HUD, basic materials and lighting, then verify the complete play path.
```

```text
Add a main menu, responsive HUD, pause, resume, and return-to-menu flow to the current game.
Preserve ownership of the existing game logic and test keyboard and mouse navigation.
```

## How Godot Creator works

Creator first identifies the editor session, project path, current scene, selection, and play state. It reduces the request to a playable vertical slice and then executes:

1. **Discover**: inspect existing scenes, nodes, scripts, resources, inputs, and project constraints.
2. **Scaffold**: create structures by a single subtree or resource family, normally keeping a side-effect batch at 20 commands or fewer.
3. **Configure**: connect scripts, signals, input, UI, materials, and behavior.
4. **Run**: save and run the project, then traverse the core gameplay path.
5. **Verify**: independently read results back and inspect state, errors, warnings, logs, and visual evidence.

A tool returning `success` is not considered proof of completion. Creator reads every write batch back. After a partial failure it records observed side effects and resumes from the latest verified stage.

## PTC, skills, and workflows

- **Godot AI tools** perform the actual editor reads and mutations.
- **PTC / Code Mode** groups tool calls into fewer, recoverable program batches.
- **Godot skills** provide domain knowledge, parameter constraints, verification methods, and known-issue mitigations.
- **Workflow templates** store goals, inputs, stages, acceptance, and recovery conditions without hard-coding TypeScript or upstream parameters.
- The **Godot Creator persona** organizes all of them into one explainable creation process.

See [`skills/README.md`](skills/README.md) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for skill sources, snapshots, licenses, and update policy.

## Backend and version policy

Only a `godot-creator` session mounts the Godot MCP integration. The current tested backend starts through this exact version pin:

```bash
uvx --link-mode copy --from godot-ai==3.1.5 \
  godot-ai attach --port 8000 --ws-port 9500
```

The first session may download and cache the Python package. It still does not install the Godot addon or write a Godot project. Every Godot tool domain is enabled, individual calls have a 360-second timeout, and connections use bounded retries.

If port 8000 is owned by an unrelated process, the status card reports a foreign listener and the bridge fails closed with `PORT_OCCUPIED`. It never kills or replaces an unidentified process.

The safe update path advances the wrapper and compatibility matrix together:

```bash
dsh plugin --profile web update dsh-godot-ai
```

Restart DSH afterwards. Managed presets refer to the stable `dsh-godot-ai/agent` export and normally need no rebuild. A newer Godot AI release stays informational until it is listed in `compatibility.json`; it is never selected automatically.

## Validated game prototypes

Version `0.4.1` created and verified three complementary prototypes through real DSH, Godot AI, and Godot editor sessions:

| Prototype | Capability coverage | Result |
| --- | --- | --- |
| Neon Dash | 2D movement, jumping, hazards, respawn, camera, victory, and restart | PASS |
| Signal Circuit | Responsive UI, signals, focus navigation, keyboard/mouse, tween, and procedural audio | PASS |
| Orbit Collector | 3D movement, camera, collisions, materials, lighting, HUD, collection, and exit logic | PASS |

Flash built the games and Pro could independently inspect the project and make evidence-driven minimal fixes. See [`validation/report.md`](validation/report.md) and [`validation/issues.md`](validation/issues.md) for the environment, defects, recovery traces, and limitations.

## Status and troubleshooting

| Symptom | What to check |
| --- | --- |
| Godot Creator preset is missing | Open Settings onboarding, explicitly install Creator mode, then restart DSH |
| `uvx` is missing | Install `uv` and verify `uvx --version` |
| Backend is waiting to start | Create or open a Godot Creator session; the first start may download the pinned package |
| Editor / Addon is disconnected | Keep the Godot project open and enable Godot AI under Project Settings → Plugins |
| Port 8000 is occupied | Inspect the owning process; this plugin does not terminate unknown listeners |
| Many Web boot plugins stay `pending` | Confirm that the `dsh web` process is still running; losing the base runtime connection leaves dependent plugins waiting |

## Safety boundaries

- npm lifecycle scripts and plugin startup hooks never write `$DSH_HOME/.agent-presets`.
- Install, sync, rebuild, and uninstall actions are explicit and serialized.
- An existing unmanaged `godot-creator` preset is never overwritten.
- A user-modified composition, marker, or sidecar is reported as user-modified and is not removed automatically.
- Rebuild moves the old preset to a hidden sibling backup and restores it on failure.
- Management HTTP routes accept loopback, same-origin requests only.
- The bundle never modifies a Godot project or its `addons/` directory.
- Version checks only read public PyPI metadata and fail non-fatally.
- An untested Godot AI version never becomes the runtime pin automatically.

## Uninstall

Uninstall the managed Godot Creator preset in the plugin UI before removing the bundle:

```bash
dsh plugin --profile web remove dsh-godot-ai
```

DSH currently has no package-removal hook. Removing the npm package first leaves the managed preset on disk, where it becomes broken because `dsh-godot-ai/agent` no longer resolves.

## Development and test

```bash
pnpm check
pnpm test
pnpm build
```

Run the real protocol integration test with:

```bash
pnpm test:live
```

The live test follows the real `uvx → godot-ai attach → DSH MCP Client → Code Mode` path. It asserts that the Creator wire catalog contains only `run_code`, discovers 45 Godot SDK bindings, and executes read-only `session_manage(list)`. It never writes a Godot project and can validate the protocol without a connected editor.

## Compatibility

| Component | Tested version |
| --- | --- |
| dsh-godot-ai | `0.4.1` |
| DeepSeek Harness | `0.1.0-rc.5` baseline |
| Node.js | `>=22.19.0` |
| Godot AI | `3.1.5` |
| Godot | `>=4.5`; `4.7` recommended |

See [`compatibility.json`](compatibility.json) for the machine-readable matrix.

## License

[MIT](LICENSE). See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for Godot AI and community skill sources and licenses.
