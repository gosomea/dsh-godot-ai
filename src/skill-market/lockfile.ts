export const SKILL_MARKET_LOCKFILE_SCHEMA_VERSION = 1 as const

export type InstalledSkillState = 'ready' | 'missing-artifact' | 'review-required' | 'blocked'

export type InstalledSkillSource =
  | { readonly kind: 'curated'; readonly catalogSerial: number; readonly skillId: string }
  | {
    readonly kind: 'github'
    readonly owner: string
    readonly repo: string
    readonly commit: string
    readonly subdir: string
  }

export interface InstalledSkillRevision {
  readonly source: InstalledSkillSource
  readonly artifactHash: string
  readonly version: string
  readonly activatedAt: string
  readonly scannerRulesVersion: string
  readonly riskReportHash: string
  readonly approvalHash?: string
  readonly acknowledgedFindingIds: readonly string[]
}

export interface InstalledSkillLock {
  readonly source: InstalledSkillSource
  readonly state: InstalledSkillState
  readonly activeArtifactHash: string
  readonly activeVersion: string
  readonly enabled: boolean
  readonly enabledBeforeReview?: boolean
  readonly modelInvocable: false
  readonly userInvocable: boolean
  readonly installedAt: string
  readonly updatedAt: string
  readonly scannerRulesVersion: string
  readonly riskReportHash: string
  readonly approvalHash?: string
  readonly acknowledgedFindingIds: readonly string[]
  readonly history: readonly InstalledSkillRevision[]
}

export interface SkillMarketLockfileV1 {
  readonly schemaVersion: typeof SKILL_MARKET_LOCKFILE_SCHEMA_VERSION
  readonly revision: number
  readonly installed: Readonly<Record<string, InstalledSkillLock>>
}

export class UnsupportedSkillMarketSchemaError extends Error {
  readonly readOnly = true

  constructor(readonly foundVersion: number) {
    super(`skill market lockfile schema ${foundVersion} is newer than supported schema ${SKILL_MARKET_LOCKFILE_SCHEMA_VERSION}`)
    this.name = 'UnsupportedSkillMarketSchemaError'
  }
}

export class SkillMarketRevisionConflictError extends Error {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`skill market lockfile revision conflict: expected ${expectedRevision}, got ${actualRevision}`)
    this.name = 'SkillMarketRevisionConflictError'
  }
}

