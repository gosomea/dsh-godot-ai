import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GitHubImportClient, ResolvedGitHubImportSource } from '../src/skill-market/github-import.js'
import {
  parseSkillInspectRequest,
  parseSkillInstallRequest,
  parseSkillMarketAction,
  SkillMarketService,
} from '../src/skill-market/service.js'
import { SkillMarketStore } from '../src/skill-market/store.js'

const commit = '1'.repeat(40)
let root: string
let now: Date
let store: SkillMarketStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-godot-ai-service-'))
  now = new Date('2026-08-27T12:00:00.000Z')
  store = new SkillMarketStore({ dshHome: join(root, 'dsh-home'), now: () => now })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function fakeGitHub(body: string): GitHubImportClient {
  return {
    async resolveCommit(source): Promise<ResolvedGitHubImportSource> {
      return { ...source, commit }
    },
    async downloadSkill(source, destination) {
      await mkdir(join(destination, 'scripts'), { recursive: true })
      await writeFile(join(destination, 'SKILL.md'), body)
      await writeFile(join(destination, 'scripts/install.sh'), '#!/bin/sh\necho install', { mode: 0o755 })
      return {
        source,
        directory: destination,
        artifactHash: '0'.repeat(64),
        files: ['SKILL.md', 'scripts/install.sh'],
        downloadedBytes: 100,
        expandedBytes: 200,
      }
    },
  } as GitHubImportClient
}

const request = {
  source: { kind: 'github', owner: 'owner', repo: 'repo', ref: 'main', subdir: 'skills/test-skill' },
} as const

describe('SkillMarketService inspect/install/action workflow', () => {
  it('keeps inspect, risk review, install, and enable as distinct replay-safe steps', async () => {
    const service = new SkillMarketService({
      store,
      github: fakeGitHub([
        '---',
        'name: test-skill',
        'description: Test Godot workflow.',
        '---',
        'Never read ~/.ssh/id_ed25519 or send it anywhere.',
      ].join('\n')),
      now: () => now,
    })
    await service.initialize()
    const inspection = await service.inspect(request)
    expect(inspection).toMatchObject({
      state: 'ready',
      skillId: 'test-skill',
      artifactHash: inspection.report.artifactHash,
      license: { id: 'NOASSERTION' },
    })
    expect(inspection.quarantinedFiles).toEqual(['scripts/install.sh'])
    expect(inspection.report.summary.high).toBeGreaterThan(0)

    await expect(service.install({ inspectionId: inspection.inspectionId, acknowledgements: [] }))
      .rejects.toThrow(/risk findings still require review/)
    const acknowledgements = inspection.report.findings
      .filter(finding => finding.severity === 'high' || finding.severity === 'medium')
      .map(finding => ({ findingId: finding.findingId, kind: 'false-positive' as const }))
    const installed = await service.install({ inspectionId: inspection.inspectionId, acknowledgements })
    expect(installed).toMatchObject({ enabled: false, modelInvocable: false, userInvocable: false })
    await expect(service.install({ inspectionId: inspection.inspectionId, acknowledgements })).rejects.toThrow(/already consumed/)

    await expect(service.action({
      action: 'enable', skillId: 'test-skill', approvalHash: '0'.repeat(64),
    })).rejects.toThrow(/does not match/)
    const enabled = await service.action({
      action: 'enable', skillId: 'test-skill', approvalHash: installed.approvalHash!,
    })
    expect(enabled).toMatchObject({ enabled: true, userInvocable: true, modelInvocable: false })
    expect((await service.snapshot()).installed['test-skill']?.enabled).toBe(true)
  })

  it('expires inspection tokens instead of accepting stale approval', async () => {
    const service = new SkillMarketService({
      store,
      github: fakeGitHub('---\nname: test-skill\ndescription: Safe.\n---\nBuild locally.'),
      now: () => now,
      inspectionTtlMs: 1_000,
    })
    const inspection = await service.inspect(request)
    now = new Date(now.getTime() + 1_001)
    await expect(service.install({ inspectionId: inspection.inspectionId, acknowledgements: [] })).rejects.toThrow(/expired/)
    const gc = await store.garbageCollect()
    expect(gc.movedStaging).toEqual([inspection.inspectionId])
    expect(gc.movedQuarantine).toEqual([inspection.inspectionId])
    expect(await readdir(store.paths.quarantine)).toEqual([])
  })

  it('diffs the active Artifact against a ready update inspection and reuses the hash-pair cache', async () => {
    const firstService = new SkillMarketService({
      store,
      github: fakeGitHub('---\nname: test-skill\ndescription: Safe.\n---\nOld game feel guidance.'),
      now: () => now,
    })
    const firstInspection = await firstService.inspect(request)
    const acknowledgements = firstInspection.report.findings
      .filter(finding => finding.severity === 'high' || finding.severity === 'medium')
      .map(finding => ({ findingId: finding.findingId, kind: 'accepted-risk' as const }))
    const installed = await firstService.install({ inspectionId: firstInspection.inspectionId, acknowledgements })

    now = new Date(now.getTime() + 1_000)
    const updateService = new SkillMarketService({
      store,
      github: fakeGitHub('---\nname: test-skill\ndescription: Safe.\n---\nNew game feel guidance.'),
      now: () => now,
    })
    const updateInspection = await updateService.inspect(request)
    const firstDiff = await updateService.diffSummary('test-skill')
    const cachedDiff = await updateService.diffSummary('test-skill')

    expect(firstDiff).toMatchObject({
      skillId: 'test-skill',
      oldArtifactHash: installed.activeArtifactHash,
      newArtifactHash: updateInspection.artifactHash,
      inspectionId: updateInspection.inspectionId,
      changed: true,
      cacheHit: false,
      diff: { changedFiles: 1, truncated: false },
    })
    expect(firstDiff.diff?.patch).toContain('-Old game feel guidance.')
    expect(firstDiff.diff?.patch).toContain('+New game feel guidance.')
    expect(cachedDiff.cacheHit).toBe(true)
    expect(cachedDiff.diff).toEqual(firstDiff.diff)
  })

  it('rejects malformed request unions before side effects', () => {
    expect(() => parseSkillInspectRequest({ source: { kind: 'url', url: 'file:///tmp/x' } })).toThrow(/unsupported/)
    expect(() => parseSkillInstallRequest({ inspectionId: '../escape', acknowledgements: [] })).toThrow(/inspectionId/)
    expect(() => parseSkillMarketAction({ action: 'enable', skillId: 'test-skill', approvalHash: 'bad' })).toThrow(/approvalHash/)
    expect(() => parseSkillMarketAction({ action: 'discard-inspection', inspectionId: '../escape' })).toThrow(/inspectionId/)
    expect(() => parseSkillMarketAction({ action: 'delete-everything' })).toThrow(/unsupported/)
  })
})
