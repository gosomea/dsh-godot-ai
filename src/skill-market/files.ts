import { createHash, randomUUID } from 'node:crypto'
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  utimes,
} from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

export async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export function assertPathInside(root: string, target: string): void {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`path escapes skill market root: ${target}`)
  }
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    await rename(temporary, path)
    await syncDirectory(dirname(path))
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function syncDirectory(path: string): Promise<void> {
  let directory: Awaited<ReturnType<typeof open>> | undefined
  try {
    directory = await open(path, 'r')
    await directory.sync()
  } catch (error) {
    // Directory fsync is unavailable on some otherwise supported platforms.
    if (!['EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(String((error as NodeJS.ErrnoException).code))) throw error
  } finally {
    await directory?.close().catch(() => undefined)
  }
}

export async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as unknown }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function walkDirectory(root: string, current: string, visit: (entry: WalkEntry) => Promise<void>): Promise<void> {
  const entries = (await readdir(current, { withFileTypes: true })).sort((left, right) => {
    if (left.name < right.name) return -1
    if (left.name > right.name) return 1
    return 0
  })
  for (const entry of entries) {
    const absolute = join(current, entry.name)
    const relativePath = relative(root, absolute).split(sep).join('/')
    const details = await lstat(absolute)
    if (details.isSymbolicLink()) throw new Error(`skill artifact contains symbolic link ${relativePath}`)
    if (details.isDirectory()) {
      await visit({ kind: 'directory', absolute, relativePath })
      await walkDirectory(root, absolute, visit)
    } else if (details.isFile()) {
      await visit({ kind: 'file', absolute, relativePath })
    } else {
      throw new Error(`skill artifact contains unsupported entry ${relativePath}`)
    }
  }
}

type WalkEntry =
  | { readonly kind: 'directory'; readonly absolute: string; readonly relativePath: string }
  | { readonly kind: 'file'; readonly absolute: string; readonly relativePath: string }

/** Deterministic hash over names, empty directories, and file bytes. */
export async function hashArtifactDirectory(directory: string): Promise<string> {
  const root = resolve(directory)
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('skill artifact root must be a real directory')
  const hash = createHash('sha256')
  await walkDirectory(root, root, async entry => {
    hash.update(entry.kind === 'directory' ? 'd\0' : 'f\0')
    hash.update(entry.relativePath)
    hash.update('\0')
    if (entry.kind === 'file') hash.update(await readFile(entry.absolute))
    hash.update('\0')
  })
  return hash.digest('hex')
}

async function copyArtifactDirectory(source: string, destination: string): Promise<void> {
  const sourceRoot = resolve(source)
  await mkdir(destination, { recursive: false, mode: 0o700 })
  await walkDirectory(sourceRoot, sourceRoot, async entry => {
    const target = join(destination, ...entry.relativePath.split('/'))
    if (entry.kind === 'directory') await mkdir(target, { recursive: false, mode: 0o700 })
    else await copyFile(entry.absolute, target)
  })
}

/** Copy a verified directory into the immutable content-addressed artifact root. */
export async function materializeArtifact(
  artifactsRoot: string,
  sourceDirectory: string,
  expectedHash?: string,
): Promise<{ artifactHash: string; artifactPath: string; created: boolean }> {
  const sourceHash = await hashArtifactDirectory(sourceDirectory)
  if (expectedHash !== undefined && sourceHash !== expectedHash) {
    throw new Error(`skill artifact hash mismatch: expected ${expectedHash}, got ${sourceHash}`)
  }
  await mkdir(artifactsRoot, { recursive: true })
  const artifactPath = join(artifactsRoot, sourceHash)
  assertPathInside(artifactsRoot, artifactPath)
  if (await pathExists(artifactPath)) {
    const existingHash = await hashArtifactDirectory(artifactPath)
    if (existingHash !== sourceHash) throw new Error(`existing artifact ${sourceHash} failed integrity verification`)
    return { artifactHash: sourceHash, artifactPath, created: false }
  }

  const temporary = join(artifactsRoot, `.tmp-${process.pid}-${randomUUID()}`)
  try {
    await copyArtifactDirectory(sourceDirectory, temporary)
    const copiedHash = await hashArtifactDirectory(temporary)
    if (copiedHash !== sourceHash) throw new Error(`copied artifact hash mismatch: expected ${sourceHash}, got ${copiedHash}`)
    try { await rename(temporary, artifactPath) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
      await rm(temporary, { recursive: true, force: true })
      const winnerHash = await hashArtifactDirectory(artifactPath)
      if (winnerHash !== sourceHash) throw new Error(`racing artifact ${sourceHash} failed integrity verification`)
      return { artifactHash: sourceHash, artifactPath, created: false }
    }
    return { artifactHash: sourceHash, artifactPath, created: true }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export interface FileLeaseOptions {
  readonly staleAfterMs?: number
  readonly retryDelayMs?: number
  readonly maxWaitMs?: number
  readonly now?: () => Date
}

/** Cross-process lease for short lockfile mutations. */
export async function withFileLease<T>(lockPath: string, operation: () => Promise<T>, options: FileLeaseOptions = {}): Promise<T> {
  const staleAfterMs = options.staleAfterMs ?? 30_000
  const retryDelayMs = options.retryDelayMs ?? 10
  const maxWaitMs = options.maxWaitMs ?? 2_000
  const now = options.now ?? (() => new Date())
  await mkdir(dirname(lockPath), { recursive: true })
  const startedAt = Date.now()
  const leaseId = randomUUID()
  let handle: Awaited<ReturnType<typeof open>> | undefined
  while (handle === undefined) {
    let candidate: Awaited<ReturnType<typeof open>> | undefined
    try {
      candidate = await open(lockPath, 'wx', 0o600)
      await candidate.writeFile(JSON.stringify({ leaseId, pid: process.pid, acquiredAt: now().toISOString() }), 'utf8')
      await candidate.sync()
      handle = candidate
    } catch (error) {
      await candidate?.close().catch(() => undefined)
      if (candidate !== undefined) await unlink(lockPath).catch(() => undefined)
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const details = await stat(lockPath).catch(() => undefined)
      if (details !== undefined && now().getTime() - details.mtimeMs > staleAfterMs) {
        await unlink(lockPath).catch(() => undefined)
        continue
      }
      if (Date.now() - startedAt >= maxWaitMs) throw new Error(`timed out waiting for skill market mutation lock ${lockPath}`)
      await new Promise(resolveDelay => setTimeout(resolveDelay, retryDelayMs))
    }
  }
  const heartbeatMs = Math.max(1_000, Math.floor(staleAfterMs / 3))
  const heartbeat = setInterval(() => {
    const timestamp = now()
    void utimes(lockPath, timestamp, timestamp).catch(() => undefined)
  }, heartbeatMs)
  heartbeat.unref()
  try { return await operation() }
  finally {
    clearInterval(heartbeat)
    await handle.close().catch(() => undefined)
    const currentOwner = await readOptionalJson(lockPath).catch(() => undefined)
    if (
      typeof currentOwner === 'object'
      && currentOwner !== null
      && !Array.isArray(currentOwner)
      && 'leaseId' in currentOwner
      && currentOwner.leaseId === leaseId
    ) await unlink(lockPath).catch(() => undefined)
  }
}
