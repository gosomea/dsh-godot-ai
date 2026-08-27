import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { atomicWriteFile, atomicWriteJson, readOptionalJson, withFileLease } from './files.js'
import type { SkillMarketPaths } from './paths.js'

const SHA256 = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type CatalogUpstreamStatus = 'active' | 'moved' | 'deleted' | 'license-blocked' | 'unreachable'
export type CatalogCompatibility = 'godot-compatible' | 'engine-neutral' | 'web-runtime' | 'external-runtime' | 'engine-mismatch'
export type CatalogDecision = 'recommended' | 'optional' | 'moved' | 'blocked'

export interface CuratedSkillEntry {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly version: string
  readonly source: {
    readonly owner: string
    readonly repo: string
    readonly commit: string
    readonly subdir: string
  }
  readonly artifactSha256: string
  readonly manifestSha256: string
  readonly license: {
    readonly id: string
    readonly noticeRequired: boolean
  }
  readonly upstreamStatus: CatalogUpstreamStatus
  readonly compatibility: CatalogCompatibility
  readonly decision: CatalogDecision
  readonly installable: boolean
  readonly defaultSelected: boolean
  readonly externalRequirements: readonly string[]
}

export interface SkillCatalogV1 {
  readonly schemaVersion: 1
  readonly serial: number
  readonly issuedAt: string
  readonly expiresAt?: string
  readonly skills: readonly CuratedSkillEntry[]
}

export interface CatalogSignatureEnvelope {
  readonly algorithm: 'Ed25519'
  readonly keyId: string
  readonly catalogSha256: string
  readonly signature: string
}

export type TrustKeyStatus = 'active' | 'retiring' | 'revoked'

export interface SkillCatalogTrustRootV1 {
  readonly schemaVersion: 1
  readonly threshold: 1
  readonly keys: readonly {
    readonly keyId: string
    readonly algorithm: 'Ed25519'
    /** Base64-encoded DER SubjectPublicKeyInfo. */
    readonly publicKey: string
    readonly status: TrustKeyStatus
    readonly notBefore: string
    readonly notAfter?: string
  }[]
  readonly initialCatalog: {
    readonly serial: number
    readonly sha256: string
  }
}

export interface CatalogStateV1 {
  readonly schemaVersion: 1
  readonly lastGoodSerial: number
  readonly lastGoodIssuedAt: string
  readonly lastGoodCatalogSha256: string
  readonly lastGoodKeyId: string
  readonly etag?: string
  readonly checkedAt?: string
}

export type CatalogErrorCode =
  | 'CATALOG_INVALID'
  | 'CATALOG_HASH_MISMATCH'
  | 'CATALOG_UNKNOWN_KEY'
  | 'CATALOG_REVOKED_KEY'
  | 'CATALOG_KEY_NOT_VALID'
  | 'CATALOG_SIGNATURE_INVALID'
  | 'CATALOG_FUTURE_ISSUED_AT'
  | 'CATALOG_EXPIRED'
  | 'CATALOG_INITIAL_PIN_MISMATCH'
  | 'CATALOG_ROLLBACK_DETECTED'
  | 'CATALOG_SERIAL_EQUIVOCATION'

export class CatalogVerificationError extends Error {
  constructor(readonly code: CatalogErrorCode, message: string) {
    super(message)
    this.name = 'CatalogVerificationError'
  }
}

export interface AcceptCatalogOptions {
  readonly etag?: string
  readonly purpose?: 'view' | 'install-or-update'
}

export interface AcceptedCatalog {
  readonly catalog: SkillCatalogV1
  readonly envelope: CatalogSignatureEnvelope
  readonly state: CatalogStateV1
  readonly expired: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new CatalogVerificationError('CATALOG_INVALID', `${field} must be a non-empty string`)
  return value
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new CatalogVerificationError('CATALOG_INVALID', `${field} must be a boolean`)
  return value
}

function requiredDate(value: unknown, field: string): string {
  const text = requiredString(value, field)
  if (Number.isNaN(Date.parse(text))) throw new CatalogVerificationError('CATALOG_INVALID', `${field} must be an ISO timestamp`)
  return text
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new CatalogVerificationError('CATALOG_INVALID', `${field} must be a positive integer`)
  return Number(value)
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new CatalogVerificationError('CATALOG_INVALID', `${field} must be an array of strings`)
  }
  return value
}

