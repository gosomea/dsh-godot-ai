import type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderObservation,
} from '@deepseek-ai/dsh-skill'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { MARKET_SKILL_RANK } from './contracts.js'
import { hashArtifactDirectory } from './files.js'
import { SCANNER_RULES_VERSION } from './scanner.js'
import { SkillMarketStore } from './store.js'

export const MARKET_SKILL_PROVIDER_NAME = 'dsh-godot-ai:market'

export interface InstalledMarketSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: SkillInvocationPolicy
  readonly resourceBase?: SkillDefinition['resourceBase']
  readonly path?: string
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly content: string
  readonly enabled: boolean
  readonly artifactHash: string
}

/**
 * Provider seam for enabled market skills. Phase 2 replaces the empty source
 * with an immutable Store snapshot without changing the DSH registry contract.
 */
export class MarketSkillProvider implements SkillProvider {
  readonly name = MARKET_SKILL_PROVIDER_NAME
  private readonly installed: ReadonlyMap<string, InstalledMarketSkill>

  constructor(skills: readonly InstalledMarketSkill[] = []) {
    const installed = new Map<string, InstalledMarketSkill>()
    for (const skill of skills) {
      if (skill.invocation.modelInvocable) {
        throw new Error(`market skill ${skill.name} cannot be model-invocable`)
      }
      if (skill.enabled && !skill.invocation.userInvocable) {
        throw new Error(`enabled market skill ${skill.name} must be user-invocable`)
      }
      if (!/^[a-f0-9]{64}$/.test(skill.artifactHash)) {
        throw new Error(`market skill ${skill.name} requires a SHA-256 artifact hash`)
      }
      if (installed.has(skill.name)) throw new Error(`duplicate market skill ${skill.name}`)
      installed.set(skill.name, skill)
    }
    this.installed = installed
  }

  async list(_options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
    return [...this.installed.values()].filter(skill => skill.enabled).map(skill => ({
      name: skill.name,
      description: skill.description,
      ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
      invocation: skill.invocation,
      source: 'dsh-godot-ai-market',
      provider: this.name,
      ...skill.resourceBase === undefined ? {} : { resourceBase: skill.resourceBase },
      rank: MARKET_SKILL_RANK,
      locator: { name: skill.name, artifactHash: skill.artifactHash },
      ...skill.path === undefined ? {} : { path: skill.path },
      ...skill.metadata === undefined ? {} : { metadata: skill.metadata },
    }))
  }

  async get(candidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    if (candidate.provider !== this.name || !isMarketLocator(candidate.locator)) return undefined
    const skill = this.installed.get(candidate.locator.name)
    if (skill === undefined || !skill.enabled || skill.artifactHash !== candidate.locator.artifactHash) return undefined
    return {
      name: skill.name,
      description: skill.description,
      ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
      invocation: skill.invocation,
      source: 'dsh-godot-ai-market',
      provider: this.name,
      ...skill.resourceBase === undefined ? {} : { resourceBase: skill.resourceBase },
      ...skill.path === undefined ? {} : { path: skill.path },
      ...skill.metadata === undefined ? {} : { metadata: skill.metadata },
      content: skill.content,
    }
  }
}

function isMarketLocator(value: unknown): value is { name: string; artifactHash: string } {
  if (typeof value !== 'object' || value === null) return false
  const locator = value as Record<string, unknown>
  return typeof locator.name === 'string' && typeof locator.artifactHash === 'string'
}

interface ParsedMarketSkill {
  readonly name: string
  readonly description: string
  readonly content: string
  readonly metadata: Readonly<Record<string, unknown>>
}

function yamlScalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed !== 'string') throw new Error('frontmatter scalar must be a string')
    return parsed
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/gu, "'")
  return trimmed
}

