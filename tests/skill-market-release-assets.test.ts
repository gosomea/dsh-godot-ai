import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalJson } from '../src/skill-market/canonical-json.js'
import { SkillCatalogVerifier, parseSkillCatalog } from '../src/skill-market/catalog.js'
import { loadPackagedSkillMarketAssets } from '../src/skill-market/bootstrap.js'
import { resolveSkillMarketPaths } from '../src/skill-market/paths.js'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const releaseRoot = join(repositoryRoot, 'market/releases/skills-v1')
let temporaryHome: string | undefined

afterEach(async () => {
  if (temporaryHome !== undefined) await rm(temporaryHome, { recursive: true, force: true })
  temporaryHome = undefined
})

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('serial-1 Skill Catalog release assets', () => {
  it('are canonical, checksum-complete, signed, and pinned by the npm trust root', async () => {
    const [assets, catalogBytes, auditBytes, signatureBytes, trustRootBytes, checksumsBytes] = await Promise.all([
      loadPackagedSkillMarketAssets(),
      readFile(join(releaseRoot, 'catalog.json')),
      readFile(join(releaseRoot, 'catalog-audit.json')),
      readFile(join(releaseRoot, 'catalog.sig.json')),
      readFile(join(repositoryRoot, 'market/skill-catalog-root.json')),
      readFile(join(releaseRoot, 'checksums.json')),
    ])
    expect(catalogBytes.toString('utf8')).toBe(`${canonicalJson(parseSkillCatalog(JSON.parse(catalogBytes.toString('utf8'))))}\n`)
    const checksums = JSON.parse(checksumsBytes.toString('utf8')) as Record<string, string>
    expect(checksums).toEqual({
      'catalog-audit.json': sha256(auditBytes),
      'catalog.json': sha256(catalogBytes),
      'catalog.sig.json': sha256(signatureBytes),
      'skill-catalog-root.json': sha256(trustRootBytes),
    })
    expect(assets.trustRoot.initialCatalog).toEqual({ serial: 1, sha256: sha256(catalogBytes) })

    temporaryHome = await mkdtemp(join(tmpdir(), 'dsh-godot-ai-release-assets-'))
    const verifier = new SkillCatalogVerifier(assets.trustRoot, resolveSkillMarketPaths(temporaryHome), {
      now: () => new Date('2026-08-27T12:00:00.000Z'),
    })
    await expect(verifier.accept(catalogBytes, assets.signature)).resolves.toMatchObject({ catalog: { serial: 1 } })
  })

  it('records all ten requested candidates and keeps unsafe or incompatible defaults off', async () => {
    const audit = JSON.parse(await readFile(join(releaseRoot, 'catalog-audit.json'), 'utf8')) as {
      entries: Array<{ id: string; audited: boolean; installable: boolean; reason?: string; risk?: { blocked: boolean } }>
    }
    expect(audit.entries).toHaveLength(10)
    expect(audit.entries.find(entry => entry.id === 'higgsfield-game-generation')).toMatchObject({ audited: true, installable: false, risk: { blocked: true } })
    expect(audit.entries.find(entry => entry.id === 'game-engine')).toMatchObject({ audited: false, installable: false, reason: expect.stringMatching(/16777216/) })
    expect(audit.entries.find(entry => entry.id === 'develop-web-game')).toMatchObject({ audited: false, installable: false })

    const assets = await loadPackagedSkillMarketAssets()
    expect(assets.catalog.skills.find(skill => skill.id === 'game-design-theory')?.installable).toBe(false)
    expect(assets.catalog.skills.find(skill => skill.id === 'threejs-game-ui-designer')?.defaultSelected).toBe(false)
    expect(assets.candidateNotices.find(skill => skill.id === 'develop-web-game')?.installable).toBe(false)
  })
})
