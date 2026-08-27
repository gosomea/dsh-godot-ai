import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteJson, readOptionalJson, withFileLease } from './files.js'
import { GitHubImportClient, type GitHubImportSource, type ResolvedGitHubImportSource } from './github-import.js'
import { prepareThirdPartyArtifact } from './preparation.js'
import {
  SCANNER_RULES_VERSION,
  scanPreparedThirdPartyArtifact,
  verifyRiskReport,
  type SkillRiskReport,
} from './scanner.js'
import { reviewRiskReport, type RiskAcknowledgement } from './approval.js'
import { SkillMarketStore } from './store.js'
import type { InstalledSkillLock, InstalledSkillSource } from './lockfile.js'
import type { CuratedSkillEntry, SkillCatalogVerifier } from './catalog.js'
import type { CatalogRemoteClient } from './catalog-fetch.js'

export const SKILL_MARKET_API_PREFIX = '/api/dsh-godot-ai/skills'
export const STARTER_SKILL_IDS = ['game-feel', 'game-ui-ux', 'game-ui-design'] as const
const INSPECTION_ID = /^[a-f0-9-]{36}$/

export type SkillInspectRequest =
  | { readonly source: { readonly kind: 'curated'; readonly skillId: string } }
  | { readonly source: { readonly kind: 'github' } & GitHubImportSource }

export interface SkillInstallRequest {
  readonly inspectionId: string
  readonly acknowledgements: readonly RiskAcknowledgement[]
  readonly expectedRevision?: number
}

export type SkillMarketAction =
  | { readonly action: 'enable'; readonly skillId: string; readonly approvalHash: string; readonly expectedRevision?: number }
  | { readonly action: 'disable'; readonly skillId: string; readonly expectedRevision?: number }
  | { readonly action: 'uninstall'; readonly skillId: string; readonly expectedRevision?: number }
  | { readonly action: 'rollback'; readonly skillId: string; readonly artifactHash: string; readonly expectedRevision?: number }
  | { readonly action: 'restore-trash'; readonly trashId: string }
  | { readonly action: 'check-updates' }
  | { readonly action: 'gc' }

export interface SkillInspection {
  readonly schemaVersion: 1
  readonly inspectionId: string
  readonly state: 'ready' | 'consuming' | 'consumed'
  readonly skillId: string
  readonly version: string
  readonly source: InstalledSkillSource
  readonly resolvedSource: ResolvedGitHubImportSource
  readonly artifactHash: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly report: SkillRiskReport
  readonly license: { readonly id: string; readonly noticeRequired: boolean }
  readonly catalogSerial?: number
  readonly quarantinedFiles: readonly string[]
  readonly consumedAt?: string
}

export interface SkillMarketSnapshot {
  readonly schemaVersion: 1
  readonly scannerRulesVersion: string
  readonly revision: number
  readonly installed: Readonly<Record<string, InstalledSkillLock>>
  readonly catalog: readonly CuratedSkillEntry[]
  readonly starterSkillIds: typeof STARTER_SKILL_IDS
  readonly securityBoundary: string
}

export interface SkillMarketDiffSummary {
  readonly skillId: string
  readonly oldArtifactHash?: string
  readonly newArtifactHash?: string
  readonly changed: boolean
  readonly inspectionId?: string
  readonly riskReportHash?: string
  readonly findings?: SkillRiskReport['summary']
}

export interface SkillMarketServiceOptions {
  readonly store?: SkillMarketStore
  readonly github?: GitHubImportClient
  readonly catalogVerifier?: SkillCatalogVerifier
  readonly catalogRemote?: CatalogRemoteClient
  readonly now?: () => Date
  readonly inspectionTtlMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function skillId(value: unknown, field = 'skillId'): string {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) throw new Error(`${field} must be kebab-case`)
  return value
}

function optionalRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('expectedRevision must be a non-negative integer')
  return Number(value)
}

function parseAcknowledgements(value: unknown): RiskAcknowledgement[] {
  if (!Array.isArray(value)) throw new Error('acknowledgements must be an array')
  return value.map((item, index) => {
    if (!isRecord(item) || typeof item.findingId !== 'string' || !/^[a-f0-9]{64}$/u.test(item.findingId)) {
      throw new Error(`acknowledgements[${index}].findingId is invalid`)
    }
    if (item.kind !== 'accepted-risk' && item.kind !== 'false-positive') throw new Error(`acknowledgements[${index}].kind is invalid`)
    return { findingId: item.findingId, kind: item.kind }
  })
}

