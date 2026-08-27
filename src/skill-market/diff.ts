import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { atomicWriteJson, readOptionalJson, withFileLease } from './files.js'

const SHA256 = /^[a-f0-9]{64}$/
const NONE = 'none'
const MAX_CACHED_DIFF_BYTES = 128 * 1024

export type DiffFileStatus = 'added' | 'removed' | 'modified'

export interface ArtifactDiffFile {
  readonly path: string
  readonly status: DiffFileStatus
  readonly oldSha256?: string
  readonly newSha256?: string
  readonly additions: number
  readonly deletions: number
  readonly binary: boolean
}

export interface ArtifactDiff {
  readonly schemaVersion: 1
  readonly oldArtifactHash?: string
  readonly newArtifactHash: string
  readonly files: readonly ArtifactDiffFile[]
  readonly omittedFiles: number
  readonly fileListTruncated: boolean
  readonly changedFiles: number
  readonly additions: number
  readonly deletions: number
  readonly changedLines: number
  readonly patch: string
  readonly truncated: boolean
  readonly responseBytes: number
}

export interface ArtifactDiffLimits {
  readonly maxResponseBytes: number
  readonly maxChangedLines: number
  readonly maxTextFileBytes: number
  readonly contextLines: number
}

const DEFAULT_DIFF_LIMITS: ArtifactDiffLimits = {
  // Leave headroom for the Host API envelope while keeping the full response below 128 KiB.
  maxResponseBytes: 112 * 1024,
  maxChangedLines: 2_000,
  maxTextFileBytes: 512 * 1024,
  contextLines: 3,
}

interface FileEntry {
  readonly path: string
  readonly bytes: Buffer
  readonly sha256: string
}

function checkedLimits(value: Partial<ArtifactDiffLimits> | undefined): ArtifactDiffLimits {
  const limits = { ...DEFAULT_DIFF_LIMITS, ...value }
  for (const [key, limit] of Object.entries(limits)) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(`${key} must be a positive integer`)
  }
  return limits
}

async function collectFiles(directory: string | undefined): Promise<Map<string, FileEntry>> {
  const output = new Map<string, FileEntry>()
  if (directory === undefined) return output
  const root = resolve(directory)
  const rootDetails = await lstat(root)
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) throw new Error('diff root must be a real directory')
  async function visit(current: string): Promise<void> {
    const entries = (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      const absolute = join(current, entry.name)
      const details = await lstat(absolute)
      const path = relative(root, absolute).split(sep).join('/')
      if (details.isSymbolicLink()) throw new Error(`diff input contains symbolic link ${path}`)
      if (details.isDirectory()) await visit(absolute)
      else if (details.isFile()) {
        const bytes = await readFile(absolute)
        output.set(path, { path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') })
      } else throw new Error(`diff input contains unsupported entry ${path}`)
    }
  }
  await visit(root)
  return output
}

function isText(bytes: Buffer, maxBytes: number): boolean {
  if (bytes.length > maxBytes || bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0)) return false
  return !bytes.toString('utf8').includes('\uFFFD')
}

function lines(bytes: Buffer): string[] {
  const text = bytes.toString('utf8').replace(/\r\n/gu, '\n')
  if (text === '') return []
  const output = text.split('\n')
  if (output.at(-1) === '') output.pop()
  return output
}

interface TextChange {
  readonly patchLines: readonly string[]
  readonly additions: number
  readonly deletions: number
  readonly emittedChangedLines: number
  readonly truncated: boolean
}

