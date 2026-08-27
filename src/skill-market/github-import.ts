import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { hashArtifactDirectory, pathExists } from './files.js'

const FULL_COMMIT = /^[a-f0-9]{40}$/
const REPOSITORY_COMPONENT = /^[A-Za-z0-9_.-]+$/

export interface GitHubImportSource {
  readonly owner: string
  readonly repo: string
  readonly ref: string
  readonly subdir: string
}

export interface ResolvedGitHubImportSource extends GitHubImportSource {
  readonly commit: string
  readonly etag?: string
}

export interface GitHubArchiveLimits {
  readonly maxDownloadBytes: number
  readonly maxExpandedBytes: number
  readonly maxArchiveEntries: number
  readonly maxSelectedFiles: number
  readonly maxSelectedBytes: number
  readonly maxSelectedFileBytes: number
  readonly maxSelectedDepth: number
}

export interface GitHubImportClientOptions {
  readonly fetch?: typeof fetch
  readonly token?: string
  readonly userAgent?: string
  readonly limits?: Partial<GitHubArchiveLimits>
}

export interface ResolvedCommitCache {
  readonly commit: string
  readonly etag: string
}

export interface ExtractedGitHubSkill {
  readonly source: ResolvedGitHubImportSource
  readonly directory: string
  readonly artifactHash: string
  readonly files: readonly string[]
  readonly downloadedBytes: number
  readonly expandedBytes: number
}

export class GitHubRateLimitError extends Error {
  constructor(readonly retryAfterSeconds?: number) {
    super('GitHub API rate limit reached; cached data remains available')
    this.name = 'GitHubRateLimitError'
  }
}

const DEFAULT_LIMITS: GitHubArchiveLimits = {
  maxDownloadBytes: 16 * 1024 * 1024,
  maxExpandedBytes: 64 * 1024 * 1024,
  maxArchiveEntries: 20_000,
  maxSelectedFiles: 512,
  maxSelectedBytes: 4 * 1024 * 1024,
  maxSelectedFileBytes: 512 * 1024,
  maxSelectedDepth: 16,
}

function validateSource(source: GitHubImportSource): void {
  if (!REPOSITORY_COMPONENT.test(source.owner) || !REPOSITORY_COMPONENT.test(source.repo)) {
    throw new Error('GitHub owner and repo contain unsupported characters')
  }
  if (source.owner === '.' || source.owner === '..' || source.repo === '.' || source.repo === '..') {
    throw new Error('GitHub owner and repo are invalid')
  }
  if (source.ref.length === 0 || source.ref.length > 200 || /[\u0000-\u001f\u007f]/u.test(source.ref)) {
    throw new Error('GitHub ref is invalid')
  }
  if (
    source.subdir.length === 0
    || source.subdir.startsWith('/')
    || source.subdir.split('/').some(component => component === '' || component === '.' || component === '..' || component.includes('\\'))
  ) throw new Error('GitHub subdir is unsafe')
}

function checkedLimits(value: Partial<GitHubArchiveLimits> | undefined): GitHubArchiveLimits {
  const limits = { ...DEFAULT_LIMITS, ...value }
  for (const [key, limit] of Object.entries(limits)) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(`${key} must be a positive integer`)
  }
  return limits
}

function responseRetryAfter(response: Response): number | undefined {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter !== null && /^\d+$/u.test(retryAfter)) return Number(retryAfter)
  const reset = response.headers.get('x-ratelimit-reset')
  if (reset !== null && /^\d+$/u.test(reset)) return Math.max(0, Number(reset) - Math.floor(Date.now() / 1_000))
  return undefined
}

