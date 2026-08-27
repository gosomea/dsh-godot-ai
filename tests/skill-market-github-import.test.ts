import { gzipSync } from 'node:zlib'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubImportClient, GitHubRateLimitError } from '../src/skill-market/github-import.js'

const commit = '1'.repeat(40)
const source = { owner: 'owner', repo: 'repo', ref: 'main', subdir: 'skills/game-feel' } as const
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-godot-ai-github-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

interface TarEntry {
  readonly name: string
  readonly body?: string
  readonly type?: '0' | '2' | '5'
  readonly linkName?: string
}

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, '0') + '\0'
  header.write(text, offset, length, 'ascii')
}

function tar(entries: readonly TarEntry[]): Buffer {
  const blocks: Buffer[] = []
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '', 'utf8')
    const header = Buffer.alloc(512)
    header.write(entry.name, 0, 100, 'utf8')
    writeOctal(header, 100, 8, entry.type === '5' ? 0o755 : 0o644)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, body.length)
    writeOctal(header, 136, 12, 0)
    header.fill(32, 148, 156)
    header[156] = (entry.type ?? '0').charCodeAt(0)
    if (entry.linkName !== undefined) header.write(entry.linkName, 157, 100, 'utf8')
    header.write('ustar\0', 257, 6, 'ascii')
    header.write('00', 263, 2, 'ascii')
    let checksum = 0
    for (const byte of header) checksum += byte
    const checksumText = checksum.toString(8).padStart(6, '0') + '\0 '
    header.write(checksumText, 148, 8, 'ascii')
    blocks.push(header, body, Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

function archive(extra: readonly TarEntry[] = []): Buffer {
  const archiveRoot = `repo-${commit.slice(0, 7)}`
  return tar([
    { name: `${archiveRoot}/`, type: '5' },
    { name: `${archiveRoot}/skills/`, type: '5' },
    { name: `${archiveRoot}/skills/game-feel/`, type: '5' },
    { name: `${archiveRoot}/skills/game-feel/SKILL.md`, body: '# Game Feel' },
    { name: `${archiveRoot}/skills/game-feel/references/guide.md`, body: '# Guide' },
    ...extra,
  ])
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
}

describe('fixed-commit GitHub import', () => {
  it('resolves a moving ref once, then downloads and extracts only the requested subdir', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ sha: commit }, { headers: { etag: '"commit-etag"' } }))
      .mockResolvedValueOnce(new Response(archive(), { status: 200, headers: { 'content-type': 'application/x-gzip' } }))
    const client = new GitHubImportClient({ fetch: fetchMock })
    const resolved = await client.resolveCommit(source)
    expect(resolved).toMatchObject({ ...source, commit, etag: '"commit-etag"' })
    const extracted = await client.downloadSkill(resolved, join(root, 'skill'))

    expect(fetchMock.mock.calls[0]?.[0].toString()).toContain('/commits/main')
    expect(fetchMock.mock.calls[1]?.[0].toString()).toBe(`https://codeload.github.com/owner/repo/tar.gz/${commit}`)
    expect(extracted.files).toEqual(['references/guide.md', 'SKILL.md'])
    expect(await readFile(join(extracted.directory, 'SKILL.md'), 'utf8')).toBe('# Game Feel')
    expect(extracted.artifactHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('never resolves an already immutable full commit through the API', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const client = new GitHubImportClient({ fetch: fetchMock })
    const resolved = await client.resolveCommit({ ...source, ref: commit })
    expect(resolved.commit).toBe(commit)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses ETag cache on 304 and backs off immediately on rate limiting', async () => {
    const notModified = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 304 }))
    const cached = await new GitHubImportClient({ fetch: notModified }).resolveCommit(source, { commit, etag: '"old"' })
    expect(cached).toMatchObject({ commit, etag: '"old"' })
    expect(new Headers((notModified.mock.calls[0]?.[1] as RequestInit).headers).get('if-none-match')).toBe('"old"')

    const limited = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'retry-after': '60' },
    }))
    const error = await new GitHubImportClient({ fetch: limited }).resolveCommit(source).catch(reason => reason)
    expect(error).toBeInstanceOf(GitHubRateLimitError)
    expect((error as GitHubRateLimitError).retryAfterSeconds).toBe(60)
    expect(limited).toHaveBeenCalledTimes(1)
  })

  it('rejects redirects outside the codeload allowlist', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example/archive.tar.gz' },
    }))
    const client = new GitHubImportClient({ fetch: fetchMock })
    await expect(client.downloadSkill({ ...source, commit }, join(root, 'skill'))).rejects.toThrow(/outside the allowlist/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects path traversal and links instead of trusting TAR filenames', async () => {
    const traversalFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(tar([
      { name: `repo-${commit.slice(0, 7)}/../escape/SKILL.md`, body: '# Escape' },
    ]), { status: 200 }))
    await expect(new GitHubImportClient({ fetch: traversalFetch }).downloadSkill(
      { ...source, commit }, join(root, 'traversal'),
    )).rejects.toThrow(/unsafe TAR path/)

    const archiveRoot = `repo-${commit.slice(0, 7)}`
    const linkFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(archive([
      { name: `${archiveRoot}/skills/game-feel/escape`, type: '2', linkName: '../../outside' },
    ]), { status: 200 }))
    await expect(new GitHubImportClient({ fetch: linkFetch }).downloadSkill(
      { ...source, commit }, join(root, 'link'),
    )).rejects.toThrow(/contains link/)
  })

  it('enforces compressed and selected-file bounds before writing a destination', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(archive(), { status: 200 }))
    const client = new GitHubImportClient({ fetch: fetchMock, limits: { maxSelectedFileBytes: 4 } })
    await expect(client.downloadSkill({ ...source, commit }, join(root, 'skill'))).rejects.toThrow(/file exceeds size limit/)
  })
})
