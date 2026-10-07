# Third-party notices

## DeepSeek Harness Web PTC composition

The Godot Creator declaration in `cordis.patch.yml` derives from the public `@deepseek-ai/dsh-web-app` 0.2.0-rc.2 PTC preset. The Godot declaration identity and description are changed, the disabled plugin-manager row is omitted, and the scoped Godot Agent row is added. The upstream DSH modes are not modified.

- Source: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/bundle/web-app/presets/ptc.patch.yml
- License: MIT
- Copyright (c) 2026 DeepSeek

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Godot Engine icon

The colored Godot Engine icon in `assets/godot/icon-color.svg` is Copyright © Andrea Calabró and the Godot Engine project contributors. It is used under the Creative Commons Attribution 4.0 International license.

- Source and usage guidance: https://godotengine.org/press/
- License: https://creativecommons.org/licenses/by/4.0/

The icon identifies the Godot Engine integration. Its use does not imply endorsement of dsh-godot-ai by the Godot Engine project.

## hi-godot/godot-ai

The `godot-ai-orchestration` skill and compatibility contract are independently written summaries of the public Godot AI v3.1.5 tool documentation. The plugin launches the original `godot-ai` Python package and communicates with the original Godot addon; it does not vendor their source code.

- Source snapshot: https://github.com/hi-godot/godot-ai/tree/v3.1.5
- License: MIT

## awesome-gamedev-agent-skills

The 15 Godot engine skill names, domain taxonomy, and routing boundaries were informed by `gamedev-skills/awesome-gamedev-agent-skills`. The bodies in this package were rewritten for the `hi-godot/godot-ai` execution and verification model; no upstream hooks, scripts, installers, or MCP integrations are included.

- Source snapshot: https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/9ca5296b219049c5b68494e1f3c274ead6d727b3/skills/godot
- License: Apache-2.0
- Copyright 2026 Abhishek Barali and the awesome-gamedev-agent-skills contributors

## GodotPrompter

`jame581/GodotPrompter` was reviewed as a secondary reference for coverage gaps and progressive skill routing. No files, hooks, scripts, or installer behavior from that repository are distributed in this package.

- Reviewed snapshot: https://github.com/jame581/GodotPrompter/tree/eae755a1f3719076d52f50ab76f21993ebb9682b
- License: MIT

## Skill Market catalog metadata

The package contains signed catalog metadata, source commits, hashes, risk summaries, and review decisions for third-party Skill candidates. It does **not** vendor their Skill bodies. Installable content is downloaded from the pinned upstream GitHub commit only after the user starts an inspection; scripts, hooks, binaries, and executable files are quarantined and never run by the market.

| Candidate | Pinned source | License / status | 0.6.0 runtime decision |
| --- | --- | --- | --- |
| `higgsfield-game-generation` | `higgsfield-ai/skills@9db2e5bf22ff93d0bffb48664a8d0d6bb417082c` | MIT; removed/moved upstream | Not installable; critical remote-execution finding |
| `game-engine` | `github/awesome-copilot@634b92f887487fc61cddc2f61d77830e09e8f589` | MIT | Not installable; pinned archive exceeds the 16 MiB safety limit |
| `multiplayer-game` | `rivet-dev/skills@ba5d3db3d7489cfc6190fd0de45b96e3787e1ea3` | No confirmed redistribution license | Not installable |
| `game-developer` | `Jeffallan/claude-skills@882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf` | MIT | Optional, review required |
| `game-ui-design` | `omer-metin/skills-for-antigravity@e8dcf4e8737921a10088bd5c9eb65e81f74c051f` | Apache-2.0 | Recommended starter, review required |
| `game-design-theory` | `pluginagentmarketplace/custom-plugin-game-developer@aa7edfe267b34eac63d888f60b13e08aca7850ed` | Custom `LicenseRef-PluginAgentMarketplace` | Not installable until full-license review UI exists |
| `game-feel` | `gamedev-skills/awesome-gamedev-agent-skills@7110607ab816ece9669274bc84937857a8819796` | Apache-2.0 | Recommended starter, review required |
| `game-ui-ux` | same pinned repository and commit as `game-feel` | Apache-2.0 | Recommended starter, review required |
| `threejs-game-ui-designer` | `majidmanzarpour/threejs-game-skills@7221c1f4a6d2ae189a4d85d058d24f3228499d46` | MIT | Optional; never default-installed |
| `develop-web-game` | historical skills.sh snapshot only | Apache-2.0 snapshot; no accepted immutable runtime source | Not installable and never default-installed |

Catalog inclusion is not an endorsement of safety or quality. The signed release assets are in `market/releases/skills-v1/`; the public audit report intentionally contains no upstream prompt excerpts.
