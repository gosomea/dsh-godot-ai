import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  assertPathInside,
  atomicWriteJson,
  hashArtifactDirectory,
  materializeArtifact,
  pathExists,
  readOptionalJson,
  withFileLease,
} from './files.js'
import {
  SkillMarketRevisionConflictError,
  emptySkillMarketLockfile,
  parseSkillMarketLockfile,
  type InstalledSkillLock,
  type InstalledSkillRevision,
  type InstalledSkillSource,
  type SkillMarketLockfileV1,
} from './lockfile.js'
import { resolveSkillMarketPaths, type SkillMarketPaths } from './paths.js'
import {
  reviewRiskReport,
  verifyRiskApproval,
  type RiskAcknowledgement,
  type SkillRiskApproval,
} from './approval.js'
import { verifyRiskReport, type SkillRiskReport } from './scanner.js'
import { ArtifactDiffCache } from './diff.js'

const SHA256 = /^[a-f0-9]{64}$/
const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface SkillMarketStoreOptions {
  readonly dshHome?: string
  readonly now?: () => Date
  readonly historyLimit?: number
  readonly inspectionTtlMs?: number
  readonly trashRetentionMs?: number
}

export interface InstallPreparedSkillInput {
  readonly skillId: string
  readonly version: string
  readonly source: InstalledSkillSource
  readonly stagedDirectory: string
  readonly expectedArtifactHash?: string
  readonly scannerRulesVersion: string
  readonly riskReportHash: string
  readonly approvalHash?: string
  readonly acknowledgedFindingIds?: readonly string[]
  readonly expectedRevision?: number
}

export interface InstallReviewedSkillInput {
  readonly skillId: string
  readonly version: string
  readonly source: InstalledSkillSource
  readonly stagedDirectory: string
  readonly riskReport: SkillRiskReport
  readonly approval: SkillRiskApproval
  readonly expectedRevision?: number
}

export interface GarbageCollectionReport {
  readonly movedArtifacts: readonly string[]
  readonly movedStaging: readonly string[]
  readonly movedQuarantine: readonly string[]
  readonly movedTemporaryEntries: readonly string[]
  readonly purgedTrash: readonly string[]
}

interface TrashMetadata {
  readonly schemaVersion: 1
  readonly kind: 'artifact' | 'staging' | 'quarantine' | 'temporary'
  readonly originalName: string
  readonly artifactHash?: string
  readonly trashedAt: string
  readonly purgeAfter: string
}

interface InspectionReference {
  readonly artifactHash: string
  readonly expiresAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertSha256(value: string, field: string): void {
  if (!SHA256.test(value)) throw new Error(`${field} must be SHA-256`)
}

function assertInstallInput(input: InstallPreparedSkillInput): void {
  if (!SKILL_ID.test(input.skillId)) throw new Error('skillId must be kebab-case')
  if (input.version.length === 0) throw new Error('version must be non-empty')
  if (input.scannerRulesVersion.length === 0) throw new Error('scannerRulesVersion must be non-empty')
  assertSha256(input.riskReportHash, 'riskReportHash')
  if (input.approvalHash !== undefined) assertSha256(input.approvalHash, 'approvalHash')
  if (input.expectedArtifactHash !== undefined) assertSha256(input.expectedArtifactHash, 'expectedArtifactHash')
}

function revisionOf(lock: InstalledSkillLock): InstalledSkillRevision {
  return {
    source: lock.source,
    artifactHash: lock.activeArtifactHash,
    version: lock.activeVersion,
    activatedAt: lock.updatedAt,
    scannerRulesVersion: lock.scannerRulesVersion,
    riskReportHash: lock.riskReportHash,
    ...lock.approvalHash === undefined ? {} : { approvalHash: lock.approvalHash },
    acknowledgedFindingIds: lock.acknowledgedFindingIds,
  }
}

function uniqueHistory(history: readonly InstalledSkillRevision[], limit: number): InstalledSkillRevision[] {
  const seen = new Set<string>()
  const result: InstalledSkillRevision[] = []
  for (const revision of history) {
    if (seen.has(revision.artifactHash)) continue
    seen.add(revision.artifactHash)
    result.push(revision)
    if (result.length >= limit) break
  }
  return result
}

function parseTrashMetadata(value: unknown): TrashMetadata | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined
  if (!['artifact', 'staging', 'quarantine', 'temporary'].includes(String(value.kind))) return undefined
  if (typeof value.originalName !== 'string' || typeof value.trashedAt !== 'string' || typeof value.purgeAfter !== 'string') return undefined
  if (basename(value.originalName) !== value.originalName || value.originalName.length === 0) return undefined
  if (value.artifactHash !== undefined && (typeof value.artifactHash !== 'string' || !SHA256.test(value.artifactHash))) return undefined
  return {
    schemaVersion: 1,
    kind: value.kind as TrashMetadata['kind'],
    originalName: value.originalName,
    ...value.artifactHash === undefined ? {} : { artifactHash: value.artifactHash },
    trashedAt: value.trashedAt,
    purgeAfter: value.purgeAfter,
  }
}