export function parseSkillCatalog(value: unknown): SkillCatalogV1 {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new CatalogVerificationError('CATALOG_INVALID', 'unsupported Catalog schema')
  const serial = positiveInteger(value.serial, 'catalog.serial')
  const issuedAt = requiredDate(value.issuedAt, 'catalog.issuedAt')
  const expiresAt = value.expiresAt === undefined ? undefined : requiredDate(value.expiresAt, 'catalog.expiresAt')
  if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new CatalogVerificationError('CATALOG_INVALID', 'catalog.expiresAt must be after issuedAt')
  }
  if (!Array.isArray(value.skills)) throw new CatalogVerificationError('CATALOG_INVALID', 'catalog.skills must be an array')
  const ids = new Set<string>()
  const skills = value.skills.map((raw, index): CuratedSkillEntry => {
    const field = `catalog.skills[${index}]`
    if (!isRecord(raw) || !isRecord(raw.source) || !isRecord(raw.license)) {
      throw new CatalogVerificationError('CATALOG_INVALID', `${field} is malformed`)
    }
    const id = requiredString(raw.id, `${field}.id`)
    if (!IDENTIFIER.test(id) || ids.has(id)) throw new CatalogVerificationError('CATALOG_INVALID', `${field}.id is invalid or duplicated`)
    ids.add(id)
    const commit = requiredString(raw.source.commit, `${field}.source.commit`)
    const owner = requiredString(raw.source.owner, `${field}.source.owner`)
    const repo = requiredString(raw.source.repo, `${field}.source.repo`)
    const subdir = requiredString(raw.source.subdir, `${field}.source.subdir`)
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new CatalogVerificationError('CATALOG_INVALID', `${field}.source repository identity is invalid`)
    }
    if (subdir.startsWith('/') || subdir.split('/').some(component => component === '' || component === '.' || component === '..' || component.includes('\\'))) {
      throw new CatalogVerificationError('CATALOG_INVALID', `${field}.source.subdir is unsafe`)
    }
    const artifactSha256 = requiredString(raw.artifactSha256, `${field}.artifactSha256`)
    const manifestSha256 = requiredString(raw.manifestSha256, `${field}.manifestSha256`)
    if (!COMMIT.test(commit) || !SHA256.test(artifactSha256) || !SHA256.test(manifestSha256)) {
      throw new CatalogVerificationError('CATALOG_INVALID', `${field} contains an invalid digest`)
    }
    const upstreamStatus = requiredString(raw.upstreamStatus, `${field}.upstreamStatus`) as CatalogUpstreamStatus
    const compatibility = requiredString(raw.compatibility, `${field}.compatibility`) as CatalogCompatibility
    const decision = requiredString(raw.decision, `${field}.decision`) as CatalogDecision
    if (!['active', 'moved', 'deleted', 'license-blocked', 'unreachable'].includes(upstreamStatus)) throw new CatalogVerificationError('CATALOG_INVALID', `${field}.upstreamStatus is invalid`)
    if (!['godot-compatible', 'engine-neutral', 'web-runtime', 'external-runtime', 'engine-mismatch'].includes(compatibility)) throw new CatalogVerificationError('CATALOG_INVALID', `${field}.compatibility is invalid`)
    if (!['recommended', 'optional', 'moved', 'blocked'].includes(decision)) throw new CatalogVerificationError('CATALOG_INVALID', `${field}.decision is invalid`)
    const installable = requiredBoolean(raw.installable, `${field}.installable`)
    const defaultSelected = requiredBoolean(raw.defaultSelected, `${field}.defaultSelected`)
    if (defaultSelected && (!installable || decision !== 'recommended')) throw new CatalogVerificationError('CATALOG_INVALID', `${field} cannot be selected by default`)
    if (installable && upstreamStatus !== 'active') throw new CatalogVerificationError('CATALOG_INVALID', `${field} cannot install an inactive upstream`)
    return {
      id,
      title: requiredString(raw.title, `${field}.title`),
      description: requiredString(raw.description, `${field}.description`),
      version: requiredString(raw.version, `${field}.version`),
      source: {
        owner,
        repo,
        commit,
        subdir,
      },
      artifactSha256,
      manifestSha256,
      license: {
        id: requiredString(raw.license.id, `${field}.license.id`),
        noticeRequired: requiredBoolean(raw.license.noticeRequired, `${field}.license.noticeRequired`),
      },
      upstreamStatus,
      compatibility,
      decision,
      installable,
      defaultSelected,
      externalRequirements: stringArray(raw.externalRequirements, `${field}.externalRequirements`),
    }
  })
  return { schemaVersion: 1, serial, issuedAt, ...expiresAt === undefined ? {} : { expiresAt }, skills }
}

