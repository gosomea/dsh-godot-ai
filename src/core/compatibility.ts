import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const VERSION_PATTERN = /^\d+\.\d+(?:\.\d+)?(?:[A-Za-z0-9.+_-]*)$/
const DOMAIN_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/

export interface ReconnectPolicy {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly maxAttempts: number
}

export interface GodotAiCompatibility {
  readonly defaultVersion: string
  readonly testedVersions: readonly string[]
  readonly attachProtocolVersion: number
  readonly expectedToolCount: number
  readonly expectedToolCatalogHash: string
  readonly httpPort: number
  readonly wsPort: number
  readonly excludeDomains: readonly string[]
  readonly toolCallTimeoutMs: number
  readonly reconnect: ReconnectPolicy
  readonly pypiJsonUrl: string
  readonly godotMinimum: string
  readonly godotRecommended: string
}

export interface CompatibilityManifest {
  readonly schemaVersion: 2
  readonly wrapperVersion: string
  readonly dsh: { readonly tested: string; readonly range: string }
  readonly godotAi: GodotAiCompatibility
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`)
  return value
}

function version(value: unknown, path: string): string {
  const parsed = string(value, path)
  if (!VERSION_PATTERN.test(parsed)) throw new Error(`${path} must be a version token`)
  return parsed
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${path} must be an integer between ${min} and ${max}`)
  }
  return value as number
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value.map((item, index) => string(item, `${path}[${index}]`))
}

export function parseCompatibilityManifest(value: unknown): CompatibilityManifest {
  const root = record(value, 'compatibility')
  if (root.schemaVersion !== 2) throw new Error('compatibility.schemaVersion must be 2')
  const dsh = record(root.dsh, 'compatibility.dsh')
  const godotAi = record(root.godotAi, 'compatibility.godotAi')
  const reconnect = record(godotAi.reconnect, 'compatibility.godotAi.reconnect')
  const testedVersions = stringArray(godotAi.testedVersions, 'compatibility.godotAi.testedVersions')
    .map((item, index) => version(item, `compatibility.godotAi.testedVersions[${index}]`))
  if (testedVersions.length === 0) throw new Error('compatibility.godotAi.testedVersions must not be empty')
  if (new Set(testedVersions).size !== testedVersions.length) throw new Error('compatibility.godotAi.testedVersions must be unique')
  const defaultVersion = version(godotAi.defaultVersion, 'compatibility.godotAi.defaultVersion')
  if (!testedVersions.includes(defaultVersion)) {
    throw new Error('compatibility.godotAi.defaultVersion must appear in testedVersions')
  }
  const excludeDomains = stringArray(godotAi.excludeDomains, 'compatibility.godotAi.excludeDomains')
  for (const domain of excludeDomains) {
    if (!DOMAIN_PATTERN.test(domain)) throw new Error(`invalid Godot AI excluded domain: ${domain}`)
  }
  if (new Set(excludeDomains).size !== excludeDomains.length) {
    throw new Error('compatibility.godotAi.excludeDomains must be unique')
  }
  const pypiJsonUrl = string(godotAi.pypiJsonUrl, 'compatibility.godotAi.pypiJsonUrl')
  const parsedUrl = new URL(pypiJsonUrl)
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'pypi.org' || parsedUrl.username !== '' || parsedUrl.password !== '') {
    throw new Error('compatibility.godotAi.pypiJsonUrl must be an unauthenticated https://pypi.org URL')
  }
  return Object.freeze({
    schemaVersion: 2 as const,
    wrapperVersion: version(root.wrapperVersion, 'compatibility.wrapperVersion'),
    dsh: Object.freeze({
      tested: string(dsh.tested, 'compatibility.dsh.tested'),
      range: string(dsh.range, 'compatibility.dsh.range'),
    }),
    godotAi: Object.freeze({
      defaultVersion,
      testedVersions: Object.freeze(testedVersions),
      attachProtocolVersion: integer(godotAi.attachProtocolVersion, 'compatibility.godotAi.attachProtocolVersion', 1, 1_000),
      expectedToolCount: integer(godotAi.expectedToolCount, 'compatibility.godotAi.expectedToolCount', 1, 10_000),
      expectedToolCatalogHash: (() => {
        const hash = string(godotAi.expectedToolCatalogHash, 'compatibility.godotAi.expectedToolCatalogHash')
        if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('compatibility.godotAi.expectedToolCatalogHash must be a lowercase SHA-256')
        return hash
      })(),
      httpPort: integer(godotAi.httpPort, 'compatibility.godotAi.httpPort', 1, 65_535),
      wsPort: integer(godotAi.wsPort, 'compatibility.godotAi.wsPort', 1, 65_535),
      excludeDomains: Object.freeze(excludeDomains),
      toolCallTimeoutMs: integer(godotAi.toolCallTimeoutMs, 'compatibility.godotAi.toolCallTimeoutMs', 1_000, 3_600_000),
      reconnect: Object.freeze({
        initialDelayMs: integer(reconnect.initialDelayMs, 'compatibility.godotAi.reconnect.initialDelayMs', 1, 3_600_000),
        maxDelayMs: integer(reconnect.maxDelayMs, 'compatibility.godotAi.reconnect.maxDelayMs', 1, 3_600_000),
        maxAttempts: integer(reconnect.maxAttempts, 'compatibility.godotAi.reconnect.maxAttempts', 1, 10_000),
      }),
      pypiJsonUrl,
      godotMinimum: version(godotAi.godotMinimum, 'compatibility.godotAi.godotMinimum'),
      godotRecommended: version(godotAi.godotRecommended, 'compatibility.godotAi.godotRecommended'),
    }),
  })
}

export async function loadCompatibilityManifest(): Promise<CompatibilityManifest> {
  // Bundles land in lib/*.js (../compatibility.json); source-mode tests and
  // prepare tooling execute src/core/*.ts (../../compatibility.json).
  const candidates = [
    new URL('../compatibility.json', import.meta.url),
    new URL('../../compatibility.json', import.meta.url),
  ]
  let lastError: unknown
  for (const candidate of candidates) {
    try { return parseCompatibilityManifest(JSON.parse(await readFile(fileURLToPath(candidate), 'utf8'))) }
    catch (error) {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        lastError = error
        continue
      }
      throw error
    }
  }
  throw new Error('dsh-godot-ai compatibility.json was not found', { cause: lastError })
}
