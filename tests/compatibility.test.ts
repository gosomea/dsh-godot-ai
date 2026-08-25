import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createGodotMcpConfig } from '../src/agent/launch-spec.js'
import { parseCompatibilityManifest } from '../src/core/compatibility.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function manifestValue(): Promise<unknown> {
  return JSON.parse(await readFile(join(root, 'compatibility.json'), 'utf8'))
}

describe('compatibility manifest', () => {
  it('produces the exact tested attach launch contract', async () => {
    const manifest = parseCompatibilityManifest(await manifestValue())
    expect(createGodotMcpConfig(manifest)).toEqual({
      transport: 'stdio',
      serverName: 'godot-ai',
      command: 'uvx',
      args: [
        '--link-mode', 'copy', '--from', 'godot-ai==3.1.5',
        'godot-ai', 'attach', '--port', '8000', '--ws-port', '9500',
      ],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 360_000,
      failOnStartupError: false,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    })
  })

  it('rejects an untested default, unsafe registry URL, and invalid ports', async () => {
    const original = await manifestValue() as Record<string, any>
    expect(() => parseCompatibilityManifest({
      ...original,
      godotAi: { ...original.godotAi, defaultVersion: '9.9.9' },
    })).toThrow(/must appear in testedVersions/)
    expect(() => parseCompatibilityManifest({
      ...original,
      godotAi: { ...original.godotAi, pypiJsonUrl: 'https://example.com/latest.json' },
    })).toThrow(/pypi.org/)
    expect(() => parseCompatibilityManifest({
      ...original,
      godotAi: { ...original.godotAi, httpPort: 0 },
    })).toThrow(/between 1 and 65535/)
  })
})