export function parseCatalogSignatureEnvelope(value: unknown): CatalogSignatureEnvelope {
  if (!isRecord(value) || value.algorithm !== 'Ed25519') throw new CatalogVerificationError('CATALOG_INVALID', 'Catalog signature envelope is malformed')
  const catalogSha256 = requiredString(value.catalogSha256, 'signature.catalogSha256')
  if (!SHA256.test(catalogSha256)) throw new CatalogVerificationError('CATALOG_INVALID', 'signature.catalogSha256 is invalid')
  const signature = requiredString(value.signature, 'signature.signature')
  const signatureBytes = Buffer.from(signature, 'base64')
  if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== signature) {
    throw new CatalogVerificationError('CATALOG_INVALID', 'signature.signature is not canonical Ed25519 base64')
  }
  return { algorithm: 'Ed25519', keyId: requiredString(value.keyId, 'signature.keyId'), catalogSha256, signature }
}

export function parseCatalogTrustRoot(value: unknown): SkillCatalogTrustRootV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.threshold !== 1 || !Array.isArray(value.keys) || !isRecord(value.initialCatalog)) {
    throw new CatalogVerificationError('CATALOG_INVALID', 'Catalog trust root is malformed')
  }
  if (value.keys.length === 0) throw new CatalogVerificationError('CATALOG_INVALID', 'Catalog trust root has no keys')
  const ids = new Set<string>()
  const keys = value.keys.map((raw, index) => {
    const field = `trustRoot.keys[${index}]`
    if (!isRecord(raw) || raw.algorithm !== 'Ed25519') throw new CatalogVerificationError('CATALOG_INVALID', `${field} is malformed`)
    const keyId = requiredString(raw.keyId, `${field}.keyId`)
    if (ids.has(keyId)) throw new CatalogVerificationError('CATALOG_INVALID', `duplicate trust key ${keyId}`)
    ids.add(keyId)
    const publicKey = requiredString(raw.publicKey, `${field}.publicKey`)
    try {
      const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' })
      if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong key type')
    } catch { throw new CatalogVerificationError('CATALOG_INVALID', `${field}.publicKey is not Ed25519 SPKI`) }
    const status = requiredString(raw.status, `${field}.status`) as TrustKeyStatus
    if (!['active', 'retiring', 'revoked'].includes(status)) throw new CatalogVerificationError('CATALOG_INVALID', `${field}.status is invalid`)
    const notBefore = requiredDate(raw.notBefore, `${field}.notBefore`)
    const notAfter = raw.notAfter === undefined ? undefined : requiredDate(raw.notAfter, `${field}.notAfter`)
    if (notAfter !== undefined && Date.parse(notAfter) <= Date.parse(notBefore)) {
      throw new CatalogVerificationError('CATALOG_INVALID', `${field}.notAfter must be after notBefore`)
    }
    return {
      keyId,
      algorithm: 'Ed25519' as const,
      publicKey,
      status,
      notBefore,
      ...notAfter === undefined ? {} : { notAfter },
    }
  })
  const sha256 = requiredString(value.initialCatalog.sha256, 'trustRoot.initialCatalog.sha256')
  if (!SHA256.test(sha256)) throw new CatalogVerificationError('CATALOG_INVALID', 'trustRoot.initialCatalog.sha256 is invalid')
  return {
    schemaVersion: 1,
    threshold: 1,
    keys,
    initialCatalog: { serial: positiveInteger(value.initialCatalog.serial, 'trustRoot.initialCatalog.serial'), sha256 },
  }
}

