import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtifactDiffCache, diffArtifactDirectories } from '../src/skill-market/diff.js'

const OLD_HASH = '1'.repeat(64)
const NEW_HASH = '2'.repeat(64)
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-godot-ai-diff-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function fixture(name: string, files: Readonly<Record<string, string | Buffer>>): Promise<string> {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  for (const [path, body] of Object.entries(files)) {
    const target = join(directory, path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, body)
  }
  return directory
}

describe('bounded Skill Artifact diff', () => {
  it('reports deterministic text and binary changes without exposing unchanged files', async () => {
    const oldDirectory = await fixture('old', {
      'SKILL.md': '---\nname: game-feel\n---\nold guidance\n',
      'removed.md': 'remove me\n',
      'unchanged.md': 'same\n',
      'texture.bin': Buffer.from([0, 1, 2]),
    })
    const newDirectory = await fixture('new', {
      'SKILL.md': '---\nname: game-feel\n---\nnew guidance\n',
      'added.md': 'add me\n',
      'unchanged.md': 'same\n',
      'texture.bin': Buffer.from([0, 1, 3]),
    })

    const diff = await diffArtifactDirectories(oldDirectory, newDirectory, OLD_HASH, NEW_HASH)

    expect(diff.changedFiles).toBe(4)
    expect(diff.files.map(file => [file.path, file.status, file.binary])).toEqual([
      ['SKILL.md', 'modified', false],
      ['added.md', 'added', false],
      ['removed.md', 'removed', false],
      ['texture.bin', 'modified', true],
    ])
    expect(diff.patch).toContain('-old guidance')
    expect(diff.patch).toContain('+new guidance')
    expect(diff.patch).toContain('Binary file modified')
    expect(diff.responseBytes).toBe(Buffer.byteLength(JSON.stringify(diff), 'utf8'))
    expect(diff.truncated).toBe(false)
  })

  it('keeps line output and serialized response under hard limits while retaining summaries', async () => {
    const oldDirectory = await fixture('large-old', { 'SKILL.md': `${Array.from({ length: 4_000 }, (_, index) => `old-${index}-${'x'.repeat(100)}`).join('\n')}\n` })
    const newDirectory = await fixture('large-new', { 'SKILL.md': `${Array.from({ length: 4_000 }, (_, index) => `new-${index}-${'y'.repeat(100)}`).join('\n')}\n` })

    const diff = await diffArtifactDirectories(oldDirectory, newDirectory, OLD_HASH, NEW_HASH)

    expect(diff.changedFiles).toBe(1)
    expect(diff.changedLines).toBeLessThanOrEqual(2_000)
    expect(diff.truncated).toBe(true)
    expect(diff.files[0]).toMatchObject({ path: 'SKILL.md', additions: 4_000, deletions: 4_000 })
    expect(Buffer.byteLength(JSON.stringify(diff), 'utf8')).toBeLessThanOrEqual(112 * 1024)
    expect(Buffer.byteLength(JSON.stringify({ diff }), 'utf8')).toBeLessThan(128 * 1024)
  })

  it('rejects symlinks rather than following content outside the Artifact', async () => {
    const oldDirectory = await fixture('link-old', { 'SKILL.md': 'safe' })
    const newDirectory = await fixture('link-new', { 'SKILL.md': 'safe' })
    const { symlink } = await import('node:fs/promises')
    await symlink(join(root, 'link-old', 'SKILL.md'), join(newDirectory, 'outside.md'))

    await expect(diffArtifactDirectories(oldDirectory, newDirectory, OLD_HASH, NEW_HASH)).rejects.toThrow(/symbolic link/)
  })
})

describe('ArtifactDiffCache', () => {
  it('caches immutable hash pairs, applies LRU bounds, and removes references before Artifact purge', async () => {
    const cacheDirectory = join(root, 'cache')
    let clock = Date.parse('2026-08-27T00:00:00.000Z')
    const cache = new ArtifactDiffCache(cacheDirectory, { maxEntries: 2, maxBytes: 1024 * 1024, now: () => new Date(clock) })
    const created = vi.fn(async (newArtifactHash: string) => ({
      schemaVersion: 1 as const,
      oldArtifactHash: OLD_HASH,
      newArtifactHash,
      files: [],
      omittedFiles: 0,
      fileListTruncated: false,
      changedFiles: 0,
      additions: 0,
      deletions: 0,
      changedLines: 0,
      patch: '',
      truncated: false,
      responseBytes: 0,
    }))

    const first = await cache.getOrCreate(OLD_HASH, NEW_HASH, () => created(NEW_HASH))
    clock += 1_000
    const hit = await cache.getOrCreate(OLD_HASH, NEW_HASH, () => created(NEW_HASH))
    expect(first.cacheHit).toBe(false)
    expect(hit.cacheHit).toBe(true)
    expect(created).toHaveBeenCalledTimes(1)

    clock += 1_000
    await cache.getOrCreate(OLD_HASH, '3'.repeat(64), () => created('3'.repeat(64)))
    clock += 1_000
    await cache.getOrCreate(OLD_HASH, '4'.repeat(64), () => created('4'.repeat(64)))
    const jsonEntries = (await readdir(cacheDirectory)).filter(name => name.endsWith('.json'))
    expect(jsonEntries).toHaveLength(2)
    expect(jsonEntries).not.toContain(`${OLD_HASH}--${NEW_HASH}.json`)

    const removed = await cache.removeReferencing(OLD_HASH)
    expect(removed).toHaveLength(2)
    expect((await readdir(cacheDirectory)).filter(name => name.endsWith('.json'))).toEqual([])
  })
})
