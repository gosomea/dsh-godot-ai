import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { parseCompatibilityManifest, type CompatibilityManifest } from '../src/core/compatibility.js'
import {
  GodotIntegrationManager,
  parseEditorSessions,
  probeBackend,
  probeUvx,
} from '../src/host/integration-manager.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hash = 'af75d04a00d4be87421db50c6f51ba709375286178ea02482ef2776acace1470'

async function manifest(): Promise<CompatibilityManifest> {
  return parseCompatibilityManifest(JSON.parse(await readFile(join(root, 'compatibility.json'), 'utf8')))
}

function status(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'godot-ai',
    server_version: '3.1.5',
    attach_protocol_version: 1,
    ws_port: 9500,
    exclude_domains: [],
    owner_type: 'attach',
    tool_catalog_hash: hash,
    active_lease_count: 1,
    ...overrides,
  }
}

function json(value: unknown, statusCode = 200): Response {
  return new Response(JSON.stringify(value), { status: statusCode, headers: { 'content-type': 'application/json' } })
}

describe('uvx prerequisite probe', () => {
  it('reports available, missing, and malformed output without a shell', async () => {
    const available = vi.fn(async () => ({ stdout: 'uvx 0.8.13\n', stderr: '' }))
    await expect(probeUvx(available)).resolves.toEqual({ kind: 'available', version: 'uvx 0.8.13' })
    expect(available).toHaveBeenCalledWith('uvx', ['--version'], expect.objectContaining({ windowsHide: true }))

    const missing = vi.fn(async () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }) })
    await expect(probeUvx(missing)).resolves.toEqual({ kind: 'missing' })
    await expect(probeUvx(async () => ({ stdout: '', stderr: '' }))).resolves.toMatchObject({ kind: 'error' })
  })
})

describe('backend status probe', () => {
  it('classifies stopped, foreign, ready, and incompatible listeners', async () => {
    const config = await manifest()
    await expect(probeBackend(config, vi.fn(async () => { throw new TypeError('fetch failed') })))
      .resolves.toEqual({ kind: 'stopped' })
    await expect(probeBackend(config, vi.fn(async () => json({ name: 'other' }))))
      .resolves.toMatchObject({ kind: 'foreign-listener' })
    await expect(probeBackend(config, vi.fn(async () => json(status()))))
      .resolves.toMatchObject({ kind: 'ready', details: { serverVersion: '3.1.5', activeLeaseCount: 1 } })
    await expect(probeBackend(config, vi.fn(async () => json(status({ server_version: '3.2.0' })))))
      .resolves.toMatchObject({ kind: 'incompatible', reason: expect.stringContaining('3.2.0') })
    await expect(probeBackend(config, vi.fn(async () => json(status({ exclude_domains: ['debug'] })))))
      .resolves.toMatchObject({ kind: 'incompatible', reason: expect.stringContaining('domains') })
    await expect(probeBackend(config, vi.fn(async () => json(status({ tool_catalog_hash: 'a'.repeat(64) })))))
      .resolves.toMatchObject({ kind: 'incompatible', reason: expect.stringContaining('catalog') })
  })
})

describe('editor session parsing', () => {
  const session = {
    session_id: 'game@a1b2', name: 'game', godot_version: '4.7', project_path: '/game',
    plugin_version: '3.1.5', current_scene: 'res://main.tscn', play_state: 'stopped',
    readiness: 'ready', is_active: true,
  }

  it('accepts structuredContent and JSON text fallback', () => {
    expect(parseEditorSessions({ structuredContent: { sessions: [session] } })[0]).toMatchObject({
      sessionId: 'game@a1b2', name: 'game', isActive: true,
    })
    expect(parseEditorSessions({ content: [{ type: 'text', text: JSON.stringify({ data: { sessions: [] } }) }] })).toEqual([])
    expect(() => parseEditorSessions({ structuredContent: { count: 0 } })).toThrow(/sessions array/)
  })
})

describe('integration snapshot', () => {
  it('combines local status, editor sessions, PyPI update state, cache, and forced refresh', async () => {
    const config = await manifest()
    let backendCalls = 0
    let pypiCalls = 0
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('127.0.0.1')) { backendCalls += 1; return json(status()) }
      pypiCalls += 1
      return json({ info: { version: '3.2.0' } })
    })
    const readSessions = vi.fn(async () => [{
      sessionId: 'game@a1b2', name: 'game', godotVersion: '4.7', projectPath: '/game',
      pluginVersion: '3.1.5', currentScene: '', playState: 'stopped', readiness: 'ready', isActive: true,
    }])
    const manager = new GodotIntegrationManager(config, '0.3.0', {
      fetch: fetchMock,
      probeUvx: async () => ({ kind: 'available', version: 'uvx 0.8.13' }),
      readEditorSessions: readSessions,
      now: () => 1_800_000_000_000,
      cacheTtlMs: 30_000,
      updateCacheTtlMs: 30_000,
    })
    const first = await manager.snapshot()
    expect(first.backend.kind).toBe('ready')
    expect(first.editor).toMatchObject({ kind: 'connected', sessions: [{ name: 'game' }] })
    expect(first.update).toEqual({ kind: 'unverified-update', latestVersion: '3.2.0' })
    expect(await manager.snapshot()).toBe(first)
    expect(backendCalls).toBe(1)
    expect(pypiCalls).toBe(1)
    await manager.snapshot(true)
    expect(backendCalls).toBe(2)
    expect(pypiCalls).toBe(2)
  })

  it('refreshes local editor state without repeatedly querying PyPI', async () => {
    const config = await manifest()
    let now = 1_800_000_000_000
    let backendCalls = 0
    let pypiCalls = 0
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('127.0.0.1')) { backendCalls += 1; return json(status()) }
      pypiCalls += 1
      return json({ info: { version: '3.1.5' } })
    })
    const manager = new GodotIntegrationManager(config, '0.3.0', {
      fetch: fetchMock,
      probeUvx: async () => ({ kind: 'available', version: 'uvx 0.8.13' }),
      readEditorSessions: async () => [],
      now: () => now,
      cacheTtlMs: 3_000,
      updateCacheTtlMs: 30 * 60_000,
    })
    await manager.snapshot()
    now += 5_000
    await manager.snapshot()
    expect(backendCalls).toBe(2)
    expect(pypiCalls).toBe(1)
  })

  it('does not query editor sessions without a compatible backend', async () => {
    const config = await manifest()
    const readSessions = vi.fn()
    const manager = new GodotIntegrationManager(config, '0.3.0', {
      fetch: vi.fn(async (input: string | URL | Request) => String(input).includes('pypi')
        ? json({ info: { version: '3.1.5' } })
        : Promise.reject(new TypeError('fetch failed'))),
      probeUvx: async () => ({ kind: 'missing' }),
      readEditorSessions: readSessions,
    })
    const result = await manager.snapshot()
    expect(result.backend.kind).toBe('stopped')
    expect(result.editor.kind).toBe('unavailable')
    expect(readSessions).not.toHaveBeenCalled()
  })
})
