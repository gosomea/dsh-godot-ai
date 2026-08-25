import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('DSH bundle contract', () => {
  it('publishes Host, Client, and Agent faces from one profile bundle', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      version: string
      exports: Record<string, unknown>
      dsh: { bundle: { patch: string }; client: { platform: string; inject: string[] } }
      files: string[]
      peerDependencies: Record<string, string>
    }
    expect(manifest.version).toBe('0.4.1')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.exports).toHaveProperty('.')
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.exports).toHaveProperty('./agent')
    expect(manifest.files).toContain('templates')
    expect(manifest.files).toContain('workflows')
    expect(manifest.files).toContain('assets')
    expect(manifest.files).toContain('skills')
    expect(manifest.files).toContain('THIRD_PARTY_NOTICES.md')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-conversation')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-locale')
    expect(manifest.peerDependencies).toHaveProperty('@deepseek-ai/dsh-mcp-client')
    expect(manifest.peerDependencies).toHaveProperty('@deepseek-ai/dsh-skill')
  })

  it('adds only its own Host row and keeps the managed template stable', async () => {
    expect(await readFile(join(root, 'cordis.patch.yml'), 'utf8')).toBe(
      '- insert:\n    - id: dsh-godot-ai\n      name: dsh-godot-ai\n',
    )
    expect(await readFile(join(root, 'templates/godot-creator-managed-row.yml'), 'utf8')).toBe(
      '# dsh-godot-ai:managed:start schema=1\n'
      + '- id: dsh-godot-ai-agent\n'
      + '  name: dsh-godot-ai/agent\n'
      + '# dsh-godot-ai:managed:end\n',
    )
  })
})