function parseCatalogState(value: unknown): CatalogStateV1 | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || value.schemaVersion !== 1) throw new CatalogVerificationError('CATALOG_INVALID', 'Catalog state is malformed')
  const lastGoodCatalogSha256 = requiredString(value.lastGoodCatalogSha256, 'state.lastGoodCatalogSha256')
  if (!SHA256.test(lastGoodCatalogSha256)) throw new CatalogVerificationError('CATALOG_INVALID', 'state.lastGoodCatalogSha256 is invalid')
  return {
    schemaVersion: 1,
    lastGoodSerial: positiveInteger(value.lastGoodSerial, 'state.lastGoodSerial'),
    lastGoodIssuedAt: requiredDate(value.lastGoodIssuedAt, 'state.lastGoodIssuedAt'),
    lastGoodCatalogSha256,
    lastGoodKeyId: requiredString(value.lastGoodKeyId, 'state.lastGoodKeyId'),
    ...value.etag === undefined ? {} : { etag: requiredString(value.etag, 'state.etag') },
    ...value.checkedAt === undefined ? {} : { checkedAt: requiredDate(value.checkedAt, 'state.checkedAt') },
  }
}

export class SkillCatalogVerifier {
  private readonly trustRoot: SkillCatalogTrustRootV1
  private readonly now: () => Date

  constructor(
    trustRoot: SkillCatalogTrustRootV1,
    private readonly paths: SkillMarketPaths,
    options: { readonly now?: () => Date } = {},
  ) {
    this.trustRoot = parseCatalogTrustRoot(trustRoot)
    this.now = options.now ?? (() => new Date())
  }

  async readState(): Promise<CatalogStateV1 | undefined> {
    return parseCatalogState(await readOptionalJson(this.paths.catalogState))
  }

  async markChecked(etag?: string): Promise<CatalogStateV1 | undefined> {
    return withFileLease(this.paths.catalogLock, async () => {
      const current = await this.readState()
      if (current === undefined) return undefined
      const updated: CatalogStateV1 = {
        ...current,
        ...etag === undefined ? {} : { etag },
        checkedAt: this.now().toISOString(),
      }
      await atomicWriteJson(this.paths.catalogState, updated)
      return updated
    })
  }

