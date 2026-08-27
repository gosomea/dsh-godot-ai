import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reviewRiskReport } from '../src/skill-market/approval.js'
import { parseMarketSkillMarkdown, StoreBackedMarketSkillProvider } from '../src/skill-market/provider.js'
import { scanSkillDirectory } from '../src/skill-market/scanner.js'
import { SkillMarketStore } from '../src/skill-market/store.js'

let root: string
let stage: string
let store: SkillMarketStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-godot-ai-store-provider-'))
  stage = join(root, 'stage')
  await mkdir(stage)
  store = new SkillMarketStore({ dshHome: join(root, 'dsh-home') })
  await store.initialize()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Store-backed market provider', () => {
  it('exposes only enabled, current-rule, intact, user-invocable Store records', async () => {
    await writeFile(join(stage, 'SKILL.md'), [
      '---',
      'name: test-skill',
      'description: A local Godot workflow.',
      '---',
      'Build a local Godot scene and verify it.',
    ].join('\n'))
    const report = await scanSkillDirectory(stage)
    const review = reviewRiskReport(report, [])
    expect(review.status).toBe('approved')
    if (review.status !== 'approved') return
    await store.installReviewed({
      skillId: 'test-skill',
      version: '1.0.0',
      source: { kind: 'curated', catalogSerial: 1, skillId: 'test-skill' },
      stagedDirectory: stage,
      riskReport: report,
      approval: review.approval,
    })
    const provider = new StoreBackedMarketSkillProvider(store)
    expect((await provider.list({})).candidates).toEqual([])

    await store.setEnabled('test-skill', true)
    const observation = await provider.list({})
    expect(observation.complete).toBe(false)
    expect(observation.candidates).toEqual([
      expect.objectContaining({
        name: 'test-skill',
        rank: 350,
        invocation: { modelInvocable: false, userInvocable: true },
      }),
    ])
    expect((await provider.get(observation.candidates[0]!, {}))?.content).toContain('Build a local Godot scene')

    await writeFile(join(store.artifactPath(report.artifactHash), 'SKILL.md'), 'tampered')
    expect((await provider.list({})).candidates).toEqual([])
    expect(await provider.get(observation.candidates[0]!, {})).toBeUndefined()
  })

  it('parses folded descriptions but rejects a frontmatter name that cannot route safely', () => {
    const parsed = parseMarketSkillMarkdown([
      '---',
      'name: game-feel',
      'description: >',
      '  Improve feedback and',
      '  player response.',
      '---',
      'Instructions.',
    ].join('\n'), '/tmp/SKILL.md')
    expect(parsed.description).toBe('Improve feedback and player response.')
    expect(() => parseMarketSkillMarkdown('---\nname: Bad Name\ndescription: bad\n---\nBody', '/tmp/bad')).toThrow(/invalid name/)
  })
})
