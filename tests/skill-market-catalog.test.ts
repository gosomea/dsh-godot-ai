import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CatalogVerificationError,
  SkillCatalogVerifier,
  type CatalogSignatureEnvelope,
  type SkillCatalogTrustRootV1,
  type SkillCatalogV1,
  type TrustKeyStatus,
} from '../src/skill-market/catalog.js'
import { CatalogFetchRateLimitError, CatalogRemoteClient } from '../src/skill-market/catalog-fetch.js'
import { resolveSkillMarketPaths } from '../src/skill-market/paths.js'

const now = new Date('2026-08-27T12:00:00.000Z')
const keyA = generateKeyPairSync('ed25519')
const keyB = generateKeyPairSync('ed25519')
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-godot-ai-catalog-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function catalog(serial: number, overrides: Partial<SkillCatalogV1> = {}): SkillCatalogV1 {
  return {
    schemaVersion: 1,
    serial,
    issuedAt: new Date(now.getTime() + (serial - 1) * 1_000).toISOString(),
    skills: [{
      id: 'game-feel',
      title: 'Game Feel',
      description: 'Improve game feedback.',
      version: '1.0.0',
      source: {
        owner: 'gamedev-skills', repo: 'awesome-gamedev-agent-skills',
        commit: '7'.repeat(40), subdir: 'skills/disciplines/game-feel',
      },
      artifactSha256: 'a'.repeat(64),
      manifestSha256: 'b'.repeat(64),
      license: { id: 'Apache-2.0', noticeRequired: true },
      upstreamStatus: 'active',
      compatibility: 'godot-compatible',
      decision: 'recommended',
      installable: true,
      defaultSelected: true,
      externalRequirements: [],
    }],
    ...overrides,
  }
}

function bytesOf(value: SkillCatalogV1): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function envelope(bytes: Uint8Array, keyId = 'catalog-2026-a', privateKey = keyA.privateKey): CatalogSignatureEnvelope {
  return {
    algorithm: 'Ed25519',
    keyId,
    catalogSha256: digest(bytes),
    signature: sign(null, bytes, privateKey).toString('base64'),
  }
}

function trustKey(keyId: string, pair: typeof keyA, status: TrustKeyStatus = 'active') {
  return {
    keyId,
    algorithm: 'Ed25519' as const,
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    status,
    notBefore: '2026-01-01T00:00:00.000Z',
  }
}

function trustRoot(initialBytes: Uint8Array, keys = [trustKey('catalog-2026-a', keyA)]): SkillCatalogTrustRootV1 {
  return {
    schemaVersion: 1,
    threshold: 1,
    keys,
    initialCatalog: { serial: 1, sha256: digest(initialBytes) },
  }
}

function verifier(
  initialBytes: Uint8Array,
  keys?: SkillCatalogTrustRootV1['keys'],
  dshHome = root,
): SkillCatalogVerifier {
  return new SkillCatalogVerifier(
    trustRoot(initialBytes, keys === undefined ? undefined : [...keys]),
    resolveSkillMarketPaths(dshHome),
    { now: () => now },
  )
}

async function rejectionCode(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.catch(reason => reason) as CatalogVerificationError
  expect(error).toBeInstanceOf(CatalogVerificationError)
  return error.code
}