function textChange(oldBytes: Buffer, newBytes: Buffer, limits: ArtifactDiffLimits, remainingLines: number): TextChange {
  const oldLines = lines(oldBytes)
  const newLines = lines(newBytes)
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1
  const removed = oldLines.slice(prefix, oldLines.length - suffix)
  const added = newLines.slice(prefix, newLines.length - suffix)
  const patchLines: string[] = []
  const before = oldLines.slice(Math.max(0, prefix - limits.contextLines), prefix)
  const after = oldLines.slice(oldLines.length - suffix, oldLines.length - suffix + limits.contextLines)
  for (const line of before) patchLines.push(` ${line}`)
  let emittedChangedLines = 0
  let truncated = false
  for (const [marker, changed] of [['-', removed], ['+', added]] as const) {
    for (const line of changed) {
      if (emittedChangedLines >= remainingLines) { truncated = true; break }
      patchLines.push(`${marker}${line}`)
      emittedChangedLines += 1
    }
    if (truncated) break
  }
  if (truncated) patchLines.push('… diff line limit reached …')
  else for (const line of after) patchLines.push(` ${line}`)
  return {
    patchLines,
    additions: added.length,
    deletions: removed.length,
    emittedChangedLines,
    truncated,
  }
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

/** Produce a deterministic bounded file and text diff. */
export async function diffArtifactDirectories(
  oldDirectory: string | undefined,
  newDirectory: string,
  oldArtifactHash: string | undefined,
  newArtifactHash: string,
  configuredLimits?: Partial<ArtifactDiffLimits>,
): Promise<ArtifactDiff> {
  if (oldArtifactHash !== undefined && !SHA256.test(oldArtifactHash)) throw new Error('oldArtifactHash must be SHA-256')
  if (!SHA256.test(newArtifactHash)) throw new Error('newArtifactHash must be SHA-256')
  const limits = checkedLimits(configuredLimits)
  const [oldFiles, newFiles] = await Promise.all([collectFiles(oldDirectory), collectFiles(newDirectory)])
  const paths = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort()
  const files: ArtifactDiffFile[] = []
  const patch: string[] = []
  let additions = 0
  let deletions = 0
  let changedLines = 0
  let truncated = false
  for (const path of paths) {
    const oldFile = oldFiles.get(path)
    const newFile = newFiles.get(path)
    if (oldFile?.sha256 === newFile?.sha256) continue
    const status: DiffFileStatus = oldFile === undefined ? 'added' : newFile === undefined ? 'removed' : 'modified'
    const oldBytes = oldFile?.bytes ?? Buffer.alloc(0)
    const newBytes = newFile?.bytes ?? Buffer.alloc(0)
    const binary = !isText(oldBytes, limits.maxTextFileBytes) || !isText(newBytes, limits.maxTextFileBytes)
    let fileAdditions = 0
    let fileDeletions = 0
    if (binary) {
      patch.push(`diff -- ${path}`, `Binary file ${status}`)
    } else {
      const change = textChange(oldBytes, newBytes, limits, Math.max(0, limits.maxChangedLines - changedLines))
      fileAdditions = change.additions
      fileDeletions = change.deletions
      changedLines += change.emittedChangedLines
      additions += change.additions
      deletions += change.deletions
      patch.push(`diff -- ${path}`, `--- ${oldFile === undefined ? '/dev/null' : `a/${path}`}`, `+++ ${newFile === undefined ? '/dev/null' : `b/${path}`}`, ...change.patchLines)
      truncated ||= change.truncated
    }
    files.push({
      path,
      status,
      ...oldFile === undefined ? {} : { oldSha256: oldFile.sha256 },
      ...newFile === undefined ? {} : { newSha256: newFile.sha256 },
      additions: fileAdditions,
      deletions: fileDeletions,
      binary,
    })
    if (changedLines >= limits.maxChangedLines) { truncated = true; break }
  }

  const changedFiles = paths.filter(path => oldFiles.get(path)?.sha256 !== newFiles.get(path)?.sha256).length
  let visibleFiles = [...files]
  let patchLines = [...patch]
  let omittedFiles = changedFiles - visibleFiles.length
  let result: ArtifactDiff
  while (true) {
    result = {
      schemaVersion: 1,
      ...oldArtifactHash === undefined ? {} : { oldArtifactHash },
      newArtifactHash,
      files: visibleFiles,
      omittedFiles,
      fileListTruncated: omittedFiles > 0,
      changedFiles,
      additions,
      deletions,
      changedLines,
      patch: patchLines.join('\n'),
      truncated: truncated || omittedFiles > 0,
      responseBytes: 0,
    }
    let measured = byteLength(result)
    while (true) {
      const withMeasurement = { ...result, responseBytes: measured }
      const next = byteLength(withMeasurement)
      result = withMeasurement
      if (next === measured) break
      measured = next
    }
    if (byteLength(result) <= limits.maxResponseBytes) break
    truncated = true
    if (patchLines.length > 0) patchLines = patchLines.slice(0, Math.max(0, patchLines.length - 32))
    else if (visibleFiles.length > 0) {
      visibleFiles = visibleFiles.slice(0, -1)
      omittedFiles = changedFiles - visibleFiles.length
    } else throw new Error('diff summary cannot fit response limit')
  }
  return result
}

interface CachedDiffV1 {
  readonly schemaVersion: 1
  readonly oldArtifactHash?: string
  readonly newArtifactHash: string
  readonly lastAccessedAt: string
  readonly diff: ArtifactDiff
}

export interface ArtifactDiffCacheOptions {
  readonly maxEntries?: number
  readonly maxBytes?: number
  readonly now?: () => Date
}

/** Disk-bounded LRU cache keyed only by immutable Artifact hashes. */
export class ArtifactDiffCache {
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly now: () => Date

  constructor(private readonly directory: string, options: ArtifactDiffCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 32
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024
    this.now = options.now ?? (() => new Date())
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) throw new Error('maxEntries must be positive')
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1) throw new Error('maxBytes must be positive')
  }

  async getOrCreate(
    oldArtifactHash: string | undefined,
    newArtifactHash: string,
    create: () => Promise<ArtifactDiff>,
  ): Promise<{ readonly diff: ArtifactDiff; readonly cacheHit: boolean }> {
    if (oldArtifactHash !== undefined && !SHA256.test(oldArtifactHash)) throw new Error('oldArtifactHash must be SHA-256')
    if (!SHA256.test(newArtifactHash)) throw new Error('newArtifactHash must be SHA-256')
    return withFileLease(join(this.directory, '.cache.lock'), async () => {
      const path = this.path(oldArtifactHash, newArtifactHash)
      const cached = parseCachedDiff(await readOptionalJson(path).catch(() => undefined))
      if (
        cached !== undefined
        && cached.oldArtifactHash === oldArtifactHash
        && cached.newArtifactHash === newArtifactHash
        && cached.diff.oldArtifactHash === oldArtifactHash
        && cached.diff.newArtifactHash === newArtifactHash
      ) {
        await atomicWriteJson(path, { ...cached, lastAccessedAt: this.now().toISOString() })
        return { diff: cached.diff, cacheHit: true }
      }
      const diff = await create()
      await atomicWriteJson(path, {
        schemaVersion: 1,
        ...oldArtifactHash === undefined ? {} : { oldArtifactHash },
        newArtifactHash,
        lastAccessedAt: this.now().toISOString(),
        diff,
      } satisfies CachedDiffV1)
      await this.prune()
      return { diff, cacheHit: false }
    })
  }

  async removeReferencing(artifactHash: string): Promise<string[]> {
    if (!SHA256.test(artifactHash)) throw new Error('artifactHash must be SHA-256')
    return withFileLease(join(this.directory, '.cache.lock'), async () => {
      const removed: string[] = []
      for (const entry of await readdir(this.directory, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const cached = parseCachedDiff(await readOptionalJson(join(this.directory, entry.name)).catch(() => undefined))
        if (cached?.oldArtifactHash !== artifactHash && cached?.newArtifactHash !== artifactHash) continue
        await unlink(join(this.directory, entry.name))
        removed.push(entry.name)
      }
      return removed
    })
  }

  private path(oldArtifactHash: string | undefined, newArtifactHash: string): string {
    return join(this.directory, `${oldArtifactHash ?? NONE}--${newArtifactHash}.json`)
  }

  private async prune(): Promise<void> {
    const entries: Array<{ path: string; accessed: number; bytes: number }> = []
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const path = join(this.directory, entry.name)
      const [cached, details] = await Promise.all([
        readOptionalJson(path).then(parseCachedDiff).catch(() => undefined),
        stat(path),
      ])
      entries.push({ path, accessed: cached === undefined ? 0 : Date.parse(cached.lastAccessedAt), bytes: details.size })
    }
    entries.sort((left, right) => right.accessed - left.accessed || left.path.localeCompare(right.path, 'en'))
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0)
    while (entries.length > this.maxEntries || total > this.maxBytes) {
      const entry = entries.pop()!
      await unlink(entry.path)
      total -= entry.bytes
    }
  }
}

