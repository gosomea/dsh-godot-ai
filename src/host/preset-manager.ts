import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import {
  GODOT_PRESET_ID,
  SOURCE_PRESET_ID,
  type ManagedPresetSidecar,
  type ManagedPresetState,
} from '../core/types.js'

const SIDECAR_FILE = 'dsh-godot-ai.managed.json'
const START_PREFIX = '# dsh-godot-ai:managed:start schema='
const END_MARKER = '# dsh-godot-ai:managed:end'

export interface PresetRoster {
  readonly authorable: boolean
  list(): Promise<readonly AgentPreset[]>
  resolve(id?: string): Promise<AgentPreset>
  read(id: string): Promise<string>
  copy(from: string, id: string, name?: string): Promise<void>
  remove(id: string): Promise<void>
}

export interface ManagedPresetManagerOptions {
  readonly roster: PresetRoster
  readonly wrapperVersion: string
  readonly schemaVersion: number
  readonly managedBlock: string
  readonly presetId?: string
  readonly displayName?: string
  readonly now?: () => Date
}

interface ManagedBlockLocation {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly schemaVersion: number
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function errorMessage(error: unknown): string {
  return asError(error).message
}

function managedBlockLocation(content: string): ManagedBlockLocation | undefined {
  const starts = [...content.matchAll(/^# dsh-godot-ai:managed:start schema=(\d+)\s*$/gm)]
  const ends = [...content.matchAll(/^# dsh-godot-ai:managed:end\s*$/gm)]
  if (starts.length === 0 && ends.length === 0) return undefined
  if (starts.length !== 1 || ends.length !== 1) {
    throw new Error('managed block markers must occur exactly once')
  }
  const startMatch = starts[0]
  const endMatch = ends[0]
  if (startMatch?.index === undefined || endMatch?.index === undefined) {
    throw new Error('managed block markers have no source position')
  }
  const endLine = content.indexOf('\n', endMatch.index)
  const end = endLine === -1 ? content.length : endLine + 1
  if (endMatch.index <= startMatch.index) throw new Error('managed block end precedes its start')
  const schemaVersion = Number(startMatch[1])
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error('managed block schema is invalid')
  }
  return { start: startMatch.index, end, text: content.slice(startMatch.index, end), schemaVersion }
}

function appendManagedBlock(content: string, block: string): string {
  if (managedBlockLocation(content) !== undefined) throw new Error('composition already contains a managed block')
  const prefix = content.endsWith('\n') ? content : `${content}\n`
  const separator = prefix.endsWith('\n\n') ? '' : '\n'
  return `${prefix}${separator}${block.endsWith('\n') ? block : `${block}\n`}`
}

function replaceManagedBlock(content: string, block: string): string {
  const location = managedBlockLocation(content)
  if (location === undefined) throw new Error('composition has no managed block')
  const replacement = block.endsWith('\n') ? block : `${block}\n`
  return content.slice(0, location.start) + replacement + content.slice(location.end)
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  let mode: number | undefined
  try { mode = (await stat(path)).mode }
  catch { /* new file */ }
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, content, mode === undefined ? undefined : { mode })
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function parseSidecar(content: string): ManagedPresetSidecar {
  const value = JSON.parse(content) as Partial<ManagedPresetSidecar>
  if (
    !Number.isSafeInteger(value.schemaVersion)
    || typeof value.wrapperVersion !== 'string'
    || value.sourcePreset !== SOURCE_PRESET_ID
    || typeof value.sourceCompositionHash !== 'string'
    || typeof value.managedBlockHash !== 'string'
    || typeof value.installedCompositionHash !== 'string'
    || typeof value.installedAt !== 'string'
    || typeof value.updatedAt !== 'string'
  ) throw new Error('managed sidecar has an invalid shape')
  return value as ManagedPresetSidecar
}

function sidecarText(sidecar: ManagedPresetSidecar): string {
  return `${JSON.stringify(sidecar, null, 2)}\n`
}

export class ManagedPresetManager {
  private readonly roster: PresetRoster
  private readonly wrapperVersion: string
  private readonly schemaVersion: number
  private readonly managedBlock: string
  private readonly presetId: string
  private readonly displayName: string
  private readonly now: () => Date
  private mutation: Promise<void> = Promise.resolve()

  constructor(options: ManagedPresetManagerOptions) {
    this.roster = options.roster
    this.wrapperVersion = options.wrapperVersion
    this.schemaVersion = options.schemaVersion
    this.managedBlock = options.managedBlock.endsWith('\n') ? options.managedBlock : `${options.managedBlock}\n`
    this.presetId = options.presetId ?? GODOT_PRESET_ID
    this.displayName = options.displayName ?? 'Godot Creator'
    this.now = options.now ?? (() => new Date())
    const location = managedBlockLocation(this.managedBlock)
    if (location === undefined || location.start !== 0 || location.end !== this.managedBlock.length) {
      throw new Error('managed block template must contain exactly one complete block')
    }
    if (location.schemaVersion !== this.schemaVersion) {
      throw new Error(`managed block schema ${location.schemaVersion} does not match manager schema ${this.schemaVersion}`)
    }
  }

  async state(): Promise<ManagedPresetState> {
    if (!this.roster.authorable) {
      return { kind: 'unavailable', reason: 'this DSH composition has no writable user preset root' }
    }
    let presets: readonly AgentPreset[]
    try { presets = await this.roster.list() }
    catch (error) { return { kind: 'unavailable', reason: errorMessage(error) } }
    const preset = presets.find(candidate => candidate.id === this.presetId)
    if (preset === undefined) return { kind: 'not-installed' }
    if (preset.trust !== 'user') {
      return { kind: 'unavailable', reason: `preset id "${this.presetId}" is owned by a system root` }
    }
    if (preset.broken !== undefined) return { kind: 'broken', reason: preset.broken }

    let composition: string
    let sidecar: ManagedPresetSidecar
    let block: ManagedBlockLocation | undefined
    try {
      composition = await readFile(preset.path, 'utf8')
      block = managedBlockLocation(composition)
      const stored = await readOptional(join(dirname(preset.path), SIDECAR_FILE))
      if (stored === undefined && block === undefined) {
        return { kind: 'user-modified', reason: `the existing ${this.presetId} preset is not managed by dsh-godot-ai` }
      }
      if (stored === undefined) return { kind: 'broken', reason: `managed sidecar ${SIDECAR_FILE} is missing` }
      sidecar = parseSidecar(stored)
      if (block === undefined) return { kind: 'broken', reason: 'managed block markers are missing' }
    } catch (error) {
      return { kind: 'broken', reason: errorMessage(error) }
    }

    if (digest(composition) !== sidecar.installedCompositionHash) {
      return { kind: 'user-modified', reason: 'the managed preset changed after its last confirmed installation' }
    }
    if (digest(block.text) !== sidecar.managedBlockHash) {
      return { kind: 'user-modified', reason: 'the managed block changed after its last confirmed installation' }
    }
    if (sidecar.schemaVersion > this.schemaVersion) {
      return { kind: 'unavailable', reason: `preset schema ${sidecar.schemaVersion} is newer than wrapper schema ${this.schemaVersion}` }
    }
    if (sidecar.schemaVersion < this.schemaVersion) {
      return { kind: 'sync-available', installedSchema: sidecar.schemaVersion, currentSchema: this.schemaVersion }
    }

    let source: string
    try { source = await this.roster.read(SOURCE_PRESET_ID) }
    catch (error) { return { kind: 'unavailable', reason: `cannot read source preset "${SOURCE_PRESET_ID}": ${errorMessage(error)}` } }
    const currentBaseHash = digest(source)
    if (currentBaseHash !== sidecar.sourceCompositionHash) {
      return {
        kind: 'base-update-available',
        installedBaseHash: sidecar.sourceCompositionHash,
        currentBaseHash,
      }
    }
    return {
      kind: 'current',
      wrapperVersion: this.wrapperVersion,
      installedWrapperVersion: sidecar.wrapperVersion,
      baseHash: currentBaseHash,
    }
  }

  install(): Promise<ManagedPresetState> {
    return this.exclusive(async () => {
      const state = await this.state()
      if (state.kind === 'current') return state
      if (state.kind !== 'not-installed') throw new Error(`cannot install from managed preset state "${state.kind}"`)
      await this.roster.copy(SOURCE_PRESET_ID, this.presetId, this.displayName)
      try {
        const preset = await this.requireUserPreset()
        await this.writeFreshManagedFiles(preset.path)
        return await this.requireHealthyState()
      } catch (error) {
        await this.roster.remove(this.presetId).catch(() => undefined)
        throw error
      }
    })
  }

  sync(): Promise<ManagedPresetState> {
    return this.exclusive(async () => {
      const state = await this.state()
      if (state.kind === 'current') return state
      if (state.kind !== 'sync-available') throw new Error(`cannot sync from managed preset state "${state.kind}"`)
      const preset = await this.requireUserPreset()
      const sidecarPath = join(dirname(preset.path), SIDECAR_FILE)
      const originalComposition = await readFile(preset.path, 'utf8')
      const originalSidecar = await readFile(sidecarPath, 'utf8')
      const previous = parseSidecar(originalSidecar)
      const nextComposition = replaceManagedBlock(originalComposition, this.managedBlock)
      const location = managedBlockLocation(nextComposition)
      if (location === undefined) throw new Error('updated composition lost its managed block')
      const timestamp = this.now().toISOString()
      const next: ManagedPresetSidecar = {
        ...previous,
        schemaVersion: this.schemaVersion,
        wrapperVersion: this.wrapperVersion,
        managedBlockHash: digest(location.text),
        installedCompositionHash: digest(nextComposition),
        updatedAt: timestamp,
      }
      try {
        await atomicWrite(preset.path, nextComposition)
        await atomicWrite(sidecarPath, sidecarText(next))
        return await this.requireHealthyState()
      } catch (error) {
        await atomicWrite(preset.path, originalComposition).catch(() => undefined)
        await atomicWrite(sidecarPath, originalSidecar).catch(() => undefined)
        throw error
      }
    })
  }

  rebuild(): Promise<ManagedPresetState> {
    return this.exclusive(async () => {
      const state = await this.state()
      if (!['current', 'sync-available', 'base-update-available'].includes(state.kind)) {
        throw new Error(`cannot rebuild from managed preset state "${state.kind}"`)
      }
      const preset = await this.requireUserPreset()
      const directory = dirname(preset.path)
      if (basename(directory) !== this.presetId) throw new Error('managed preset directory does not match its id')
      const backup = join(dirname(directory), `.${this.presetId}.backup-${Date.now()}-${randomUUID()}`)
      await rename(directory, backup)
      try {
        await this.roster.copy(SOURCE_PRESET_ID, this.presetId, this.displayName)
        const replacement = await this.requireUserPreset()
        await this.writeFreshManagedFiles(replacement.path)
        const healthy = await this.requireHealthyState()
        await rm(backup, { recursive: true, force: true })
        return healthy
      } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined)
        await rename(backup, directory).catch((restoreError: unknown) => {
          throw new AggregateError([asError(error), asError(restoreError)], 'preset rebuild and rollback both failed')
        })
        throw error
      }
    })
  }

  uninstall(): Promise<ManagedPresetState> {
    return this.exclusive(async () => {
      const state = await this.state()
      if (state.kind === 'not-installed') return state
      if (!['current', 'sync-available', 'base-update-available'].includes(state.kind)) {
        throw new Error(`cannot uninstall from managed preset state "${state.kind}"`)
      }
      await this.roster.remove(this.presetId)
      const after = await this.state()
      if (after.kind !== 'not-installed') throw new Error(`uninstall settled in unexpected state "${after.kind}"`)
      return after
    })
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation)
    this.mutation = result.then(() => undefined, () => undefined)
    return result
  }

  private async requireUserPreset(): Promise<AgentPreset> {
    const preset = await this.roster.resolve(this.presetId)
    if (preset.trust !== 'user') throw new Error(`preset "${this.presetId}" is not writable user content`)
    if (basename(dirname(preset.path)) !== this.presetId) {
      throw new Error(`preset "${this.presetId}" resolved outside its expected directory`)
    }
    return preset
  }

  private async writeFreshManagedFiles(compositionPath: string): Promise<void> {
    const source = await this.roster.read(SOURCE_PRESET_ID)
    const original = await readFile(compositionPath, 'utf8')
    const composition = appendManagedBlock(original, this.managedBlock)
    const location = managedBlockLocation(composition)
    if (location === undefined) throw new Error('new composition lost its managed block')
    const timestamp = this.now().toISOString()
    const sidecar: ManagedPresetSidecar = {
      schemaVersion: this.schemaVersion,
      wrapperVersion: this.wrapperVersion,
      sourcePreset: SOURCE_PRESET_ID,
      sourceCompositionHash: digest(source),
      managedBlockHash: digest(location.text),
      installedCompositionHash: digest(composition),
      installedAt: timestamp,
      updatedAt: timestamp,
    }
    await atomicWrite(compositionPath, composition)
    await atomicWrite(join(dirname(compositionPath), SIDECAR_FILE), sidecarText(sidecar))
  }

  private async requireHealthyState(): Promise<ManagedPresetState> {
    const state = await this.state()
    if (state.kind !== 'current') throw new Error(`managed preset validation settled in state "${state.kind}"`)
    return state
  }
}
