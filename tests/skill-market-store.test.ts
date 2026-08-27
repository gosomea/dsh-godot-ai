import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWriteJson, hashArtifactDirectory, materializeArtifact, pathExists } from '../src/skill-market/files.js'
import {
  SkillMarketRevisionConflictError,
  UnsupportedSkillMarketSchemaError,
} from '../src/skill-market/lockfile.js'
import { SkillMarketStore } from '../src/skill-market/store.js'

const riskA = 'a'.repeat(64)
const riskB = 'b'.repeat(64)
const approval = 'c'.repeat(64)
const source = { kind: 'curated', catalogSerial: 1, skillId: 'test-skill' } as const

let root: string
let dshHome: string
let now: Date
let store: SkillMarketStore

async function createStage(name: string, body: string): Promise<string> {
  const directory = join(root, 'source-staging', name)
  await mkdir(join(directory, 'references'), { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), body)
  await writeFile(join(directory, 'references/info.md'), `${body} reference`)
  return directory
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-godot-ai-store-'))
  dshHome = join(root, 'dsh-home')
  now = new Date('2026-08-27T00:00:00.000Z')
  store = new SkillMarketStore({ dshHome, now: () => now })
  await store.initialize()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('SkillMarketStore', () => {
  it('installs immutable artifacts disabled, tracks history, and rolls back fail-closed', async () => {
    const firstStage = await createStage('first', '# First')
    const firstHash = await hashArtifactDirectory(firstStage)
    const first = await store.installPrepared({
      skillId: 'test-skill',
      version: '1.0.0',
      source,
      stagedDirectory: firstStage,
      expectedArtifactHash: firstHash,
      scannerRulesVersion: 'rules-1',
      riskReportHash: riskA,
      approvalHash: approval,
      acknowledgedFindingIds: ['finding-1'],
      expectedRevision: 0,
    })

    expect(first).toMatchObject({
      activeArtifactHash: firstHash,
      enabled: false,
      modelInvocable: false,
      userInvocable: false,
      history: [],
    })
    await writeFile(join(firstStage, 'SKILL.md'), '# Mutated source')
    expect(await readFile(join(store.artifactPath(firstHash), 'SKILL.md'), 'utf8')).toBe('# First')

    await store.setEnabled('test-skill', true, 1)
    const secondStage = await createStage('second', '# Second')
    const secondHash = await hashArtifactDirectory(secondStage)
    const second = await store.installPrepared({
      skillId: 'test-skill',
      version: '2.0.0',
      source: { kind: 'curated', catalogSerial: 2, skillId: 'test-skill' },
      stagedDirectory: secondStage,
      scannerRulesVersion: 'rules-2',
      riskReportHash: riskB,
      expectedRevision: 2,
    })
    expect(second.enabled).toBe(false)
    expect(second.history.map(item => item.artifactHash)).toEqual([firstHash])

    const rolledBack = await store.rollback('test-skill', firstHash, 3)
    expect(rolledBack).toMatchObject({
      activeArtifactHash: firstHash,
      activeVersion: '1.0.0',
      enabled: false,
      scannerRulesVersion: 'rules-1',
      riskReportHash: riskA,
    })
    expect(rolledBack.history.map(item => item.artifactHash)).toEqual([secondHash])
    expect((await store.readLockfile()).revision).toBe(4)
  })

  it('serializes competing writers and rejects the stale expected revision', async () => {
    const stage = await createStage('race', '# Race')
    await store.installPrepared({
      skillId: 'test-skill',
      version: '1.0.0',
      source,
      stagedDirectory: stage,
      scannerRulesVersion: 'rules-1',
      riskReportHash: riskA,
      approvalHash: approval,
      expectedRevision: 0,
    })

    const results = await Promise.allSettled([
      store.setEnabled('test-skill', true, 1),
      store.setEnabled('test-skill', false, 1),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(SkillMarketRevisionConflictError)
    expect((await store.readLockfile()).revision).toBe(2)
  })

  it('requires recorded risk approval and an intact artifact before enabling', async () => {
    const unapprovedStage = await createStage('unapproved', '# Unapproved')
    await store.installPrepared({
      skillId: 'test-skill',
      version: '1.0.0',
      source,
      stagedDirectory: unapprovedStage,
      scannerRulesVersion: 'rules-1',
      riskReportHash: riskA,
    })
    await expect(store.setEnabled('test-skill', true)).rejects.toThrow(/risk approval/)

    const approvedStage = await createStage('approved', '# Approved')
    const approved = await store.installPrepared({
      skillId: 'test-skill',
      version: '2.0.0',
      source,
      stagedDirectory: approvedStage,
      scannerRulesVersion: 'rules-1',
      riskReportHash: riskB,
      approvalHash: approval,
    })
    await writeFile(join(store.artifactPath(approved.activeArtifactHash), 'SKILL.md'), '# Tampered')
    await expect(store.setEnabled('test-skill', true)).rejects.toThrow(/integrity verification/)
    expect((await store.readLockfile()).revision).toBe(2)
  })

  it('recovers a missing active artifact from history and never restores enablement', async () => {
    const firstStage = await createStage('recover-first', '# First')
    const first = await store.installPrepared({
      skillId: 'test-skill',
      version: '1.0.0',
      source,
      stagedDirectory: firstStage,
      scannerRulesVersion: 'rules-1',
      riskReportHash: riskA,
      approvalHash: approval,
    })
    const secondStage = await createStage('recover-second', '# Second')
    const second = await store.installPrepared({
      skillId: 'test-skill',
      version: '2.0.0',
      source,
      stagedDirectory: secondStage,
      scannerRulesVersion: 'rules-1',
      riskReportHash: riskB,
      approvalHash: approval,
    })
    await store.setEnabled('test-skill', true)
    await rm(store.artifactPath(second.activeArtifactHash), { recursive: true })

    await store.recover()
    const recovered = (await store.readLockfile()).installed['test-skill']!
    expect(recovered).toMatchObject({
      state: 'ready',
      activeArtifactHash: first.activeArtifactHash,
      enabled: false,
      userInvocable: false,
    })
  })

  it('keeps only unexpired staging references live, then trashes and later purges orphans', async () => {
    const orphanStage = await createStage('orphan', '# Orphan')
    const orphan = await materializeArtifact(store.paths.artifacts, orphanStage)
    const liveInspection = join(store.paths.staging, 'live-inspection')
    const expiredInspection = join(store.paths.staging, 'expired-inspection')
    await mkdir(liveInspection)
    await mkdir(expiredInspection)
    await atomicWriteJson(join(liveInspection, 'inspection.json'), {
      artifactHash: orphan.artifactHash,
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    })
    await atomicWriteJson(join(expiredInspection, 'inspection.json'), {
      artifactHash: orphan.artifactHash,
      expiresAt: new Date(now.getTime() - 1).toISOString(),
    })

    const firstGc = await store.garbageCollect()
    expect(firstGc.movedStaging).toEqual(['expired-inspection'])
    expect(firstGc.movedArtifacts).toEqual([])
    expect(await pathExists(orphan.artifactPath)).toBe(true)

    now = new Date(now.getTime() + 31 * 60_000)
    const secondGc = await store.garbageCollect()
    expect(secondGc.movedStaging).toEqual(['live-inspection'])
    expect(secondGc.movedArtifacts).toEqual([orphan.artifactHash])
    expect(await pathExists(orphan.artifactPath)).toBe(false)

    now = new Date(now.getTime() + 8 * 24 * 60 * 60_000)
    const thirdGc = await store.garbageCollect()
    expect(thirdGc.purgedTrash.length).toBeGreaterThanOrEqual(3)
  })

  it('restores recoverable trash and marks an installation broken when no history survives', async () => {
    const orphanStage = await createStage('restore-orphan', '# Restore orphan')
    const orphan = await materializeArtifact(store.paths.artifacts, orphanStage)
    const gc = await store.garbageCollect()
    expect(gc.movedArtifacts).toEqual([orphan.artifactHash])
    const trashEntries = await readdir(store.paths.trash)
    expect(trashEntries).toHaveLength(1)

    await store.restoreTrash(trashEntries[0]!)
    expect(await pathExists(orphan.artifactPath)).toBe(true)

    const activeStage = await createStage('missing-active', '# Missing active')
    const active = await store.installPrepared({
      skillId: 'test-skill',
      version: '1.0.0',
      source,
      stagedDirectory: activeStage,
      scannerRulesVersion: 'rules-1',
      riskReportHash: riskA,
      approvalHash: approval,
    })
    await store.setEnabled('test-skill', true)
    await rm(store.artifactPath(active.activeArtifactHash), { recursive: true })

    await store.recover()
    expect((await store.readLockfile()).installed['test-skill']).toMatchObject({
      state: 'missing-artifact',
      enabled: false,
      userInvocable: false,
    })
  })

  it('keeps only the configured number of unique rollback revisions', async () => {
    store = new SkillMarketStore({ dshHome, now: () => now, historyLimit: 3 })
    for (let index = 1; index <= 5; index += 1) {
      now = new Date(now.getTime() + 1_000)
      const stage = await createStage(`history-${index}`, `# Version ${index}`)
      await store.installPrepared({
        skillId: 'test-skill',
        version: `${index}.0.0`,
        source: { kind: 'curated', catalogSerial: index, skillId: 'test-skill' },
        stagedDirectory: stage,
        scannerRulesVersion: 'rules-1',
        riskReportHash: riskA,
      })
    }
    const installed = (await store.readLockfile()).installed['test-skill']!
    expect(installed.activeVersion).toBe('5.0.0')
    expect(installed.history.map(item => item.version)).toEqual(['4.0.0', '3.0.0', '2.0.0'])
  })

  it('rejects symlink artifacts and treats newer lockfiles as read-only', async () => {
    const stage = await createStage('symlink', '# Symlink')
    await symlink(join(stage, 'SKILL.md'), join(stage, 'escape-link'))
    await expect(store.installPrepared({
      skillId: 'test-skill',
      version: '1.0.0',
      source,
      stagedDirectory: stage,
      scannerRulesVersion: 'rules-1',
      riskReportHash: riskA,
    })).rejects.toThrow(/symbolic link/)
    expect((await store.readLockfile()).revision).toBe(0)

    await atomicWriteJson(store.paths.lockfile, { schemaVersion: 2, revision: 0, installed: {} })
    const error = await store.readLockfile().catch(value => value)
    expect(error).toBeInstanceOf(UnsupportedSkillMarketSchemaError)
    expect((error as UnsupportedSkillMarketSchemaError).readOnly).toBe(true)
  })
})