async function limitedResponseBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const length = response.headers.get('content-length')
  if (length !== null && /^\d+$/u.test(length) && Number(length) > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`)
  return bytes
}

function allowedHttpsUrl(value: string, allowedHosts: ReadonlySet<string>): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '' || !allowedHosts.has(url.hostname)) {
    throw new Error(`GitHub download redirected outside the allowlist: ${url.origin}`)
  }
  return url
}

async function fetchWithAllowedRedirects(
  fetchImpl: typeof fetch,
  initialUrl: URL,
  init: RequestInit,
  allowedHosts: ReadonlySet<string>,
): Promise<Response> {
  let url = allowedHttpsUrl(initialUrl.href, allowedHosts)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchImpl(url, { ...init, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    if (redirects === 3) throw new Error('GitHub download exceeded redirect limit')
    const location = response.headers.get('location')
    if (location === null) throw new Error('GitHub redirect has no Location header')
    url = allowedHttpsUrl(new URL(location, url).href, allowedHosts)
  }
  throw new Error('unreachable redirect state')
}

function tarText(block: Buffer, offset: number, length: number): string {
  const end = block.subarray(offset, offset + length).indexOf(0)
  return block.subarray(offset, end === -1 ? offset + length : offset + end).toString('utf8').trim()
}

function tarNumber(block: Buffer, offset: number, length: number): number {
  const bytes = block.subarray(offset, offset + length)
  if ((bytes[0]! & 0x80) !== 0) throw new Error('base-256 TAR numbers are unsupported')
  const value = tarText(block, offset, length).replace(/\0/gu, '').trim()
  if (value === '') return 0
  if (!/^[0-7]+$/u.test(value)) throw new Error('invalid TAR numeric field')
  const number = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('unsafe TAR numeric field')
  return number
}

function verifyTarHeaderChecksum(block: Buffer): void {
  const expected = tarNumber(block, 148, 8)
  let actual = 0
  for (let index = 0; index < 512; index += 1) actual += index >= 148 && index < 156 ? 32 : block[index]!
  if (actual !== expected) throw new Error('TAR header checksum mismatch')
}

function safeTarPath(value: string): string {
  const normalized = value.replace(/\\/gu, '/').replace(/^\.\//u, '')
  const components = normalized.replace(/\/$/u, '').split('/')
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//u.test(normalized)
    || normalized.includes('\u0000')
    || components.some(component => component === '' || component === '.' || component === '..')
  ) throw new Error(`unsafe TAR path ${JSON.stringify(value)}`)
  return normalized.replace(/\/$/u, '')
}

function parsePaxPath(bytes: Buffer): string | undefined {
  let offset = 0
  let path: string | undefined
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset)
    if (space === -1) throw new Error('malformed PAX record')
    const lengthText = bytes.subarray(offset, space).toString('ascii')
    if (!/^\d+$/u.test(lengthText)) throw new Error('malformed PAX record length')
    const length = Number(lengthText)
    if (!Number.isSafeInteger(length) || length <= space - offset + 1 || offset + length > bytes.length) throw new Error('unsafe PAX record length')
    const record = bytes.subarray(space + 1, offset + length - 1).toString('utf8')
    const separator = record.indexOf('=')
    if (separator > 0 && record.slice(0, separator) === 'path') path = record.slice(separator + 1)
    offset += length
  }
  return path
}

interface SelectedTarFile {
  readonly path: string
  readonly bytes: Buffer
}

function selectTarSubdirectory(archive: Buffer, subdir: string, limits: GitHubArchiveLimits): SelectedTarFile[] {
  const files: SelectedTarFile[] = []
  let offset = 0
  let entries = 0
  let rootComponent: string | undefined
  let nextPath: string | undefined
  let selectedBytes = 0
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    verifyTarHeaderChecksum(header)
    entries += 1
    if (entries > limits.maxArchiveEntries) throw new Error('TAR archive entry limit exceeded')
    const size = tarNumber(header, 124, 12)
    const paddedSize = Math.ceil(size / 512) * 512
    if (offset + 512 + paddedSize > archive.length) throw new Error('truncated TAR entry')
    const payload = archive.subarray(offset + 512, offset + 512 + size)
    const prefix = tarText(header, 345, 155)
    const headerName = `${prefix === '' ? '' : `${prefix}/`}${tarText(header, 0, 100)}`
    const type = String.fromCharCode(header[156] ?? 0)
    const magic = header.subarray(257, 263).toString('ascii')
    if (!magic.startsWith('ustar')) throw new Error('unsupported TAR header format')
    if (type === 'g') {
      // Global PAX metadata does not identify a repository entry.
    } else if (type === 'x') nextPath = parsePaxPath(payload)
    else if (type === 'L') nextPath = payload.toString('utf8').replace(/\0.*$/su, '').trim()
    else {
      const archivePath = safeTarPath(nextPath ?? headerName)
      nextPath = undefined
      const firstSlash = archivePath.indexOf('/')
      const entryRoot = firstSlash === -1 ? archivePath : archivePath.slice(0, firstSlash)
      rootComponent ??= entryRoot
      if (entryRoot !== rootComponent) throw new Error('TAR archive has multiple roots')
      const selectedPrefix = `${rootComponent}/${subdir}`
      const selected = archivePath === selectedPrefix || archivePath.startsWith(`${selectedPrefix}/`)
      if (selected) {
        const relativePath = archivePath.slice(selectedPrefix.length).replace(/^\//u, '')
        if (type === '1' || type === '2') throw new Error(`selected GitHub Skill contains link ${relativePath || '.'}`)
        if (type === '0' || type === '\0' || type === '') {
          if (relativePath === '') throw new Error('GitHub Skill subdir resolves to a file, not a directory')
          const depth = relativePath.split('/').length
          if (depth > limits.maxSelectedDepth) throw new Error(`selected file exceeds depth limit: ${relativePath}`)
          if (size > limits.maxSelectedFileBytes) throw new Error(`selected file exceeds size limit: ${relativePath}`)
          selectedBytes += size
          if (selectedBytes > limits.maxSelectedBytes) throw new Error('selected GitHub Skill exceeds expanded size limit')
          if (files.length >= limits.maxSelectedFiles) throw new Error('selected GitHub Skill exceeds file count limit')
          if (files.some(file => file.path === relativePath)) throw new Error(`duplicate TAR file ${relativePath}`)
          files.push({ path: relativePath, bytes: Buffer.from(payload) })
        } else if (type !== '5') throw new Error(`selected GitHub Skill contains unsupported TAR type ${JSON.stringify(type)}`)
      }
    }
    offset += 512 + paddedSize
  }
  if (files.length === 0) throw new Error(`GitHub archive does not contain subdir ${subdir}`)
  if (!files.some(file => file.path === 'SKILL.md')) throw new Error('GitHub Skill subdir has no SKILL.md')
  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

export class GitHubImportClient {
  private readonly fetchImpl: typeof fetch
  private readonly token: string | undefined
  private readonly userAgent: string
  private readonly limits: GitHubArchiveLimits

  constructor(options: GitHubImportClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch
    this.token = options.token
    this.userAgent = options.userAgent ?? 'dsh-godot-ai-skill-market/0.6'
    this.limits = checkedLimits(options.limits)
  }

  async resolveCommit(source: GitHubImportSource, cached?: ResolvedCommitCache): Promise<ResolvedGitHubImportSource> {
    validateSource(source)
    if (FULL_COMMIT.test(source.ref)) return { ...source, commit: source.ref }
    const url = new URL(`https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/commits/${encodeURIComponent(source.ref)}`)
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': this.userAgent,
      'x-github-api-version': '2026-03-10',
    }
    if (this.token !== undefined) headers.authorization = `Bearer ${this.token}`
    if (cached !== undefined) headers['if-none-match'] = cached.etag
    const response = await fetchWithAllowedRedirects(this.fetchImpl, url, { headers }, new Set(['api.github.com']))
    if (response.status === 304 && cached !== undefined) return { ...source, commit: cached.commit, etag: cached.etag }
    if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
      throw new GitHubRateLimitError(responseRetryAfter(response))
    }
    if (!response.ok) throw new Error(`GitHub commit resolution failed with HTTP ${response.status}`)
    const body = JSON.parse((await limitedResponseBytes(response, 2 * 1024 * 1024)).toString('utf8')) as unknown
    if (typeof body !== 'object' || body === null || !('sha' in body) || typeof body.sha !== 'string' || !FULL_COMMIT.test(body.sha)) {
      throw new Error('GitHub commit response has no full commit SHA')
    }
    const etag = response.headers.get('etag') ?? undefined
    return { ...source, commit: body.sha, ...etag === undefined ? {} : { etag } }
  }

  async downloadSkill(source: ResolvedGitHubImportSource, destination: string): Promise<ExtractedGitHubSkill> {
    validateSource(source)
    if (!FULL_COMMIT.test(source.commit)) throw new Error('resolved GitHub source requires a full commit SHA')
    const url = new URL(`https://codeload.github.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/tar.gz/${source.commit}`)
    const response = await fetchWithAllowedRedirects(
      this.fetchImpl,
      url,
      { headers: { accept: 'application/x-gzip, application/octet-stream', 'user-agent': this.userAgent } },
      new Set(['codeload.github.com']),
    )
    if (!response.ok) throw new Error(`GitHub codeload failed with HTTP ${response.status}`)
    const compressed = await limitedResponseBytes(response, this.limits.maxDownloadBytes)
    let archive: Buffer
    try { archive = gunzipSync(compressed, { maxOutputLength: this.limits.maxExpandedBytes }) }
    catch (error) { throw new Error(`GitHub archive decompression failed: ${(error as Error).message}`) }
    if (archive.length > this.limits.maxExpandedBytes) throw new Error('GitHub archive exceeds expanded size limit')
    const selected = selectTarSubdirectory(archive, source.subdir, this.limits)
    const destinationRoot = resolve(destination)
    if (await pathExists(destinationRoot)) throw new Error('GitHub import destination already exists')
    const temporary = `${destinationRoot}.tmp-${process.pid}-${randomUUID()}`
    await mkdir(temporary, { recursive: false, mode: 0o700 })
    try {
      for (const file of selected) {
        const path = join(temporary, ...file.path.split('/'))
        if (path !== temporary && !path.startsWith(`${temporary}${sep}`)) throw new Error(`selected file escapes destination: ${file.path}`)
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await writeFile(path, file.bytes, { mode: 0o600, flag: 'wx' })
      }
      const artifactHash = await hashArtifactDirectory(temporary)
      await rename(temporary, destinationRoot)
      return {
        source,
        directory: destinationRoot,
        artifactHash,
        files: selected.map(file => file.path),
        downloadedBytes: compressed.length,
        expandedBytes: archive.length,
      }
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }
}