function parseCachedDiff(value: unknown): CachedDiffV1 | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 || typeof record.lastAccessedAt !== 'string' || typeof record.newArtifactHash !== 'string') return undefined
  if (!SHA256.test(record.newArtifactHash) || (record.oldArtifactHash !== undefined && (typeof record.oldArtifactHash !== 'string' || !SHA256.test(record.oldArtifactHash)))) return undefined
  if (!isArtifactDiff(record.diff) || byteLength(record.diff) > MAX_CACHED_DIFF_BYTES) return undefined
  return value as CachedDiffV1
}

function isArtifactDiff(value: unknown): value is ArtifactDiff {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 || typeof record.newArtifactHash !== 'string' || !SHA256.test(record.newArtifactHash)) return false
  if (record.oldArtifactHash !== undefined && (typeof record.oldArtifactHash !== 'string' || !SHA256.test(record.oldArtifactHash))) return false
  if (!Array.isArray(record.files) || record.files.length > 100_000 || typeof record.patch !== 'string') return false
  if (typeof record.truncated !== 'boolean' || typeof record.fileListTruncated !== 'boolean') return false
  for (const field of ['omittedFiles', 'changedFiles', 'additions', 'deletions', 'changedLines', 'responseBytes'] as const) {
    if (!Number.isSafeInteger(record[field]) || Number(record[field]) < 0) return false
  }
  return record.files.every(file => {
    if (typeof file !== 'object' || file === null || Array.isArray(file)) return false
    const entry = file as Record<string, unknown>
    return typeof entry.path === 'string'
      && ['added', 'removed', 'modified'].includes(String(entry.status))
      && typeof entry.binary === 'boolean'
      && Number.isSafeInteger(entry.additions) && Number(entry.additions) >= 0
      && Number.isSafeInteger(entry.deletions) && Number(entry.deletions) >= 0
      && (entry.oldSha256 === undefined || (typeof entry.oldSha256 === 'string' && SHA256.test(entry.oldSha256)))
      && (entry.newSha256 === undefined || (typeof entry.newSha256 === 'string' && SHA256.test(entry.newSha256)))
  })
}