export function parseSkillInspectRequest(value: unknown): SkillInspectRequest {
  if (!isRecord(value) || !isRecord(value.source)) throw new Error('inspect request requires source')
  if (value.source.kind === 'curated') return { source: { kind: 'curated', skillId: skillId(value.source.skillId) } }
  if (value.source.kind !== 'github') throw new Error('inspect source kind is unsupported')
  for (const field of ['owner', 'repo', 'ref', 'subdir'] as const) {
    if (typeof value.source[field] !== 'string') throw new Error(`source.${field} must be a string`)
  }
  return {
    source: {
      kind: 'github',
      owner: value.source.owner as string,
      repo: value.source.repo as string,
      ref: value.source.ref as string,
      subdir: value.source.subdir as string,
    },
  }
}

export function parseSkillInstallRequest(value: unknown): SkillInstallRequest {
  if (!isRecord(value) || typeof value.inspectionId !== 'string' || !INSPECTION_ID.test(value.inspectionId)) {
    throw new Error('install request has an invalid inspectionId')
  }
  const expectedRevision = optionalRevision(value.expectedRevision)
  return {
    inspectionId: value.inspectionId,
    acknowledgements: parseAcknowledgements(value.acknowledgements),
    ...expectedRevision === undefined ? {} : { expectedRevision },
  }
}

export function parseSkillMarketAction(value: unknown): SkillMarketAction {
  if (!isRecord(value) || typeof value.action !== 'string') throw new Error('action request is malformed')
  const expectedRevision = optionalRevision(value.expectedRevision)
  const revision = expectedRevision === undefined ? {} : { expectedRevision }
  if (value.action === 'enable') {
    if (typeof value.approvalHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.approvalHash)) throw new Error('approvalHash is invalid')
    return { action: 'enable', skillId: skillId(value.skillId), approvalHash: value.approvalHash, ...revision }
  }
  if (value.action === 'disable' || value.action === 'uninstall') return { action: value.action, skillId: skillId(value.skillId), ...revision }
  if (value.action === 'rollback') {
    if (typeof value.artifactHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.artifactHash)) throw new Error('artifactHash is invalid')
    return { action: 'rollback', skillId: skillId(value.skillId), artifactHash: value.artifactHash, ...revision }
  }
  if (value.action === 'restore-trash') {
    if (typeof value.trashId !== 'string') throw new Error('trashId is invalid')
    return { action: 'restore-trash', trashId: value.trashId }
  }
  if (value.action === 'check-updates' || value.action === 'gc') return { action: value.action }
  throw new Error(`unsupported Skill Market action ${value.action}`)
}

function parseInspection(value: unknown): SkillInspection {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.inspectionId !== 'string' || !INSPECTION_ID.test(value.inspectionId)) {
    throw new Error('inspection manifest is malformed')
  }
  if (!['ready', 'consuming', 'consumed'].includes(String(value.state))) throw new Error('inspection state is invalid')
  if (!isRecord(value.report)) throw new Error('inspection risk report is missing')
  verifyRiskReport(value.report as unknown as SkillRiskReport)
  if (!isRecord(value.source) || !isRecord(value.resolvedSource) || !isRecord(value.license)) throw new Error('inspection source metadata is malformed')
  if (!Array.isArray(value.quarantinedFiles) || value.quarantinedFiles.some(file => typeof file !== 'string')) throw new Error('inspection quarantine list is invalid')
  return value as unknown as SkillInspection
}

export class SkillMarketService {
  readonly store: SkillMarketStore
  private readonly github: GitHubImportClient
  private readonly catalogVerifier: SkillCatalogVerifier | undefined
  private readonly catalogRemote: CatalogRemoteClient | undefined
  private readonly now: () => Date
  private readonly inspectionTtlMs: number

  constructor(options: SkillMarketServiceOptions = {}) {
    this.store = options.store ?? new SkillMarketStore()
    this.github = options.github ?? new GitHubImportClient()
    this.catalogVerifier = options.catalogVerifier
    this.catalogRemote = options.catalogRemote
    this.now = options.now ?? (() => new Date())
    this.inspectionTtlMs = options.inspectionTtlMs ?? 30 * 60_000
  }