/** Minimal, fail-closed parser for the routing fields needed by DSH. */
export function parseMarketSkillMarkdown(markdown: string, path: string): ParsedMarketSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(markdown)
  if (match === null) throw new Error(`market skill ${path} requires YAML frontmatter`)
  const lines = match[1]!.split(/\r?\n/u)
  const metadata: Record<string, unknown> = {}
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (/^\s|^#/u.test(line) || line.trim() === '') continue
    const separator = line.indexOf(':')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    const raw = line.slice(separator + 1).trim()
    if ((raw === '>' || raw === '|') && index + 1 < lines.length) {
      const continuation: string[] = []
      while (index + 1 < lines.length && /^\s+/u.test(lines[index + 1]!)) {
        index += 1
        continuation.push(lines[index]!.trim())
      }
      metadata[key] = raw === '>' ? continuation.join(' ') : continuation.join('\n')
    } else metadata[key] = yamlScalar(raw)
  }
  if (typeof metadata.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(metadata.name)) {
    throw new Error(`market skill ${path} has an invalid name`)
  }
  if (typeof metadata.description !== 'string' || metadata.description.length === 0) {
    throw new Error(`market skill ${path} requires a description`)
  }
  const content = match[2]!.trim()
  if (content.length === 0) throw new Error(`market skill ${path} has no content`)
  return { name: metadata.name, description: metadata.description, content, metadata }
}

/**
 * Cross-process Store-backed Provider. `complete:false` deliberately prevents
 * DSH from caching a catalog that the host-side market can mutate.
 */
export class StoreBackedMarketSkillProvider implements SkillProvider {
  readonly name = MARKET_SKILL_PROVIDER_NAME

  constructor(private readonly store = new SkillMarketStore()) {}

  async list(_options: SkillLookupOptions): Promise<SkillProviderObservation> {
    await this.store.initialize()
    const lockfile = await this.store.readLockfile()
    const candidates: SkillCandidate[] = []
    for (const [skillId, installed] of Object.entries(lockfile.installed)) {
      if (
        installed.state !== 'ready'
        || !installed.enabled
        || !installed.userInvocable
        || installed.modelInvocable
        || installed.approvalHash === undefined
        || installed.scannerRulesVersion !== SCANNER_RULES_VERSION
      ) continue
      const artifactPath = this.store.artifactPath(installed.activeArtifactHash)
      if (await hashArtifactDirectory(artifactPath).catch(() => '') !== installed.activeArtifactHash) continue
      const skillPath = join(artifactPath, 'SKILL.md')
      let parsed: ParsedMarketSkill
      try { parsed = parseMarketSkillMarkdown(await readFile(skillPath, 'utf8'), skillPath) }
      catch { continue }
      if (parsed.name !== skillId) continue
      candidates.push({
        name: skillId,
        description: parsed.description,
        invocation: { modelInvocable: false, userInvocable: true },
        source: 'dsh-godot-ai-market',
        provider: this.name,
        resourceBase: { kind: 'directory', path: dirname(skillPath) },
        rank: MARKET_SKILL_RANK,
        locator: { name: skillId, artifactHash: installed.activeArtifactHash },
        path: skillPath,
        metadata: { ...parsed.metadata, artifactHash: installed.activeArtifactHash },
      })
    }
    return { candidates, complete: false }
  }

  async get(candidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    if (candidate.provider !== this.name || !isMarketLocator(candidate.locator)) return undefined
    const lock = (await this.store.readLockfile()).installed[candidate.locator.name]
    if (
      lock === undefined
      || lock.state !== 'ready'
      || !lock.enabled
      || !lock.userInvocable
      || lock.modelInvocable
      || lock.approvalHash === undefined
      || lock.scannerRulesVersion !== SCANNER_RULES_VERSION
      || lock.activeArtifactHash !== candidate.locator.artifactHash
    ) return undefined
    const artifactPath = this.store.artifactPath(lock.activeArtifactHash)
    if (await hashArtifactDirectory(artifactPath).catch(() => '') !== lock.activeArtifactHash) return undefined
    const skillPath = join(artifactPath, 'SKILL.md')
    const parsed = await readFile(skillPath, 'utf8').then(markdown => parseMarketSkillMarkdown(markdown, skillPath)).catch(() => undefined)
    if (parsed === undefined || parsed.name !== candidate.locator.name) return undefined
    return {
      name: parsed.name,
      description: parsed.description,
      invocation: { modelInvocable: false, userInvocable: true },
      source: 'dsh-godot-ai-market',
      provider: this.name,
      resourceBase: { kind: 'directory', path: artifactPath },
      path: skillPath,
      metadata: { ...parsed.metadata, artifactHash: lock.activeArtifactHash },
      content: parsed.content,
    }
  }
}