export function emptySkillMarketLockfile(): SkillMarketLockfileV1 {
  return { schemaVersion: SKILL_MARKET_LOCKFILE_SCHEMA_VERSION, revision: 0, installed: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
}

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`)
}

function assertSha256(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be SHA-256`)
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${field} must be an array of strings`)
}

function parseSource(value: unknown, field: string): InstalledSkillSource {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  if (value.kind === 'curated') {
    if (!Number.isSafeInteger(value.catalogSerial) || Number(value.catalogSerial) < 1) {
      throw new Error(`${field}.catalogSerial must be a positive integer`)
    }
    assertString(value.skillId, `${field}.skillId`)
    return { kind: 'curated', catalogSerial: value.catalogSerial as number, skillId: value.skillId }
  }
  if (value.kind === 'github') {
    assertString(value.owner, `${field}.owner`)
    assertString(value.repo, `${field}.repo`)
    assertString(value.commit, `${field}.commit`)
    assertString(value.subdir, `${field}.subdir`)
    if (!/^[a-f0-9]{40}$/.test(value.commit)) throw new Error(`${field}.commit must be a full SHA-1`)
    return { kind: 'github', owner: value.owner, repo: value.repo, commit: value.commit, subdir: value.subdir }
  }
  throw new Error(`${field}.kind is unsupported`)
}

function parseRevision(value: unknown, field: string): InstalledSkillRevision {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  const source = parseSource(value.source, `${field}.source`)
  assertSha256(value.artifactHash, `${field}.artifactHash`)
  assertString(value.version, `${field}.version`)
  assertString(value.activatedAt, `${field}.activatedAt`)
  assertString(value.scannerRulesVersion, `${field}.scannerRulesVersion`)
  assertSha256(value.riskReportHash, `${field}.riskReportHash`)
  if (value.approvalHash !== undefined) assertSha256(value.approvalHash, `${field}.approvalHash`)
  assertStringArray(value.acknowledgedFindingIds, `${field}.acknowledgedFindingIds`)
  return {
    source,
    artifactHash: value.artifactHash,
    version: value.version,
    activatedAt: value.activatedAt,
    scannerRulesVersion: value.scannerRulesVersion,
    riskReportHash: value.riskReportHash,
    ...value.approvalHash === undefined ? {} : { approvalHash: value.approvalHash },
    acknowledgedFindingIds: value.acknowledgedFindingIds,
  }
}

function parseInstalled(value: unknown, field: string): InstalledSkillLock {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  const source = parseSource(value.source, `${field}.source`)
  if (!['ready', 'missing-artifact', 'review-required', 'blocked'].includes(String(value.state))) {
    throw new Error(`${field}.state is unsupported`)
  }
  assertSha256(value.activeArtifactHash, `${field}.activeArtifactHash`)
  assertString(value.activeVersion, `${field}.activeVersion`)
  assertBoolean(value.enabled, `${field}.enabled`)
  if (value.enabledBeforeReview !== undefined) assertBoolean(value.enabledBeforeReview, `${field}.enabledBeforeReview`)
  if (value.modelInvocable !== false) throw new Error(`${field}.modelInvocable must be false`)
  assertBoolean(value.userInvocable, `${field}.userInvocable`)
  assertString(value.installedAt, `${field}.installedAt`)
  assertString(value.updatedAt, `${field}.updatedAt`)
  assertString(value.scannerRulesVersion, `${field}.scannerRulesVersion`)
  assertSha256(value.riskReportHash, `${field}.riskReportHash`)
  if (value.approvalHash !== undefined) assertSha256(value.approvalHash, `${field}.approvalHash`)
  assertStringArray(value.acknowledgedFindingIds, `${field}.acknowledgedFindingIds`)
  if (!Array.isArray(value.history)) throw new Error(`${field}.history must be an array`)
  if (value.state !== 'ready' && value.enabled) throw new Error(`${field} cannot enable a non-ready artifact`)
  if (value.enabled !== value.userInvocable) throw new Error(`${field}.enabled and userInvocable must match`)
  return {
    source,
    state: value.state as InstalledSkillState,
    activeArtifactHash: value.activeArtifactHash,
    activeVersion: value.activeVersion,
    enabled: value.enabled,
    ...value.enabledBeforeReview === undefined ? {} : { enabledBeforeReview: value.enabledBeforeReview },
    modelInvocable: false,
    userInvocable: value.userInvocable,
    installedAt: value.installedAt,
    updatedAt: value.updatedAt,
    scannerRulesVersion: value.scannerRulesVersion,
    riskReportHash: value.riskReportHash,
    ...value.approvalHash === undefined ? {} : { approvalHash: value.approvalHash },
    acknowledgedFindingIds: value.acknowledgedFindingIds,
    history: value.history.map((revision, index) => parseRevision(revision, `${field}.history[${index}]`)),
  }
}

/** Parse and validate an existing lockfile. Schema migrations are explicit; v1 has no predecessors. */
export function parseSkillMarketLockfile(value: unknown): SkillMarketLockfileV1 {
  if (!isRecord(value)) throw new Error('skill market lockfile must be an object')
  if (!Number.isSafeInteger(value.schemaVersion) || Number(value.schemaVersion) < 1) {
    throw new Error('skill market lockfile schemaVersion must be a positive integer')
  }
  if (Number(value.schemaVersion) > SKILL_MARKET_LOCKFILE_SCHEMA_VERSION) {
    throw new UnsupportedSkillMarketSchemaError(Number(value.schemaVersion))
  }
  if (value.schemaVersion !== SKILL_MARKET_LOCKFILE_SCHEMA_VERSION) {
    throw new Error(`no migration registered for skill market lockfile schema ${String(value.schemaVersion)}`)
  }
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
    throw new Error('skill market lockfile revision must be a non-negative integer')
  }
  if (!isRecord(value.installed)) throw new Error('skill market lockfile installed must be an object')
  const installed: Record<string, InstalledSkillLock> = {}
  for (const [skillId, lock] of Object.entries(value.installed)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillId)) throw new Error(`invalid installed skill id ${skillId}`)
    installed[skillId] = parseInstalled(lock, `installed.${skillId}`)
  }
  return {
    schemaVersion: SKILL_MARKET_LOCKFILE_SCHEMA_VERSION,
    revision: value.revision as number,
    installed,
  }
}
