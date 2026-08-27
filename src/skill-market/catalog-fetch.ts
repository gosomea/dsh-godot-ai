import {
  SkillCatalogVerifier,
  type AcceptedCatalog,
  type SkillCatalogV1,
} from './catalog.js'

const DEFAULT_CATALOG_URL = 'https://github.com/gosomea/dsh-godot-ai/releases/download/skills-v1/catalog.json'
const DEFAULT_SIGNATURE_URL = 'https://github.com/gosomea/dsh-godot-ai/releases/download/skills-v1/catalog.sig.json'
const ALLOWED_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])

export interface CatalogRemoteClientOptions {
  readonly fetch?: typeof fetch
  readonly now?: () => Date
  readonly catalogUrl?: string
  readonly signatureUrl?: string
  readonly minimumCheckIntervalMs?: number
}

export type CatalogCheckResult =
  | { readonly status: 'not-due'; readonly catalog?: SkillCatalogV1 }
  | { readonly status: 'not-modified'; readonly catalog: SkillCatalogV1 }
  | { readonly status: 'updated'; readonly accepted: AcceptedCatalog }

export class CatalogFetchRateLimitError extends Error {
  constructor(readonly retryAfterSeconds?: number) {
    super('Skill Catalog update is rate limited; the last-good Catalog remains available')
    this.name = 'CatalogFetchRateLimitError'
  }
}

function validateReleaseUrl(value: string, expectedFilename: string): URL {
  const url = new URL(value)
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.port !== ''
    || url.hostname !== 'github.com'
    || !url.pathname.startsWith('/gosomea/dsh-godot-ai/releases/download/')
    || !url.pathname.endsWith(`/${expectedFilename}`)
  ) throw new Error(`unsupported Skill Catalog release URL: ${value}`)
  return url
}

function allowedRedirect(value: string, base: URL): URL {
  const url = new URL(value, base)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '' || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Skill Catalog redirected outside the GitHub release allowlist: ${url.origin}`)
  }
  return url
}

async function releaseFetch(fetchImpl: typeof fetch, initial: URL, headers: HeadersInit): Promise<Response> {
  let url = initial
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchImpl(url, { headers, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    if (redirects === 3) throw new Error('Skill Catalog exceeded redirect limit')
    const location = response.headers.get('location')
    if (location === null) throw new Error('Skill Catalog redirect has no Location header')
    url = allowedRedirect(location, url)
  }
  throw new Error('unreachable Catalog redirect state')
}

async function boundedBytes(response: Response, limit: number): Promise<Buffer> {
  const length = response.headers.get('content-length')
  if (length !== null && /^\d+$/u.test(length) && Number(length) > limit) throw new Error(`Skill Catalog response exceeds ${limit} bytes`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > limit) throw new Error(`Skill Catalog response exceeds ${limit} bytes`)
  return bytes
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get('retry-after')
  return value !== null && /^\d+$/u.test(value) ? Number(value) : undefined
}

function throwForResponse(response: Response, label: string): void {
  if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
    throw new CatalogFetchRateLimitError(retryAfter(response))
  }
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`)
}

/** 24-hour ETag-aware updater for the signed GitHub Release Catalog. */
export class CatalogRemoteClient {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => Date
  private readonly catalogUrl: URL
  private readonly signatureUrl: URL
  private readonly minimumCheckIntervalMs: number

  constructor(private readonly verifier: SkillCatalogVerifier, options: CatalogRemoteClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? (() => new Date())
    this.catalogUrl = validateReleaseUrl(options.catalogUrl ?? DEFAULT_CATALOG_URL, 'catalog.json')
    this.signatureUrl = validateReleaseUrl(options.signatureUrl ?? DEFAULT_SIGNATURE_URL, 'catalog.sig.json')
    this.minimumCheckIntervalMs = options.minimumCheckIntervalMs ?? 24 * 60 * 60_000
    if (!Number.isSafeInteger(this.minimumCheckIntervalMs) || this.minimumCheckIntervalMs < 0) {
      throw new Error('minimumCheckIntervalMs must be a non-negative integer')
    }
  }

  async check(options: { readonly force?: boolean } = {}): Promise<CatalogCheckResult> {
    const state = await this.verifier.readState()
    if (
      options.force !== true
      && state?.checkedAt !== undefined
      && this.now().getTime() - Date.parse(state.checkedAt) < this.minimumCheckIntervalMs
    ) {
      const catalog = await this.verifier.readLastGoodCatalog()
      return { status: 'not-due', ...catalog === undefined ? {} : { catalog } }
    }
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'dsh-godot-ai-skill-market/0.6' }
    if (state?.etag !== undefined) headers['if-none-match'] = state.etag
    const catalogResponse = await releaseFetch(this.fetchImpl, this.catalogUrl, headers)
    if (catalogResponse.status === 304) {
      const catalog = await this.verifier.readLastGoodCatalog()
      if (catalog === undefined) throw new Error('Catalog server returned 304 without a local last-good Catalog')
      await this.verifier.markChecked(state?.etag)
      return { status: 'not-modified', catalog }
    }
    throwForResponse(catalogResponse, 'Skill Catalog download')
    const catalogBytes = await boundedBytes(catalogResponse, 1024 * 1024)
    const signatureResponse = await releaseFetch(
      this.fetchImpl,
      this.signatureUrl,
      { accept: 'application/json', 'user-agent': 'dsh-godot-ai-skill-market/0.6' },
    )
    throwForResponse(signatureResponse, 'Skill Catalog signature download')
    const signatureBytes = await boundedBytes(signatureResponse, 16 * 1024)
    let signature: unknown
    try { signature = JSON.parse(signatureBytes.toString('utf8')) as unknown }
    catch { throw new Error('Skill Catalog signature response is not JSON') }
    const etag = catalogResponse.headers.get('etag') ?? undefined
    const accepted = await this.verifier.accept(catalogBytes, signature, {
      ...etag === undefined ? {} : { etag },
      purpose: 'install-or-update',
    })
    return { status: 'updated', accepted }
  }
}
