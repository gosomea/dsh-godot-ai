import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  SEED_REVIEW_CANDIDATE_COUNT,
  SKILL_MARKET_SCHEMA_VERSION,
  parseSeedReviewManifest,
} from '../src/skill-market/contracts.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function rawManifest(): Promise<unknown> {
  return JSON.parse(await readFile(join(root, 'market/seed-review-manifest.json'), 'utf8'))
}

describe('skill-market seed review contract', () => {
  it('pins all ten requested candidates and recommends only the Godot-compatible starter set', async () => {
    const manifest = parseSeedReviewManifest(await rawManifest())

    expect(manifest.schemaVersion).toBe(SKILL_MARKET_SCHEMA_VERSION)
    expect(manifest.candidates).toHaveLength(SEED_REVIEW_CANDIDATE_COUNT)
    expect(manifest.candidates.filter(candidate => candidate.defaultSelected).map(candidate => candidate.id).sort())
      .toEqual(['game-feel', 'game-ui-design', 'game-ui-ux'])
    expect(manifest.candidates.find(candidate => candidate.id === 'threejs-game-ui-designer')?.defaultSelected).toBe(false)
    expect(manifest.candidates.find(candidate => candidate.id === 'develop-web-game')).toMatchObject({
      defaultSelected: false,
      installable: false,
      decision: 'external-candidate',
      upstreamStatus: 'deleted',
    })
  })

  it('uses full immutable commits for GitHub candidates and blocks missing redistribution rights', async () => {
    const manifest = parseSeedReviewManifest(await rawManifest())
    const githubCandidates = manifest.candidates.filter(candidate => candidate.source.kind === 'github')

    expect(githubCandidates).toHaveLength(9)
    for (const candidate of githubCandidates) expect(candidate.source.commit).toMatch(/^[a-f0-9]{40}$/)
    expect(manifest.candidates.find(candidate => candidate.id === 'multiplayer-game')).toMatchObject({
      installable: false,
      decision: 'blocked',
      license: { redistributable: false },
    })
  })

  it('rejects duplicate ids, floating refs, and unsafe default selections', async () => {
    const duplicate = structuredClone(await rawManifest()) as { candidates: Array<Record<string, unknown>> }
    duplicate.candidates[1]!.id = duplicate.candidates[0]!.id
    expect(() => parseSeedReviewManifest(duplicate)).toThrow(/duplicate/)

    const floating = structuredClone(await rawManifest()) as { candidates: Array<{ source: Record<string, unknown> }> }
    floating.candidates[0]!.source.commit = 'main'
    expect(() => parseSeedReviewManifest(floating)).toThrow(/full SHA-1/)

    const unsafeDefault = structuredClone(await rawManifest()) as { candidates: Array<Record<string, unknown>> }
    const blocked = unsafeDefault.candidates.find(candidate => candidate.id === 'multiplayer-game')!
    blocked.defaultSelected = true
    expect(() => parseSeedReviewManifest(unsafeDefault)).toThrow(/defaultSelected/)
  })
})
