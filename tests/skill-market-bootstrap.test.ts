import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPackagedSkillMarketService, loadPackagedSkillMarketAssets } from '../src/skill-market/bootstrap.js'
import { SkillMarketStore } from '../src/skill-market/store.js'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('packaged signed Skill Catalog bootstrap', () => {
  it('verifies and installs the serial-1 Catalog into a zero-state DSH home without network access', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-godot-ai-bootstrap-'))
    const assets = await loadPackagedSkillMarketAssets()
    expect(assets.catalog.skills.map(skill => skill.id)).toContain('game-feel')
    expect(assets.catalog.skills.filter(skill => skill.defaultSelected).map(skill => skill.id).sort())
      .toEqual(['game-feel', 'game-ui-design', 'game-ui-ux'])
    expect(assets.candidateNotices).toHaveLength(10)

    const store = new SkillMarketStore({ dshHome: root, now: () => new Date('2026-08-27T12:00:00.000Z') })
    const service = await createPackagedSkillMarketService({ store, now: () => new Date('2026-08-27T12:00:00.000Z'), autoCheck: false })
    const snapshot = await service.snapshot()
    expect(snapshot.catalog).toHaveLength(8)
    expect(snapshot.catalog.filter(skill => skill.installable).map(skill => skill.id).sort()).toEqual([
      'game-developer', 'game-feel', 'game-ui-design', 'game-ui-ux', 'threejs-game-ui-designer',
    ])
    expect(snapshot.candidateNotices.map(notice => notice.id)).toHaveLength(10)
  })
})
