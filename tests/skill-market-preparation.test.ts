import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareThirdPartyArtifact } from '../src/skill-market/preparation.js'
import { scanPreparedThirdPartyArtifact } from '../src/skill-market/scanner.js'

let root: string
let source: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-godot-ai-prepare-'))
  source = join(root, 'source')
  await mkdir(join(source, 'references'), { recursive: true })
  await mkdir(join(source, 'scripts'), { recursive: true })
  await writeFile(join(source, 'SKILL.md'), '# Skill')
  await writeFile(join(source, 'references/guide.md'), '# Guide')
  await writeFile(join(source, 'scripts/install.sh'), '#!/bin/sh\necho install', { mode: 0o755 })
  await writeFile(join(source, 'bootstrap.ps1'), 'Write-Host install')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('third-party artifact preparation', () => {
  it('keeps prompt resources separate from never-executed scripts', async () => {
    const prepared = await prepareThirdPartyArtifact(source, join(root, 'resource'), join(root, 'quarantine'))
    expect(prepared.resourceFiles).toEqual(['SKILL.md', 'references/guide.md'])
    expect(prepared.quarantinedFiles).toEqual(['bootstrap.ps1', 'scripts/install.sh'])
    expect(await readFile(join(prepared.resourceDirectory, 'SKILL.md'), 'utf8')).toBe('# Skill')
    expect(await readFile(join(prepared.quarantineDirectory, 'scripts/install.sh'), 'utf8')).toContain('echo install')
    await expect(access(join(prepared.resourceDirectory, 'scripts/install.sh'))).rejects.toThrow()
    expect(prepared.artifactHash).toMatch(/^[a-f0-9]{64}$/)
    const report = await scanPreparedThirdPartyArtifact(prepared)
    expect(report.artifactHash).toBe(prepared.artifactHash)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'quarantined-script-tree', file: 'scripts/install.sh' }),
      expect.objectContaining({ ruleId: 'quarantined-file', file: 'scripts/install.sh' }),
      expect.objectContaining({ ruleId: 'quarantined-file', file: 'bootstrap.ps1' }),
    ]))
  })

  it('rejects symlinks before anything can enter the Provider resource tree', async () => {
    await symlink(join(source, 'SKILL.md'), join(source, 'references/link.md'))
    await expect(prepareThirdPartyArtifact(source, join(root, 'resource'), join(root, 'quarantine'))).rejects.toThrow(/symbolic link/)
  })
})