  async initialize(): Promise<void> {
    await this.store.initialize()
    await this.store.recover()
  }

  async snapshot(): Promise<SkillMarketSnapshot> {
    await this.store.initialize()
    const [lockfile, catalog] = await Promise.all([
      this.store.readLockfile(),
      this.catalogVerifier?.readLastGoodCatalog(),
    ])
    return {
      schemaVersion: 1,
      scannerRulesVersion: SCANNER_RULES_VERSION,
      revision: lockfile.revision,
      installed: lockfile.installed,
      catalog: catalog?.skills ?? [],
      starterSkillIds: STARTER_SKILL_IDS,
      securityBoundary: '静态扫描是启发式 Guardrail，不是沙箱，也不能证明第三方 Skill 安全。',
    }
  }

  async inspect(request: SkillInspectRequest): Promise<SkillInspection> {
    await this.store.initialize()
    const inspectionId = randomUUID()
    const inspectionDirectory = join(this.store.paths.staging, inspectionId)
    const rawDirectory = join(inspectionDirectory, 'raw')
    const resourceDirectory = join(inspectionDirectory, 'resource')
    const quarantineDirectory = join(this.store.paths.quarantine, inspectionId)
    await mkdir(inspectionDirectory, { recursive: false, mode: 0o700 })
    try {
      let entry: CuratedSkillEntry | undefined
      let catalogSerial: number | undefined
      let input: GitHubImportSource
      if (request.source.kind === 'curated') {
        const curatedSkillId = request.source.skillId
        if (this.catalogVerifier === undefined) throw new Error('curated Catalog is not configured')
        const catalog = await this.catalogVerifier.readLastGoodCatalog()
        if (catalog === undefined) throw new Error('no last-good curated Catalog is available')
        entry = catalog.skills.find(skill => skill.id === curatedSkillId)
        if (entry === undefined || !entry.installable) throw new Error(`curated Skill ${curatedSkillId} is not installable`)
        catalogSerial = catalog.serial
        input = { ...entry.source, ref: entry.source.commit }
      } else input = request.source
      const resolved = await this.github.resolveCommit(input)
      await this.github.downloadSkill(resolved, rawDirectory)
      const prepared = await prepareThirdPartyArtifact(rawDirectory, resourceDirectory, quarantineDirectory)
      const report = await scanPreparedThirdPartyArtifact(prepared)
      if (entry !== undefined && prepared.artifactHash !== entry.artifactSha256) {
        throw new Error(`curated Artifact hash mismatch for ${entry.id}`)
      }
      const createdAt = this.now()
      const id = entry?.id ?? await skillIdFromPreparedReport(resourceDirectory)
      const source: InstalledSkillSource = entry === undefined
        ? { kind: 'github', owner: resolved.owner, repo: resolved.repo, commit: resolved.commit, subdir: resolved.subdir }
        : { kind: 'curated', catalogSerial: catalogSerial!, skillId: entry.id }
      const inspection: SkillInspection = {
        schemaVersion: 1,
        inspectionId,
        state: 'ready',
        skillId: id,
        version: entry?.version ?? resolved.commit.slice(0, 12),
        source,
        resolvedSource: resolved,
        artifactHash: prepared.artifactHash,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + this.inspectionTtlMs).toISOString(),
        report,
        license: entry?.license ?? { id: 'NOASSERTION', noticeRequired: true },
        ...catalogSerial === undefined ? {} : { catalogSerial },
        quarantinedFiles: prepared.quarantinedFiles,
      }
      await atomicWriteJson(join(inspectionDirectory, 'inspection.json'), inspection)
      return inspection
    } catch (error) {
      await Promise.all([
        rmInspection(inspectionDirectory),
        rmInspection(quarantineDirectory),
      ])
      throw error
    }
  }

  async install(request: SkillInstallRequest): Promise<InstalledSkillLock> {
    const directory = this.inspectionDirectory(request.inspectionId)
    return withFileLease(join(directory, '.inspection.lock'), async () => {
      const path = join(directory, 'inspection.json')
      const inspection = parseInspection(await readOptionalJson(path))
      if (inspection.state !== 'ready') throw new Error(`inspection ${request.inspectionId} is already ${inspection.state}`)
      if (Date.parse(inspection.expiresAt) <= this.now().getTime()) throw new Error(`inspection ${request.inspectionId} expired`)
      if (inspection.report.scannerRulesVersion !== SCANNER_RULES_VERSION) throw new Error('inspection uses an outdated scanner rules version')
      const review = reviewRiskReport(inspection.report, request.acknowledgements)
      if (review.status === 'blocked') throw new Error('inspection is blocked by critical findings')
      if (review.status === 'review-required') throw new Error(`${review.missingFindings.length} risk findings still require review`)
      await atomicWriteJson(path, { ...inspection, state: 'consuming' })
      const installed = await this.store.installReviewed({
        skillId: inspection.skillId,
        version: inspection.version,
        source: inspection.source,
        stagedDirectory: join(directory, 'resource'),
        riskReport: inspection.report,
        approval: review.approval,
        ...request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision },
      })
      await atomicWriteJson(path, { ...inspection, state: 'consumed', consumedAt: this.now().toISOString() })
      return installed
    })
  }

  async action(action: SkillMarketAction): Promise<unknown> {
    if (action.action === 'enable') {
      const current = (await this.store.readLockfile()).installed[action.skillId]
      if (current === undefined || current.approvalHash !== action.approvalHash) throw new Error('approvalHash does not match the installed Skill')
      if (current.scannerRulesVersion !== SCANNER_RULES_VERSION) throw new Error('installed Skill requires rescan before enablement')
      return this.store.setEnabled(action.skillId, true, action.expectedRevision)
    }
    if (action.action === 'disable') return this.store.setEnabled(action.skillId, false, action.expectedRevision)
    if (action.action === 'uninstall') return this.store.uninstall(action.skillId, action.expectedRevision)
    if (action.action === 'rollback') return this.store.rollback(action.skillId, action.artifactHash, action.expectedRevision)
    if (action.action === 'restore-trash') return this.store.restoreTrash(action.trashId)
    if (action.action === 'gc') return this.store.garbageCollect()
    if (this.catalogRemote === undefined) throw new Error('Catalog updates are not configured')
    return this.catalogRemote.check({ force: true })
  }

  async inspections(): Promise<readonly SkillInspection[]> {
    await this.store.initialize()
    const output: SkillInspection[] = []
    for (const entry of await readdir(this.store.paths.staging, { withFileTypes: true })) {
      if (!entry.isDirectory() || !INSPECTION_ID.test(entry.name)) continue
      const value = await readOptionalJson(join(this.store.paths.staging, entry.name, 'inspection.json')).catch(() => undefined)
      if (value !== undefined) output.push(parseInspection(value))
    }
    return output
  }

  async diffSummary(requestedSkillId: string): Promise<SkillMarketDiffSummary> {
    const id = skillId(requestedSkillId)
    const [lockfile, inspections] = await Promise.all([this.store.readLockfile(), this.inspections()])
    const current = lockfile.installed[id]
    const staged = inspections
      .filter(inspection => inspection.skillId === id && inspection.state === 'ready' && Date.parse(inspection.expiresAt) > this.now().getTime())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    return {
      skillId: id,
      ...current === undefined ? {} : { oldArtifactHash: current.activeArtifactHash },
      ...staged === undefined ? {} : {
        newArtifactHash: staged.artifactHash,
        inspectionId: staged.inspectionId,
        riskReportHash: staged.report.riskReportHash,
        findings: staged.report.summary,
      },
      changed: staged !== undefined && staged.artifactHash !== current?.activeArtifactHash,
    }
  }

  private inspectionDirectory(inspectionId: string): string {
    if (!INSPECTION_ID.test(inspectionId)) throw new Error('invalid inspectionId')
    return join(this.store.paths.staging, inspectionId)
  }
}

async function skillIdFromPreparedReport(resourceDirectory: string): Promise<string> {
  const markdown = await readFile(join(resourceDirectory, 'SKILL.md'), 'utf8')
  const match = /^---\r?\n[\s\S]*?^name:\s*["']?([a-z0-9]+(?:-[a-z0-9]+)*)["']?\s*$[\s\S]*?^---\s*$/mu.exec(markdown)
  if (match?.[1] === undefined) throw new Error('GitHub Skill SKILL.md has no safe frontmatter name')
  return match[1]
}

async function rmInspection(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => undefined)
}