describe('signed Skill Catalog', () => {
  it('bootstraps only the npm-pinned Catalog and persists last-good state', async () => {
    const bytes = bytesOf(catalog(1))
    const instance = verifier(bytes)
    const accepted = await instance.accept(bytes, envelope(bytes), { etag: '"one"' })
    expect(accepted.catalog.serial).toBe(1)
    expect(await instance.readState()).toMatchObject({
      lastGoodSerial: 1,
      lastGoodCatalogSha256: digest(bytes),
      lastGoodKeyId: 'catalog-2026-a',
      etag: '"one"',
    })

    const other = bytesOf(catalog(1, { issuedAt: '2026-08-27T11:00:00.000Z' }))
    expect(await rejectionCode(verifier(bytesOf(catalog(99)), undefined, join(root, 'zero-state')).accept(other, envelope(other)))).toBe('CATALOG_INITIAL_PIN_MISMATCH')
  })

  it('rejects a signed rollback and same-serial equivocation', async () => {
    const first = bytesOf(catalog(1))
    const instance = verifier(first)
    await instance.accept(first, envelope(first))
    const second = bytesOf(catalog(2))
    await instance.accept(second, envelope(second))
    expect(await rejectionCode(instance.accept(first, envelope(first)))).toBe('CATALOG_ROLLBACK_DETECTED')

    const equivocation = bytesOf(catalog(2, { issuedAt: '2026-08-27T11:59:00.000Z' }))
    expect(await rejectionCode(instance.accept(equivocation, envelope(equivocation)))).toBe('CATALOG_SERIAL_EQUIVOCATION')
  })

  it('serializes concurrent Catalog updates so the highest accepted serial wins', async () => {
    const first = bytesOf(catalog(1))
    const instance = verifier(first)
    await instance.accept(first, envelope(first))
    const second = bytesOf(catalog(2))
    const third = bytesOf(catalog(3))
    await Promise.allSettled([
      instance.accept(third, envelope(third)),
      instance.accept(second, envelope(second)),
    ])
    expect((await instance.readState())?.lastGoodSerial).toBe(3)
    expect((await instance.readLastGoodCatalog())?.serial).toBe(3)
  })

  it('accepts the same immutable serial and updates cache metadata', async () => {
    const bytes = bytesOf(catalog(1))
    const instance = verifier(bytes)
    await instance.accept(bytes, envelope(bytes), { etag: '"old"' })
    await instance.accept(bytes, envelope(bytes), { etag: '"new"' })
    expect((await instance.readState())?.etag).toBe('"new"')
  })

  it('fails closed when persisted Catalog bytes and state are torn or corrupted', async () => {
    const bytes = bytesOf(catalog(1))
    const instance = verifier(bytes)
    await instance.accept(bytes, envelope(bytes))
    expect((await instance.readLastGoodCatalog())?.serial).toBe(1)
    await writeFile(resolveSkillMarketPaths(root).catalogFile, bytesOf(catalog(2)))
    expect(await rejectionCode(instance.readLastGoodCatalog())).toBe('CATALOG_HASH_MISMATCH')
  })

  it('supports planned key rotation but rejects unknown and revoked keys', async () => {
    const first = bytesOf(catalog(1))
    const keys = [trustKey('catalog-2026-a', keyA, 'retiring'), trustKey('catalog-2026-b', keyB)]
    const instance = verifier(first, keys)
    await instance.accept(first, envelope(first, 'catalog-2026-a', keyA.privateKey))
    const second = bytesOf(catalog(2))
    await instance.accept(second, envelope(second, 'catalog-2026-b', keyB.privateKey))

    const unknown = envelope(second, 'unknown', keyB.privateKey)
    expect(await rejectionCode(instance.accept(second, unknown))).toBe('CATALOG_UNKNOWN_KEY')
    const revoked = verifier(first, [trustKey('catalog-2026-a', keyA, 'revoked')])
    expect(await rejectionCode(revoked.accept(first, envelope(first)))).toBe('CATALOG_REVOKED_KEY')
  })

  it('rejects hash and signature tampering before parsing Catalog content', async () => {
    const bytes = bytesOf(catalog(1))
    const instance = verifier(bytes)
    const wrongHash = { ...envelope(bytes), catalogSha256: '0'.repeat(64) }
    expect(await rejectionCode(instance.accept(bytes, wrongHash))).toBe('CATALOG_HASH_MISMATCH')
    const wrongSignature = envelope(bytes, 'catalog-2026-a', keyB.privateKey)
    expect(await rejectionCode(instance.accept(bytes, wrongSignature))).toBe('CATALOG_SIGNATURE_INVALID')
  })

  it('enforces key, issuedAt, and expiry time windows', async () => {
    const future = bytesOf(catalog(1, { issuedAt: new Date(now.getTime() + 16 * 60_000).toISOString() }))
    expect(await rejectionCode(verifier(future).accept(future, envelope(future)))).toBe('CATALOG_FUTURE_ISSUED_AT')

    const expired = bytesOf(catalog(1, {
      issuedAt: new Date(now.getTime() - 24 * 60 * 60_000).toISOString(),
      expiresAt: new Date(now.getTime() - 1).toISOString(),
    }))
    const expiredVerifier = verifier(expired)
    expect(await rejectionCode(expiredVerifier.accept(expired, envelope(expired)))).toBe('CATALOG_EXPIRED')
    expect((await expiredVerifier.accept(expired, envelope(expired), { purpose: 'view' })).expired).toBe(true)
    expect(await expiredVerifier.readState()).toBeUndefined()

    const notYetValid = [
      { ...trustKey('catalog-2026-a', keyA), notBefore: new Date(now.getTime() + 1).toISOString() },
    ]
    expect(await rejectionCode(verifier(bytesOf(catalog(1)), notYetValid).accept(bytesOf(catalog(1)), envelope(bytesOf(catalog(1)))))).toBe('CATALOG_KEY_NOT_VALID')
  })
})

describe('Catalog remote update cadence', () => {
  it('skips background network checks for 24 hours and uses ETag on a forced 304', async () => {
    const first = bytesOf(catalog(1))
    const instance = verifier(first)
    await instance.accept(first, envelope(first), { etag: '"catalog-one"' })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 304 }))
    const remote = new CatalogRemoteClient(instance, { fetch: fetchMock, now: () => now })

    expect((await remote.check()).status).toBe('not-due')
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await remote.check({ force: true })).status).toBe('not-modified')
    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get('if-none-match')).toBe('"catalog-one"')
  })

  it('downloads bytes and signature separately, then commits only verified higher serials', async () => {
    const first = bytesOf(catalog(1))
    const instance = verifier(first)
    await instance.accept(first, envelope(first))
    const second = bytesOf(catalog(2))
    const secondEnvelope = envelope(second)
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(second, { status: 200, headers: { etag: '"catalog-two"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(secondEnvelope), { status: 200 }))
    const remote = new CatalogRemoteClient(instance, { fetch: fetchMock, minimumCheckIntervalMs: 0 })
    const result = await remote.check()
    expect(result.status).toBe('updated')
    expect((await instance.readState())?.lastGoodSerial).toBe(2)
    expect((await instance.readState())?.etag).toBe('"catalog-two"')
  })

  it('does not retry rate limits and rejects release redirects to arbitrary hosts', async () => {
    const first = bytesOf(catalog(1))
    const instance = verifier(first)
    const limitedFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 429,
      headers: { 'retry-after': '120' },
    }))
    const limited = new CatalogRemoteClient(instance, { fetch: limitedFetch, minimumCheckIntervalMs: 0 })
    const error = await limited.check().catch(reason => reason)
    expect(error).toBeInstanceOf(CatalogFetchRateLimitError)
    expect((error as CatalogFetchRateLimitError).retryAfterSeconds).toBe(120)
    expect(limitedFetch).toHaveBeenCalledTimes(1)

    const redirectFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example/catalog.json' },
    }))
    const redirected = new CatalogRemoteClient(instance, { fetch: redirectFetch, minimumCheckIntervalMs: 0 })
    await expect(redirected.check()).rejects.toThrow(/outside the GitHub release allowlist/)
  })
})
