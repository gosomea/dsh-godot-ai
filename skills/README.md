# Bundled Godot skills

This directory is the on-demand knowledge layer for the `godot-creator` preset. The agent plugin reads each direct child `SKILL.md`, validates the exact catalog, strips frontmatter, and publishes the body through the preset-scoped `dsh-godot-ai:bundled` provider at DSH's standard bundled rank 600. Other presets do not see this provider. Project, custom, market, and user skills may intentionally override these fallback definitions according to the DSH rank contract.

## Source policy

- Tool semantics and verification: `hi-godot/godot-ai` v3.1.5.
- Godot engine taxonomy: all 15 Godot domains from `gamedev-skills/awesome-gamedev-agent-skills` snapshot `9ca5296b219049c5b68494e1f3c274ead6d727b3`.
- Secondary coverage review: `jame581/GodotPrompter` snapshot `eae755a1f3719076d52f50ab76f21993ebb9682b`.
- Engine facts target Godot 4.7, while the wrapper's minimum supported Godot remains defined by `compatibility.json`.

The content is deliberately rewritten around the `godot-ai` tool surface. Do not copy tool calls from an upstream skill that assumes another bridge, MCP server, CLI, hook, GUT, or gdUnit4.

## Updating

1. Compare the pinned upstream refs with their current default branches.
2. Review Godot-domain additions, removals, renamed APIs, and version baselines.
3. Reconcile changes into these concise skills and the `godot-ai-orchestration` tool map.
4. Update the snapshot refs here and in `THIRD_PARTY_NOTICES.md`.
5. Run `pnpm check`, `pnpm test`, `pnpm build`, `pnpm pack --dry-run`, and `pnpm test:live` against the tested backend.

Never update skill facts independently of `compatibility.json` when the change requires a newer Godot or Godot AI version.
