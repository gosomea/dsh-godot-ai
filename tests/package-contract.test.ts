import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('DSH rc.2 bundle contract', () => {
  it('publishes all plugin faces without removed rc8 platform modules', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    expect(manifest.version).toBe('0.7.0')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client.platform).toBe('web')
    for (const face of ['.', './client', './agent']) expect(manifest.exports).toHaveProperty(face)
    for (const directory of ['workflows', 'assets', 'market', 'skills']) expect(manifest.files).toContain(directory)
    expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-runtime')
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-agent-presets')
    expect(manifest.peerDependencies).toHaveProperty('@deepseek-ai/dsh-agent-preset-registry')
  })

  it('declares exactly one scoped Godot preset with filesystem Skills and native PTC presentation', async () => {
    const text = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    const patches = load(text, { schema: entryListSchema }) as Array<{ insert: Array<any> }>
    const rows = patches.flatMap(patch => patch.insert)
    expect(rows.map(row => row.id)).toEqual(['dsh-godot-ai', 'preset-godot-creator'])
    const preset = rows[1].config
    expect(preset.id).toBe('godot-creator')
    expect(preset.plugins.filter((row: any) => row.name === 'dsh-godot-ai/agent')).toHaveLength(1)
    for (const name of ['skill-filesystem', 'tool-skill', 'tool-fs', 'tool-bash', 'compaction', 'tool-todo']) {
      expect(preset.plugins.some((row: any) => row.id === name)).toBe(true)
    }
    expect(preset.plugins.find((row: any) => row.id === 'tool-presentation')).toMatchObject({
      name: '@deepseek-ai/dsh-agent-tool-presentation', config: { mode: 'ptc' },
    })
    expect(text).not.toContain('godot-creator-adaptive')
    expect(text).not.toContain('mode: adaptive')
    expect(text).not.toContain('mode: code')
  })
  it('preserves the pinned upstream PTC composition instead of guessing current DSH defaults', async () => {
    const require = createRequire(import.meta.url)
    const upstreamText = await readFile(require.resolve('@deepseek-ai/dsh-web-app/presets/ptc.patch.yml'), 'utf8')
    const oursText = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    const upstream = load(upstreamText, { schema: entryListSchema }) as any
    const ours = load(oursText, { schema: entryListSchema }) as any
    expect(ours[0].insert[1].config.plugins.filter((row: any) => row.id !== 'godot-ai-agent')).toEqual(
      upstream[0].insert[0].config.plugins.filter((row: any) => row.id !== 'tool-plugin-manager'),
    )
  })
})
