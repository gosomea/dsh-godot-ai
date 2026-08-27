export const SKILL_MARKET_SCHEMA_VERSION = 1 as const
export const MARKET_SKILL_RANK = 350 as const
export const SEED_REVIEW_CANDIDATE_COUNT = 10 as const

export type SeedUpstreamStatus = 'active' | 'moved' | 'deleted' | 'license-blocked' | 'unreachable'
export type SeedDecision = 'recommended' | 'optional' | 'moved' | 'blocked' | 'external-candidate'
export type SeedCompatibility = 'godot-compatible' | 'engine-neutral' | 'web-runtime' | 'external-runtime' | 'engine-mismatch'

export interface GitHubSeedSource {
  readonly kind: 'github'
  readonly owner: string
  readonly repo: string
  readonly commit: string
  readonly subdir: string
}

export interface HistoricalSeedSource {
  readonly kind: 'historical-snapshot'
  readonly pageUrl: string
  readonly artifactSha256: string
}

export interface SeedReviewCandidate {
  readonly id: string
  readonly source: GitHubSeedSource | HistoricalSeedSource
  readonly license: {
    readonly id: string
    readonly redistributable: boolean
    readonly noticeRequired: boolean
  }
  readonly upstreamStatus: SeedUpstreamStatus
  readonly compatibility: SeedCompatibility
  readonly decision: SeedDecision
  readonly installable: boolean
  readonly defaultSelected: boolean
  readonly externalRequirements: readonly string[]
  readonly notes: readonly string[]
}

export interface SeedReviewManifest {
  readonly schemaVersion: typeof SKILL_MARKET_SCHEMA_VERSION
  readonly reviewedAt: string
  readonly candidates: readonly SeedReviewCandidate[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${context}.${key} must be a non-empty string`)
  return value
}

function requireBoolean(record: Record<string, unknown>, key: string, context: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') throw new Error(`${context}.${key} must be a boolean`)
  return value
}

function requireStringArray(record: Record<string, unknown>, key: string, context: string): string[] {
  const value = record[key]
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${context}.${key} must be an array of strings`)
  }
  return value
}

const upstreamStatuses = new Set<SeedUpstreamStatus>(['active', 'moved', 'deleted', 'license-blocked', 'unreachable'])
const decisions = new Set<SeedDecision>(['recommended', 'optional', 'moved', 'blocked', 'external-candidate'])
const compatibilities = new Set<SeedCompatibility>([
  'godot-compatible',
  'engine-neutral',
  'web-runtime',
  'external-runtime',
  'engine-mismatch',
])

/** Validate the maintainer-authored seed review input before it can feed a catalog build. */
export function parseSeedReviewManifest(value: unknown): SeedReviewManifest {
  if (!isRecord(value)) throw new Error('seed review manifest must be an object')
  if (value.schemaVersion !== SKILL_MARKET_SCHEMA_VERSION) throw new Error('unsupported seed review schemaVersion')
  const reviewedAt = requireString(value, 'reviewedAt', 'manifest')
  if (Number.isNaN(Date.parse(reviewedAt))) throw new Error('manifest.reviewedAt must be an ISO date')
  if (!Array.isArray(value.candidates)) throw new Error('manifest.candidates must be an array')

  const ids = new Set<string>()
  const candidates = value.candidates.map((candidateValue, index): SeedReviewCandidate => {
    const context = `manifest.candidates[${index}]`
    if (!isRecord(candidateValue)) throw new Error(`${context} must be an object`)
    const id = requireString(candidateValue, 'id', context)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`${context}.id must be kebab-case`)
    if (ids.has(id)) throw new Error(`duplicate seed candidate ${id}`)
    ids.add(id)

    if (!isRecord(candidateValue.source)) throw new Error(`${context}.source must be an object`)
    const sourceContext = `${context}.source`
    const kind = requireString(candidateValue.source, 'kind', sourceContext)
    let source: GitHubSeedSource | HistoricalSeedSource
    if (kind === 'github') {
      const commit = requireString(candidateValue.source, 'commit', sourceContext)
      if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`${sourceContext}.commit must be a full SHA-1`)
      source = {
        kind,
        owner: requireString(candidateValue.source, 'owner', sourceContext),
        repo: requireString(candidateValue.source, 'repo', sourceContext),
        commit,
        subdir: requireString(candidateValue.source, 'subdir', sourceContext),
      }
    } else if (kind === 'historical-snapshot') {
      const artifactSha256 = requireString(candidateValue.source, 'artifactSha256', sourceContext)
      if (!/^[a-f0-9]{64}$/.test(artifactSha256)) throw new Error(`${sourceContext}.artifactSha256 must be SHA-256`)
      source = {
        kind,
        pageUrl: requireString(candidateValue.source, 'pageUrl', sourceContext),
        artifactSha256,
      }
    } else {
      throw new Error(`${sourceContext}.kind is unsupported`)
    }

    if (!isRecord(candidateValue.license)) throw new Error(`${context}.license must be an object`)
    const licenseContext = `${context}.license`
    const license = {
      id: requireString(candidateValue.license, 'id', licenseContext),
      redistributable: requireBoolean(candidateValue.license, 'redistributable', licenseContext),
      noticeRequired: requireBoolean(candidateValue.license, 'noticeRequired', licenseContext),
    }
    const upstreamStatus = requireString(candidateValue, 'upstreamStatus', context) as SeedUpstreamStatus
    const compatibility = requireString(candidateValue, 'compatibility', context) as SeedCompatibility
    const decision = requireString(candidateValue, 'decision', context) as SeedDecision
    if (!upstreamStatuses.has(upstreamStatus)) throw new Error(`${context}.upstreamStatus is unsupported`)
    if (!compatibilities.has(compatibility)) throw new Error(`${context}.compatibility is unsupported`)
    if (!decisions.has(decision)) throw new Error(`${context}.decision is unsupported`)
    const installable = requireBoolean(candidateValue, 'installable', context)
    const defaultSelected = requireBoolean(candidateValue, 'defaultSelected', context)
    if (defaultSelected && (!installable || decision !== 'recommended')) {
      throw new Error(`${context} can be defaultSelected only when installable and recommended`)
    }
    if (installable && !license.redistributable) throw new Error(`${context} cannot be installable without redistribution rights`)
    return {
      id,
      source,
      license,
      upstreamStatus,
      compatibility,
      decision,
      installable,
      defaultSelected,
      externalRequirements: requireStringArray(candidateValue, 'externalRequirements', context),
      notes: requireStringArray(candidateValue, 'notes', context),
    }
  })

  return { schemaVersion: SKILL_MARKET_SCHEMA_VERSION, reviewedAt, candidates }
}
