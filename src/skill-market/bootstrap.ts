import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { CatalogRemoteClient, type CatalogRemoteClientOptions } from './catalog-fetch.js'
import {
  SkillCatalogVerifier,
  parseCatalogSignatureEnvelope,
  parseCatalogTrustRoot,
  parseSkillCatalog,
  type CatalogSignatureEnvelope,
  type SkillCatalogTrustRootV1,
  type SkillCatalogV1,
} from './catalog.js'
import { parseSeedReviewManifest } from './contracts.js'
import { SkillMarketService, type SkillMarketCandidateNotice } from './service.js'
import { SkillMarketStore } from './store.js'

export interface PackagedSkillMarketAssets {
  readonly trustRoot: SkillCatalogTrustRootV1
  readonly catalogBytes: Buffer
  readonly catalog: SkillCatalogV1
  readonly signature: CatalogSignatureEnvelope
  readonly candidateNotices: readonly SkillMarketCandidateNotice[]
}

export interface PackagedSkillMarketOptions {
  readonly store?: SkillMarketStore
  readonly now?: () => Date
  readonly fetch?: typeof fetch
  readonly autoCheck?: boolean
}

async function readPackaged(relativePath: string): Promise<Buffer> {
  const candidates = [new URL(`../../market/${relativePath}`, import.meta.url), new URL(`../market/${relativePath}`, import.meta.url)]
  let lastError: unknown
  for (const candidate of candidates) {
    try { return await readFile(fileURLToPath(candidate)) }
    catch (error) { lastError = error }
  }
  throw new Error(`packaged Skill Market asset ${relativePath} was not found`, { cause: lastError })
}

export async function loadPackagedSkillMarketAssets(): Promise<PackagedSkillMarketAssets> {
  const [trustRootBytes, catalogBytes, signatureBytes, seedBytes] = await Promise.all([
    readPackaged('skill-catalog-root.json'),
    readPackaged('releases/skills-v1/catalog.json'),
    readPackaged('releases/skills-v1/catalog.sig.json'),
    readPackaged('seed-review-manifest.json'),
  ])
  const trustRoot = parseCatalogTrustRoot(JSON.parse(trustRootBytes.toString('utf8')) as unknown)
  const catalog = parseSkillCatalog(JSON.parse(catalogBytes.toString('utf8')) as unknown)
  const signature = parseCatalogSignatureEnvelope(JSON.parse(signatureBytes.toString('utf8')) as unknown)
  const seed = parseSeedReviewManifest(JSON.parse(seedBytes.toString('utf8')) as unknown)
  return {
    trustRoot,
    catalogBytes,
    catalog,
    signature,
    candidateNotices: seed.candidates.map(candidate => ({
      id: candidate.id,
      upstreamStatus: candidate.upstreamStatus,
      compatibility: candidate.compatibility,
      decision: candidate.decision,
      installable: candidate.installable,
      description: candidate.notes.join(' '),
    })),
  }
}

/** Initialize the signed npm bootstrap Catalog, then check GitHub Release at most once per 24 hours. */
export async function createPackagedSkillMarketService(options: PackagedSkillMarketOptions = {}): Promise<SkillMarketService> {
  const assets = await loadPackagedSkillMarketAssets()
  const store = options.store ?? new SkillMarketStore(options.now === undefined ? {} : { now: options.now })
  const verifier = new SkillCatalogVerifier(assets.trustRoot, store.paths, options.now === undefined ? {} : { now: options.now })
  const remoteOptions: CatalogRemoteClientOptions = {
    ...options.now === undefined ? {} : { now: options.now },
    ...options.fetch === undefined ? {} : { fetch: options.fetch },
  }
  const remote = new CatalogRemoteClient(verifier, remoteOptions)
  const service = new SkillMarketService({
    store,
    catalogVerifier: verifier,
    catalogRemote: remote,
    candidateNotices: assets.candidateNotices,
    ...options.now === undefined ? {} : { now: options.now },
  })
  await service.initialize()
  const state = await verifier.readState()
  if (state === undefined) await verifier.accept(assets.catalogBytes, assets.signature)
  else await verifier.readLastGoodCatalog()
  if (options.autoCheck ?? true) void remote.check().catch(() => undefined)
  return service
}