  async accept(catalogBytes: Uint8Array, envelopeValue: unknown, options: AcceptCatalogOptions = {}): Promise<AcceptedCatalog> {
    const envelope = parseCatalogSignatureEnvelope(envelopeValue)
    const digest = createHash('sha256').update(catalogBytes).digest('hex')
    if (digest !== envelope.catalogSha256) throw new CatalogVerificationError('CATALOG_HASH_MISMATCH', 'Catalog bytes do not match the signed digest')
    const key = this.trustRoot.keys.find(candidate => candidate.keyId === envelope.keyId)
    if (key === undefined) throw new CatalogVerificationError('CATALOG_UNKNOWN_KEY', `unknown Catalog key ${envelope.keyId}`)
    if (key.status === 'revoked') throw new CatalogVerificationError('CATALOG_REVOKED_KEY', `Catalog key ${key.keyId} is revoked`)
    const now = this.now()
    const notBefore = Date.parse(key.notBefore)
    const notAfter = key.notAfter === undefined ? undefined : Date.parse(key.notAfter)
    if (now.getTime() < notBefore || (notAfter !== undefined && now.getTime() > notAfter)) {
      throw new CatalogVerificationError('CATALOG_KEY_NOT_VALID', `Catalog key ${key.keyId} is outside its validity window`)
    }
    const publicKey = createPublicKey({ key: Buffer.from(key.publicKey, 'base64'), format: 'der', type: 'spki' })
    if (!verifySignature(null, catalogBytes, publicKey, Buffer.from(envelope.signature, 'base64'))) {
      throw new CatalogVerificationError('CATALOG_SIGNATURE_INVALID', 'Catalog Ed25519 signature is invalid')
    }
    let parsedValue: unknown
    try { parsedValue = JSON.parse(Buffer.from(catalogBytes).toString('utf8')) as unknown }
    catch { throw new CatalogVerificationError('CATALOG_INVALID', 'Catalog is not valid UTF-8 JSON') }
    const catalog = parseSkillCatalog(parsedValue)
    if (Date.parse(catalog.issuedAt) > now.getTime() + 15 * 60_000) {
      throw new CatalogVerificationError('CATALOG_FUTURE_ISSUED_AT', 'Catalog issuedAt is more than 15 minutes in the future')
    }
    const expired = catalog.expiresAt !== undefined && Date.parse(catalog.expiresAt) < now.getTime()
    if (expired && (options.purpose ?? 'install-or-update') !== 'view') {
      throw new CatalogVerificationError('CATALOG_EXPIRED', 'Catalog is expired and cannot install or update Skills')
    }
    return withFileLease(this.paths.catalogLock, async () => {
      const previous = await this.readState()
      if (previous === undefined) {
        if (catalog.serial !== this.trustRoot.initialCatalog.serial || digest !== this.trustRoot.initialCatalog.sha256) {
          throw new CatalogVerificationError('CATALOG_INITIAL_PIN_MISMATCH', 'zero-state Catalog does not match the npm trust root pin')
        }
      } else if (catalog.serial < previous.lastGoodSerial) {
        throw new CatalogVerificationError('CATALOG_ROLLBACK_DETECTED', `Catalog serial ${catalog.serial} is older than ${previous.lastGoodSerial}`)
      } else if (catalog.serial === previous.lastGoodSerial && digest !== previous.lastGoodCatalogSha256) {
        throw new CatalogVerificationError('CATALOG_SERIAL_EQUIVOCATION', `Catalog serial ${catalog.serial} has different bytes`)
      }
      const state: CatalogStateV1 = {
        schemaVersion: 1,
        lastGoodSerial: catalog.serial,
        lastGoodIssuedAt: catalog.issuedAt,
        lastGoodCatalogSha256: digest,
        lastGoodKeyId: key.keyId,
        ...options.etag === undefined ? {} : { etag: options.etag },
        checkedAt: now.toISOString(),
      }
      if (!expired) {
        await atomicWriteFile(this.paths.catalogFile, catalogBytes)
        await atomicWriteJson(this.paths.catalogSignature, envelope)
        await atomicWriteJson(this.paths.catalogState, state)
      }
      return { catalog, envelope, state, expired }
    })
  }

  async readLastGoodCatalog(): Promise<SkillCatalogV1 | undefined> {
    return withFileLease(this.paths.catalogLock, async () => {
      const state = await this.readState()
      if (state === undefined) return undefined
      const [catalogBytes, envelopeValue] = await Promise.all([
        readFile(this.paths.catalogFile),
        readOptionalJson(this.paths.catalogSignature),
      ])
      const envelope = parseCatalogSignatureEnvelope(envelopeValue)
      const digest = createHash('sha256').update(catalogBytes).digest('hex')
      if (digest !== state.lastGoodCatalogSha256 || digest !== envelope.catalogSha256) {
        throw new CatalogVerificationError('CATALOG_HASH_MISMATCH', 'stored last-good Catalog is torn or corrupted')
      }
      if (envelope.keyId !== state.lastGoodKeyId) throw new CatalogVerificationError('CATALOG_INVALID', 'stored Catalog key does not match state')
      const key = this.trustRoot.keys.find(candidate => candidate.keyId === envelope.keyId)
      if (key === undefined) throw new CatalogVerificationError('CATALOG_UNKNOWN_KEY', `unknown stored Catalog key ${envelope.keyId}`)
      if (key.status === 'revoked') throw new CatalogVerificationError('CATALOG_REVOKED_KEY', `stored Catalog key ${key.keyId} is revoked`)
      const publicKey = createPublicKey({ key: Buffer.from(key.publicKey, 'base64'), format: 'der', type: 'spki' })
      if (!verifySignature(null, catalogBytes, publicKey, Buffer.from(envelope.signature, 'base64'))) {
        throw new CatalogVerificationError('CATALOG_SIGNATURE_INVALID', 'stored Catalog signature is invalid')
      }
      const catalog = parseSkillCatalog(JSON.parse(catalogBytes.toString('utf8')) as unknown)
      if (catalog.serial !== state.lastGoodSerial || catalog.issuedAt !== state.lastGoodIssuedAt) {
        throw new CatalogVerificationError('CATALOG_INVALID', 'stored Catalog metadata does not match state')
      }
      return catalog
    })
  }
}
