import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import { GODOT_ADAPTIVE_PRESET_ID, GODOT_PRESET_ID, SOURCE_PRESET_ID } from '../src/core/types.js'
import { ManagedPresetManager, type PresetRoster } from '../src/host/preset-manager.js'

const BLOCK_V1 = `# dsh-godot-ai:managed:start schema=1
- id: dsh-godot-ai-agent
  name: dsh-godot-ai/agent
# dsh-godot-ai:managed:end
`

const BLOCK_V2 = `# dsh-godot-ai:managed:start schema=2
- id: dsh-godot-ai-agent
  name: dsh-godot-ai/agent
  config:
    contract: 2
# dsh-godot-ai:managed:end
`

const STANDARD_COMPOSITION = `- id: standard-marker
  name: fixture-standard
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
`

class FakeRoster implements PresetRoster {
  readonly authorable = true
  failNextCopy = false

  constructor(
    readonly systemRoot: string,
    readonly userRoot: string,
  ) {}

  async list(): Promise<readonly AgentPreset[]> {
    const presets: AgentPreset[] = [await this.resolve(SOURCE_PRESET_ID)]
    for (const id of [GODOT_PRESET_ID, GODOT_ADAPTIVE_PRESET_ID]) {
      try { presets.push(await this.resolve(id)) }
      catch { /* absent */ }
    }
    return presets
  }

  async resolve(id = SOURCE_PRESET_ID): Promise<AgentPreset> {
    const trust = id === SOURCE_PRESET_ID ? 'system' : 'user'
    const path = join(trust === 'system' ? this.systemRoot : this.userRoot, id, 'agent.cordis.yml')
    try { await readFile(path, 'utf8') }
    catch { throw new Error(`preset "${id}" not found`) }
    return { id, trust, path }
  }

  async read(id: string): Promise<string> {
    return readFile((await this.resolve(id)).path, 'utf8')
  }

  async copy(from: string, id: string): Promise<void> {
    if (this.failNextCopy) {
      this.failNextCopy = false
      throw new Error('injected copy failure')
    }
    const source = dirname((await this.resolve(from)).path)
    const destination = join(this.userRoot, id)
    try { await readFile(join(destination, 'agent.cordis.yml'), 'utf8'); throw new Error(`preset "${id}" exists`) }
    catch (error) {
      if (error instanceof Error && error.message.includes('exists')) throw error
    }
    await cp(source, destination, { recursive: true, errorOnExist: true, force: false })
  }

  async remove(id: string): Promise<void> {
    const preset = await this.resolve(id)
    if (preset.trust !== 'user') throw new Error('cannot remove system preset')
    await rm(dirname(preset.path), { recursive: true, force: false })
  }
}