/** Content-addressed local store and lockfile owner for third-party skills. */
export class SkillMarketStore {
  readonly paths: SkillMarketPaths
  private readonly now: () => Date
  private readonly historyLimit: number
  private readonly inspectionTtlMs: number
  private readonly trashRetentionMs: number
  private mutation: Promise<void> = Promise.resolve()

  constructor(options: SkillMarketStoreOptions = {}) {
    this.paths = resolveSkillMarketPaths(options.dshHome)
    this.now = options.now ?? (() => new Date())
    this.historyLimit = options.historyLimit ?? 3
    this.inspectionTtlMs = options.inspectionTtlMs ?? 30 * 60_000
    this.trashRetentionMs = options.trashRetentionMs ?? 7 * 24 * 60 * 60_000
    if (!Number.isSafeInteger(this.historyLimit) || this.historyLimit < 1) throw new Error('historyLimit must be a positive integer')
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.paths.catalog,
      this.paths.artifacts,
      this.paths.store,
      this.paths.quarantine,
      this.paths.staging,
      this.paths.trash,
      this.paths.diffCache,
    ].map(directory => mkdir(directory, { recursive: true })))
  }

  async readLockfile(): Promise<SkillMarketLockfileV1> {
    const value = await readOptionalJson(this.paths.lockfile)
    return value === undefined ? emptySkillMarketLockfile() : parseSkillMarketLockfile(value)
  }

  artifactPath(artifactHash: string): string {
    assertSha256(artifactHash, 'artifactHash')
    const path = join(this.paths.artifacts, artifactHash)
    assertPathInside(this.paths.artifacts, path)
    return path
  }

  /** Low-level persistence primitive for recovery/tests; host code must call installReviewed(). */
  async installPrepared(input: InstallPreparedSkillInput): Promise<InstalledSkillLock> {
    assertInstallInput(input)
    await this.initialize()
    return this.mutate(input.expectedRevision, async lockfile => {
      const materialized = await materializeArtifact(this.paths.artifacts, input.stagedDirectory, input.expectedArtifactHash)
      const timestamp = this.now().toISOString()
      const previous = lockfile.installed[input.skillId]
      const history = previous === undefined
        ? []
        : uniqueHistory([revisionOf(previous), ...previous.history], this.historyLimit)
      const installed: InstalledSkillLock = {
        source: input.source,
        state: 'ready',
        activeArtifactHash: materialized.artifactHash,
        activeVersion: input.version,
        enabled: false,
        modelInvocable: false,
        userInvocable: false,
        installedAt: previous?.installedAt ?? timestamp,
        updatedAt: timestamp,
        scannerRulesVersion: input.scannerRulesVersion,
        riskReportHash: input.riskReportHash,
        ...input.approvalHash === undefined ? {} : { approvalHash: input.approvalHash },
        acknowledgedFindingIds: input.acknowledgedFindingIds ?? [],
        history: history.filter(revision => revision.artifactHash !== materialized.artifactHash),
      }
      return {
        result: installed,
        lockfile: {
          ...lockfile,
          installed: { ...lockfile.installed, [input.skillId]: installed },
        },
      }
    })
  }

  /** Security-gated install entrypoint for host/API code. */
  async installReviewed(input: InstallReviewedSkillInput): Promise<InstalledSkillLock> {
    verifyRiskReport(input.riskReport)
    if (input.riskReport.blocked) throw new Error(`skill ${input.skillId} is blocked by critical risk findings`)
    verifyRiskApproval(input.riskReport, input.approval)
    return this.installPrepared({
      skillId: input.skillId,
      version: input.version,
      source: input.source,
      stagedDirectory: input.stagedDirectory,
      expectedArtifactHash: input.riskReport.artifactHash,
      scannerRulesVersion: input.riskReport.scannerRulesVersion,
      riskReportHash: input.riskReport.riskReportHash,
      approvalHash: input.approval.approvalHash,
      acknowledgedFindingIds: input.approval.acknowledgedFindingIds,
      ...input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision },
    })
  }

  async setEnabled(skillId: string, enabled: boolean, expectedRevision?: number): Promise<InstalledSkillLock> {
    return this.mutate(expectedRevision, async lockfile => {
      const current = lockfile.installed[skillId]
      if (current === undefined) throw new Error(`skill ${skillId} is not installed`)
      if (enabled && current.state !== 'ready') throw new Error(`skill ${skillId} has no readable active artifact`)
      if (enabled && current.approvalHash === undefined) throw new Error(`skill ${skillId} has not completed risk approval`)
      if (enabled && !await this.isValidArtifact(current.activeArtifactHash)) {
        throw new Error(`skill ${skillId} active artifact failed integrity verification`)
      }
      const updated: InstalledSkillLock = {
        ...current,
        enabled,
        userInvocable: enabled,
        updatedAt: this.now().toISOString(),
      }
      return {
        result: updated,
        lockfile: { ...lockfile, installed: { ...lockfile.installed, [skillId]: updated } },
      }
    })
  }

  /** Fail closed before rescanning artifacts under a new scanner rules version. */
  async beginScannerUpgrade(scannerRulesVersion: string, expectedRevision?: number): Promise<number> {
    if (scannerRulesVersion.length === 0) throw new Error('scannerRulesVersion must be non-empty')
    return this.mutate(expectedRevision, lockfile => {
      let changed = 0
      const installed: Record<string, InstalledSkillLock> = {}
      for (const [skillId, current] of Object.entries(lockfile.installed)) {
        if (current.scannerRulesVersion === scannerRulesVersion || current.state === 'missing-artifact') {
          installed[skillId] = current
          continue
        }
        changed += 1
        installed[skillId] = {
          ...current,
          state: 'review-required',
          enabledBeforeReview: current.enabledBeforeReview ?? current.enabled,
          enabled: false,
          userInvocable: false,
          updatedAt: this.now().toISOString(),
        }
      }
      return {
        result: changed,
        lockfile: changed === 0 ? lockfile : { ...lockfile, installed },
        changed: changed > 0,
      }
    }, { allowUnchanged: true })
  }

  /** Apply a verified rescan, preserving prior enablement only after all required review is complete. */
  async applyRescan(
    skillId: string,
    report: SkillRiskReport,
    acknowledgements: readonly RiskAcknowledgement[],
    expectedRevision?: number,
  ): Promise<InstalledSkillLock> {
    verifyRiskReport(report)
    const review = reviewRiskReport(report, acknowledgements)
    return this.mutate(expectedRevision, async lockfile => {
      const current = lockfile.installed[skillId]
      if (current === undefined) throw new Error(`skill ${skillId} is not installed`)
      if (current.activeArtifactHash !== report.artifactHash) throw new Error(`risk report does not match ${skillId} active artifact`)
      if (!await this.isValidArtifact(current.activeArtifactHash)) throw new Error(`skill ${skillId} active artifact failed integrity verification`)
      const restoreEnabled = current.enabledBeforeReview ?? false
      const {
        approvalHash: _previousApprovalHash,
        enabledBeforeReview: _previousEnabledBeforeReview,
        ...currentWithoutReview
      } = current
      const timestamp = this.now().toISOString()
      let updated: InstalledSkillLock
      if (review.status === 'blocked') {
        updated = {
          ...currentWithoutReview,
          state: 'blocked',
          enabled: false,
          userInvocable: false,
          scannerRulesVersion: report.scannerRulesVersion,
          riskReportHash: report.riskReportHash,
          acknowledgedFindingIds: [],
          updatedAt: timestamp,
        }
      } else if (review.status === 'review-required') {
        updated = {
          ...currentWithoutReview,
          state: 'review-required',
          enabledBeforeReview: current.enabledBeforeReview ?? current.enabled,
          enabled: false,
          userInvocable: false,
          scannerRulesVersion: report.scannerRulesVersion,
          riskReportHash: report.riskReportHash,
          acknowledgedFindingIds: acknowledgements.map(item => item.findingId).sort(),
          updatedAt: timestamp,
        }
      } else {
        updated = {
          ...currentWithoutReview,
          state: 'ready',
          enabled: restoreEnabled,
          userInvocable: restoreEnabled,
          scannerRulesVersion: report.scannerRulesVersion,
          riskReportHash: report.riskReportHash,
          approvalHash: review.approval.approvalHash,
          acknowledgedFindingIds: review.approval.acknowledgedFindingIds,
          updatedAt: timestamp,
        }
      }
      return {
        result: updated,
        lockfile: { ...lockfile, installed: { ...lockfile.installed, [skillId]: updated } },
      }
    })
  }

  async rollback(skillId: string, artifactHash: string, expectedRevision?: number): Promise<InstalledSkillLock> {
    assertSha256(artifactHash, 'artifactHash')
    return this.mutate(expectedRevision, async lockfile => {
      const artifactPath = this.artifactPath(artifactHash)
      if (!await pathExists(artifactPath)) throw new Error(`rollback artifact ${artifactHash} is missing`)
      if (await hashArtifactDirectory(artifactPath) !== artifactHash) throw new Error(`rollback artifact ${artifactHash} failed integrity verification`)
      const current = lockfile.installed[skillId]
      if (current === undefined) throw new Error(`skill ${skillId} is not installed`)
      const target = current.history.find(revision => revision.artifactHash === artifactHash)
      if (target === undefined) throw new Error(`artifact ${artifactHash} is not in ${skillId} history`)
      const history = uniqueHistory([
        revisionOf(current),
        ...current.history.filter(revision => revision.artifactHash !== artifactHash),
      ], this.historyLimit)
      const timestamp = this.now().toISOString()
      const rolledBack: InstalledSkillLock = {
        source: target.source,
        state: 'ready',
        activeArtifactHash: target.artifactHash,
        activeVersion: target.version,
        enabled: false,
        modelInvocable: false,
        userInvocable: false,
        installedAt: current.installedAt,
        updatedAt: timestamp,
        scannerRulesVersion: target.scannerRulesVersion,
        riskReportHash: target.riskReportHash,
        ...target.approvalHash === undefined ? {} : { approvalHash: target.approvalHash },
        acknowledgedFindingIds: target.acknowledgedFindingIds,
        history,
      }
      return {
        result: rolledBack,
        lockfile: { ...lockfile, installed: { ...lockfile.installed, [skillId]: rolledBack } },
      }
    })
  }

  async uninstall(skillId: string, expectedRevision?: number): Promise<boolean> {
    return this.mutate(expectedRevision, lockfile => {
      if (lockfile.installed[skillId] === undefined) return { result: false, lockfile, changed: false }
      const installed = { ...lockfile.installed }
      delete installed[skillId]
      return { result: true, lockfile: { ...lockfile, installed } }
    })
  }

  /** Repair interrupted temporary entries and fail closed on missing active artifacts. */
  async recover(): Promise<SkillMarketLockfileV1> {
    await this.initialize()
    await this.mutate(undefined, async lockfile => {
      await this.moveArtifactTemporariesToTrash()
      let changed = false
      const installed: Record<string, InstalledSkillLock> = { ...lockfile.installed }
      for (const [skillId, current] of Object.entries(lockfile.installed)) {
        if (await this.isValidArtifact(current.activeArtifactHash)) continue
        const fallback = await this.firstValidRevision(current.history)
        changed = true
        if (fallback === undefined) {
          installed[skillId] = {
            ...current,
            state: 'missing-artifact',
            enabled: false,
            userInvocable: false,
            updatedAt: this.now().toISOString(),
          }
          continue
        }
        installed[skillId] = {
          source: fallback.source,
          state: 'ready',
          activeArtifactHash: fallback.artifactHash,
          activeVersion: fallback.version,
          enabled: false,
          modelInvocable: false,
          userInvocable: false,
          installedAt: current.installedAt,
          updatedAt: this.now().toISOString(),
          scannerRulesVersion: fallback.scannerRulesVersion,
          riskReportHash: fallback.riskReportHash,
          ...fallback.approvalHash === undefined ? {} : { approvalHash: fallback.approvalHash },
          acknowledgedFindingIds: fallback.acknowledgedFindingIds,
          history: uniqueHistory([revisionOf(current), ...current.history.filter(item => item.artifactHash !== fallback.artifactHash)], this.historyLimit),
        }
      }
      return { result: undefined, lockfile: changed ? { ...lockfile, installed } : lockfile, changed }
    }, { allowUnchanged: true })
    return this.readLockfile()
  }

  async garbageCollect(): Promise<GarbageCollectionReport> {
    await this.initialize()
    return this.exclusive(() => withFileLease(this.paths.mutationLock, async () => {
      const lockfile = await this.readLockfile()
      const live = new Set<string>()
      for (const installed of Object.values(lockfile.installed)) {
        live.add(installed.activeArtifactHash)
        for (const revision of installed.history) live.add(revision.artifactHash)
      }
      const movedStaging: string[] = []
      const liveInspectionIds = new Set<string>()
      for (const entry of await readdir(this.paths.staging, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const directory = join(this.paths.staging, entry.name)
        const reference = await this.readLiveInspectionReference(directory)
        if (reference !== undefined) {
          live.add(reference.artifactHash)
          liveInspectionIds.add(entry.name)
        }
        else {
          await this.moveToTrash(directory, 'staging', entry.name)
          movedStaging.push(entry.name)
        }
      }
      const movedQuarantine: string[] = []
      for (const entry of await readdir(this.paths.quarantine, { withFileTypes: true })) {
        if (!entry.isDirectory() || liveInspectionIds.has(entry.name)) continue
        await this.moveToTrash(join(this.paths.quarantine, entry.name), 'quarantine', entry.name)
        movedQuarantine.push(entry.name)
      }
      const movedTemporaryEntries = await this.moveArtifactTemporariesToTrash()
      const movedArtifacts: string[] = []
      for (const entry of await readdir(this.paths.artifacts, { withFileTypes: true })) {
        if (!entry.isDirectory() || !SHA256.test(entry.name) || live.has(entry.name)) continue
        await this.moveToTrash(join(this.paths.artifacts, entry.name), 'artifact', entry.name, entry.name)
        movedArtifacts.push(entry.name)
      }
      const purgedTrash = await this.purgeExpiredTrash()
      return { movedArtifacts, movedStaging, movedQuarantine, movedTemporaryEntries, purgedTrash }
    }))
  }

  async restoreTrash(trashId: string): Promise<void> {
    if (!/^[a-zA-Z0-9._-]+$/.test(trashId)) throw new Error('invalid trash id')
    await this.exclusive(() => withFileLease(this.paths.mutationLock, async () => {
      const directory = join(this.paths.trash, trashId)
      assertPathInside(this.paths.trash, directory)
      const metadata = parseTrashMetadata(await readOptionalJson(join(directory, 'trash.json')))
      if (metadata === undefined) throw new Error(`trash entry ${trashId} has invalid metadata`)
      const payload = join(directory, 'payload')
      let destination: string
      if (metadata.kind === 'artifact') {
        if (metadata.artifactHash === undefined) throw new Error(`trash artifact ${trashId} has no hash`)
        if (await hashArtifactDirectory(payload) !== metadata.artifactHash) {
          throw new Error(`trash artifact ${trashId} failed integrity verification`)
        }
        destination = this.artifactPath(metadata.artifactHash)
      } else if (metadata.kind === 'staging') destination = join(this.paths.staging, metadata.originalName)
      else if (metadata.kind === 'quarantine') destination = join(this.paths.quarantine, metadata.originalName)
      else destination = join(this.paths.artifacts, metadata.originalName)
      if (await pathExists(destination)) throw new Error(`restore destination already exists: ${destination}`)
      await rename(payload, destination)
      await rm(directory, { recursive: true, force: true })
    }))
  }

  private async mutate<T>(
    expectedRevision: number | undefined,
    operation: (lockfile: SkillMarketLockfileV1) => Promise<MutationResult<T>> | MutationResult<T>,
    options: { allowUnchanged?: boolean } = {},
  ): Promise<T> {
    return this.exclusive(() => withFileLease(this.paths.mutationLock, async () => {
      const current = await this.readLockfile()
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new SkillMarketRevisionConflictError(expectedRevision, current.revision)
      }
      const mutation = await operation(current)
      if (options.allowUnchanged && mutation.changed === false) return mutation.result
      const next: SkillMarketLockfileV1 = {
        ...mutation.lockfile,
        schemaVersion: 1,
        revision: current.revision + 1,
      }
      await atomicWriteJson(this.paths.lockfile, next)
      return mutation.result
    }))
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation)
    this.mutation = result.then(() => undefined, () => undefined)
    return result
  }

  private async isValidArtifact(artifactHash: string): Promise<boolean> {
    const path = this.artifactPath(artifactHash)
    if (!await pathExists(path)) return false
    return await hashArtifactDirectory(path).catch(() => '') === artifactHash
  }

  private async firstValidRevision(history: readonly InstalledSkillRevision[]): Promise<InstalledSkillRevision | undefined> {
    for (const revision of history) if (await this.isValidArtifact(revision.artifactHash)) return revision
    return undefined
  }

  private async readLiveInspectionReference(directory: string): Promise<InspectionReference | undefined> {
    const value = await readOptionalJson(join(directory, 'inspection.json')).catch(() => undefined)
    if (!isRecord(value) || typeof value.artifactHash !== 'string' || !SHA256.test(value.artifactHash)) return undefined
    if (typeof value.expiresAt !== 'string') return undefined
    const expiresAt = Date.parse(value.expiresAt)
    if (Number.isNaN(expiresAt) || expiresAt <= this.now().getTime()) return undefined
    const details = await stat(directory)
    if (this.now().getTime() - details.mtimeMs > this.inspectionTtlMs) return undefined
    return { artifactHash: value.artifactHash, expiresAt: value.expiresAt }
  }

  private async moveArtifactTemporariesToTrash(): Promise<string[]> {
    const moved: string[] = []
    for (const entry of await readdir(this.paths.artifacts, { withFileTypes: true })) {
      if (!entry.name.startsWith('.tmp-')) continue
      await this.moveToTrash(join(this.paths.artifacts, entry.name), 'temporary', entry.name)
      moved.push(entry.name)
    }
    return moved
  }

  private async moveToTrash(source: string, kind: TrashMetadata['kind'], originalName: string, artifactHash?: string): Promise<string> {
    const trashId = `${this.now().getTime()}-${randomUUID()}`
    const destination = join(this.paths.trash, trashId)
    assertPathInside(this.paths.root, source)
    assertPathInside(this.paths.trash, destination)
    await mkdir(destination, { recursive: false, mode: 0o700 })
    try {
      await rename(source, join(destination, 'payload'))
      const trashedAt = this.now()
      await atomicWriteJson(join(destination, 'trash.json'), {
        schemaVersion: 1,
        kind,
        originalName,
        ...artifactHash === undefined ? {} : { artifactHash },
        trashedAt: trashedAt.toISOString(),
        purgeAfter: new Date(trashedAt.getTime() + this.trashRetentionMs).toISOString(),
      } satisfies TrashMetadata)
      return trashId
    } catch (error) {
      await rename(join(destination, 'payload'), source).catch(() => undefined)
      await rm(destination, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  private async purgeExpiredTrash(): Promise<string[]> {
    const purged: string[] = []
    for (const entry of await readdir(this.paths.trash, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const directory = join(this.paths.trash, entry.name)
      const metadata = parseTrashMetadata(await readOptionalJson(join(directory, 'trash.json')).catch(() => undefined))
      if (metadata === undefined) continue
      const purgeAfter = Date.parse(metadata.purgeAfter)
      if (Number.isNaN(purgeAfter) || purgeAfter > this.now().getTime()) continue
      assertPathInside(this.paths.trash, directory)
      if (metadata.kind === 'artifact' && metadata.artifactHash !== undefined) {
        await new ArtifactDiffCache(this.paths.diffCache, { now: this.now }).removeReferencing(metadata.artifactHash)
      }
      await rm(directory, { recursive: true, force: true })
      purged.push(entry.name)
    }
    return purged
  }
}

interface MutationResult<T> {
  readonly result: T
  readonly lockfile: SkillMarketLockfileV1
  readonly changed?: boolean
}