let root: string
let systemRoot: string
let userRoot: string
let roster: FakeRoster
let manager: ManagedPresetManager

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-godot-ai-manager-'))
  systemRoot = join(root, 'system')
  userRoot = join(root, 'user')
  await mkdir(join(systemRoot, SOURCE_PRESET_ID), { recursive: true })
  await mkdir(userRoot, { recursive: true })
  await writeFile(join(systemRoot, SOURCE_PRESET_ID, 'agent.cordis.yml'), STANDARD_COMPOSITION)
  roster = new FakeRoster(systemRoot, userRoot)
  manager = new ManagedPresetManager({
    roster,
    wrapperVersion: '0.1.0',
    schemaVersion: 1,
    managedBlock: BLOCK_V1,
    now: () => new Date('2026-08-23T00:00:00.000Z'),
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const compositionPath = (): string => join(userRoot, GODOT_PRESET_ID, 'agent.cordis.yml')

describe('ManagedPresetManager', () => {
  it('can manage an independent adaptive preset without changing classic', async () => {
    const adaptive = new ManagedPresetManager({
      roster,
      wrapperVersion: '0.1.0',
      schemaVersion: 1,
      managedBlock: BLOCK_V1.replace('name: dsh-godot-ai/agent', 'name: dsh-godot-ai/agent\n  config:\n    mode: adaptive'),
      presetId: GODOT_ADAPTIVE_PRESET_ID,
      displayName: 'Godot Creator Adaptive',
    })

    expect((await adaptive.install()).kind).toBe('current')
    expect(await manager.state()).toEqual({ kind: 'not-installed' })
    expect(await readFile(join(userRoot, GODOT_ADAPTIVE_PRESET_ID, 'agent.cordis.yml'), 'utf8'))
      .toContain('mode: adaptive')
    expect(await readFile(join(userRoot, GODOT_ADAPTIVE_PRESET_ID, 'agent.cordis.yml'), 'utf8'))
      .toContain("name: '@deepseek-ai/dsh-skill-filesystem'")
    expect(await readFile(join(userRoot, GODOT_ADAPTIVE_PRESET_ID, 'agent.cordis.yml'), 'utf8'))
      .toContain("name: '@deepseek-ai/dsh-tool-skill'")
  })

  it('inherits the Standard filesystem and skill-tool rows instead of mounting duplicates', async () => {
    await manager.install()
    const installed = await readFile(compositionPath(), 'utf8')

    expect(installed).toContain("name: '@deepseek-ai/dsh-skill-filesystem'")
    expect(installed).toContain("name: '@deepseek-ai/dsh-tool-skill'")
    expect(installed.match(/dsh-skill-filesystem/g)).toHaveLength(1)
    expect(installed.match(/dsh-tool-skill/g)).toHaveLength(1)
  })

  it('installs once, preserves the copied bytes, and serializes concurrent requests', async () => {
    const source = await roster.read(SOURCE_PRESET_ID)
    const [first, second] = await Promise.all([manager.install(), manager.install()])

    expect(first.kind).toBe('current')
    expect(second.kind).toBe('current')
    const installed = await readFile(compositionPath(), 'utf8')
    expect(installed.startsWith(source)).toBe(true)
    expect(installed).toContain(BLOCK_V1.trim())
    expect(JSON.parse(await readFile(join(dirname(compositionPath()), 'dsh-godot-ai.managed.json'), 'utf8')))
      .toMatchObject({ schemaVersion: 1, wrapperVersion: '0.1.0', sourcePreset: 'standard' })
  })

  it('never overwrites an existing non-managed preset', async () => {
    await mkdir(dirname(compositionPath()), { recursive: true })
    await writeFile(compositionPath(), '[]\n')

    expect(await manager.state()).toEqual({
      kind: 'user-modified',
      reason: 'the existing godot-creator preset is not managed by dsh-godot-ai',
    })
    await expect(manager.install()).rejects.toThrow(/user-modified/)
    expect(await readFile(compositionPath(), 'utf8')).toBe('[]\n')
  })

  it('detects edits and refuses destructive actions', async () => {
    await manager.install()
    await writeFile(compositionPath(), `${await readFile(compositionPath(), 'utf8')}# user edit\n`)

    expect((await manager.state()).kind).toBe('user-modified')
    await expect(manager.sync()).rejects.toThrow(/user-modified/)
    await expect(manager.rebuild()).rejects.toThrow(/user-modified/)
    await expect(manager.uninstall()).rejects.toThrow(/user-modified/)
  })

  it('updates only the managed block when its schema advances', async () => {
    await manager.install()
    const before = await readFile(compositionPath(), 'utf8')
    const upgraded = new ManagedPresetManager({
      roster,
      wrapperVersion: '0.2.0',
      schemaVersion: 2,
      managedBlock: BLOCK_V2,
    })

    expect(await upgraded.state()).toEqual({ kind: 'sync-available', installedSchema: 1, currentSchema: 2 })
    expect((await upgraded.sync()).kind).toBe('current')
    const after = await readFile(compositionPath(), 'utf8')
    expect(after.slice(0, before.indexOf('# dsh-godot-ai:managed:start')))
      .toBe(before.slice(0, before.indexOf('# dsh-godot-ai:managed:start')))
    expect(after).toContain('contract: 2')
  })

  it('offers a sync when the wrapper version advances without a schema change', async () => {
    await manager.install()
    const upgraded = new ManagedPresetManager({
      roster,
      wrapperVersion: '0.2.0',
      schemaVersion: 1,
      managedBlock: BLOCK_V1,
    })

    expect(await upgraded.state()).toEqual({ kind: 'sync-available', installedSchema: 1, currentSchema: 1 })
    expect((await upgraded.sync()).kind).toBe('current')
    expect(JSON.parse(await readFile(join(dirname(compositionPath()), 'dsh-godot-ai.managed.json'), 'utf8')))
      .toMatchObject({ schemaVersion: 1, wrapperVersion: '0.2.0' })
  })

  it('detects a Standard update and rebuilds from the new base', async () => {
    await manager.install()
    const newSource = '- id: current-standard\n  name: fixture-current\n'
    await writeFile(join(systemRoot, SOURCE_PRESET_ID, 'agent.cordis.yml'), newSource)

    expect((await manager.state()).kind).toBe('base-update-available')
    expect((await manager.rebuild()).kind).toBe('current')
    expect((await readFile(compositionPath(), 'utf8')).startsWith(newSource)).toBe(true)
  })

  it('restores the previous directory when rebuilding cannot copy the source', async () => {
    await manager.install()
    const original = await readFile(compositionPath(), 'utf8')
    await writeFile(join(systemRoot, SOURCE_PRESET_ID, 'agent.cordis.yml'), '- id: changed\n  name: changed\n')
    roster.failNextCopy = true

    await expect(manager.rebuild()).rejects.toThrow(/injected copy failure/)
    expect(await readFile(compositionPath(), 'utf8')).toBe(original)
    expect((await manager.state()).kind).toBe('base-update-available')
  })

  it('uninstalls only a confirmed managed preset', async () => {
    await manager.install()
    expect((await manager.uninstall()).kind).toBe('not-installed')
    await expect(readFile(compositionPath(), 'utf8')).rejects.toThrow()
    expect((await manager.uninstall()).kind).toBe('not-installed')
  })
})
