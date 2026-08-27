import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CompatibilityManifest } from '../core/compatibility.js'
import type {
  BackendDetails,
  BackendState,
  EditorState,
  GodotAiUpdateState,
  GodotEditorSession,
  GodotIntegrationSnapshot,
  UvxState,
} from '../core/types.js'

const execFile = promisify(execFileCallback)
const DEFAULT_CACHE_TTL_MS = 3_000
const DEFAULT_UPDATE_CACHE_TTL_MS = 30 * 60_000
const LOCAL_TIMEOUT_MS = 2_000
const UPDATE_TIMEOUT_MS = 3_000

export interface IntegrationProbeDependencies {
  readonly probeUvx?: () => Promise<UvxState>
  readonly fetch?: typeof globalThis.fetch
  readonly readEditorSessions?: (url: URL) => Promise<readonly GodotEditorSession[]>
  readonly now?: () => number
  readonly cacheTtlMs?: number
  readonly updateCacheTtlMs?: number
}

export type UvxRunner = (
  command: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean },
) => Promise<{ stdout: string; stderr: string }>

function reason(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message.slice(0, 240)
  return fallback
}

export async function probeUvx(run: UvxRunner = execFile as UvxRunner): Promise<UvxState> {
  try {
    const result = await run('uvx', ['--version'], {
      timeout: LOCAL_TIMEOUT_MS,
      maxBuffer: 4_096,
      windowsHide: true,
    })
    const output = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/, 1)[0]?.trim() ?? ''
    if (output === '') return { kind: 'error', reason: 'uvx --version returned no version' }
    return { kind: 'available', version: output.slice(0, 120) }
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'error', reason: reason(error, 'uvx probe failed') }
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function backendDetails(payload: unknown): BackendDetails | undefined {
  const value = object(payload)
  if (value?.name !== 'godot-ai') return undefined
  if (
    typeof value.server_version !== 'string' || value.server_version === ''
    || !Number.isInteger(value.attach_protocol_version) || (value.attach_protocol_version as number) < 1
    || !Number.isInteger(value.ws_port) || (value.ws_port as number) < 1 || (value.ws_port as number) > 65_535
    || !Array.isArray(value.exclude_domains)
    || !value.exclude_domains.every(domain => typeof domain === 'string')
    || typeof value.owner_type !== 'string' || !['plugin', 'attach', 'external'].includes(value.owner_type)
    || typeof value.tool_catalog_hash !== 'string' || !/^[0-9a-f]{64}$/.test(value.tool_catalog_hash)
    || !Number.isInteger(value.active_lease_count) || (value.active_lease_count as number) < 0
  ) return undefined
  return {
    serverVersion: value.server_version,
    attachProtocolVersion: value.attach_protocol_version as number,
    wsPort: value.ws_port as number,
    excludeDomains: value.exclude_domains as string[],
    ownerType: value.owner_type,
    toolCatalogHash: value.tool_catalog_hash,
    activeLeaseCount: value.active_lease_count as number,
  }
}

function compatibilityDifference(details: BackendDetails, manifest: CompatibilityManifest): string | undefined {
  const expected = manifest.godotAi
  if (details.serverVersion !== expected.defaultVersion) {
    return `backend version ${details.serverVersion} does not match tested pin ${expected.defaultVersion}`
  }
  if (details.attachProtocolVersion !== expected.attachProtocolVersion) {
    return `attach protocol ${details.attachProtocolVersion} does not match ${expected.attachProtocolVersion}`
  }
  if (details.wsPort !== expected.wsPort) return `backend WS port ${details.wsPort} does not match ${expected.wsPort}`
  const actualDomains = [...details.excludeDomains].sort().join(',')
  const expectedDomains = [...expected.excludeDomains].sort().join(',')
  if (actualDomains !== expectedDomains) return 'backend excluded domains do not match the complete tool-surface policy'
  if (details.toolCatalogHash !== expected.expectedToolCatalogHash) {
    return 'backend tool catalog hash does not match the tested complete tool surface'
  }
  return undefined
}

function looksLikeStopped(error: unknown): boolean {
  const message = reason(error, '').toLowerCase()
  return message.includes('econnrefused')
    || message.includes('fetch failed')
    || message.includes('connection refused')
    || message.includes('abort')
    || message.includes('timeout')
}

export async function probeBackend(
  manifest: CompatibilityManifest,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<BackendState> {
  const url = `http://127.0.0.1:${manifest.godotAi.httpPort}/godot-ai/status`
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
    })
    if (!response.ok) return { kind: 'foreign-listener', reason: `listener returned HTTP ${response.status}` }
    const details = backendDetails(await response.json())
    if (details === undefined) return { kind: 'foreign-listener', reason: 'listener did not return a valid godot-ai status document' }
    const difference = compatibilityDifference(details, manifest)
    return difference === undefined
      ? { kind: 'ready', details }
      : { kind: 'incompatible', reason: difference, details }
  } catch (error) {
    return looksLikeStopped(error)
      ? { kind: 'stopped' }
      : { kind: 'error', reason: reason(error, 'backend probe failed') }
  }
}

function textPayload(content: unknown): unknown {
  if (!Array.isArray(content)) return undefined
  for (const item of content) {
    const block = object(item)
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    try { return JSON.parse(block.text) }
    catch { /* another block may contain JSON */ }
  }
  return undefined
}

function stringField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key] : ''
}

export function parseEditorSessions(result: unknown): readonly GodotEditorSession[] {
  const envelope = object(result)
  const raw = object(envelope?.structuredContent) ?? object(textPayload(envelope?.content))
  const data = object(raw?.data) ?? raw
  if (!Array.isArray(data?.sessions)) throw new Error('session_manage list returned no sessions array')
  return data.sessions.map((entry, index) => {
    const session = object(entry)
    if (session === undefined || typeof session.session_id !== 'string' || session.session_id === '') {
      throw new Error(`session_manage list returned an invalid session at index ${index}`)
    }
    return Object.freeze({
      sessionId: session.session_id,
      name: stringField(session, 'name'),
      godotVersion: stringField(session, 'godot_version'),
      projectPath: stringField(session, 'project_path'),
      pluginVersion: stringField(session, 'plugin_version'),
      currentScene: stringField(session, 'current_scene'),
      playState: stringField(session, 'play_state'),
      readiness: stringField(session, 'readiness'),
      isActive: session.is_active === true,
    })
  })
}

export async function readEditorSessions(url: URL): Promise<readonly GodotEditorSession[]> {
  const client = new Client({ name: 'dsh-godot-ai-status', version: '0.6.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(url)
  try {
    // SDK 1.x exposes sessionId as optional without `| undefined`; widen only
    // that exactOptionalPropertyTypes mismatch, as DSH's MCP transport does.
    await client.connect(transport as Transport)
    const result = await client.callTool(
      { name: 'session_manage', arguments: { op: 'list' } },
      undefined,
      { timeout: LOCAL_TIMEOUT_MS, maxTotalTimeout: LOCAL_TIMEOUT_MS },
    )
    if (result.isError === true) throw new Error('session_manage list returned an MCP error')
    return parseEditorSessions(result)
  } finally {
    await client.close().catch(() => {})
  }
}

async function probeUpdate(manifest: CompatibilityManifest, fetchImpl: typeof globalThis.fetch): Promise<GodotAiUpdateState> {
  try {
    const response = await fetchImpl(manifest.godotAi.pypiJsonUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`PyPI returned HTTP ${response.status}`)
    const payload = object(await response.json())
    const info = object(payload?.info)
    if (typeof info?.version !== 'string' || info.version === '') throw new Error('PyPI response has no version')
    if (info.version === manifest.godotAi.defaultVersion) return { kind: 'current', latestVersion: info.version }
    return manifest.godotAi.testedVersions.includes(info.version)
      ? { kind: 'verified-update', latestVersion: info.version }
      : { kind: 'unverified-update', latestVersion: info.version }
  } catch (error) {
    return { kind: 'unavailable', reason: reason(error, 'latest-version check failed') }
  }
}

export class GodotIntegrationManager {
  readonly #manifest: CompatibilityManifest
  readonly #wrapperVersion: string
  readonly #probeUvx: () => Promise<UvxState>
  readonly #fetch: typeof globalThis.fetch
  readonly #readEditorSessions: (url: URL) => Promise<readonly GodotEditorSession[]>
  readonly #now: () => number
  readonly #cacheTtlMs: number
  readonly #updateCacheTtlMs: number
  #cached?: { readonly at: number; readonly snapshot: GodotIntegrationSnapshot }
  #cachedUpdate?: { readonly at: number; readonly update: GodotAiUpdateState }
  #inFlight: Promise<GodotIntegrationSnapshot> | undefined
  #updateInFlight: Promise<GodotAiUpdateState> | undefined

  constructor(manifest: CompatibilityManifest, wrapperVersion: string, deps: IntegrationProbeDependencies = {}) {
    this.#manifest = manifest
    this.#wrapperVersion = wrapperVersion
    this.#probeUvx = deps.probeUvx ?? probeUvx
    this.#fetch = deps.fetch ?? globalThis.fetch
    this.#readEditorSessions = deps.readEditorSessions ?? readEditorSessions
    this.#now = deps.now ?? Date.now
    this.#cacheTtlMs = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.#updateCacheTtlMs = deps.updateCacheTtlMs ?? DEFAULT_UPDATE_CACHE_TTL_MS
  }

  snapshot(force = false): Promise<GodotIntegrationSnapshot> {
    const now = this.#now()
    if (!force && this.#cached !== undefined && now - this.#cached.at < this.#cacheTtlMs) {
      return Promise.resolve(this.#cached.snapshot)
    }
    if (this.#inFlight !== undefined) return this.#inFlight
    const running = this.#buildSnapshot(force).then((snapshot) => {
      this.#cached = { at: this.#now(), snapshot }
      return snapshot
    }).finally(() => { this.#inFlight = undefined })
    this.#inFlight = running
    return running
  }

  async #update(force: boolean): Promise<GodotAiUpdateState> {
    const now = this.#now()
    if (!force && this.#cachedUpdate !== undefined && now - this.#cachedUpdate.at < this.#updateCacheTtlMs) {
      return this.#cachedUpdate.update
    }
    if (this.#updateInFlight !== undefined) return this.#updateInFlight
    const running = probeUpdate(this.#manifest, this.#fetch).then((update) => {
      this.#cachedUpdate = { at: this.#now(), update }
      return update
    }).finally(() => { this.#updateInFlight = undefined })
    this.#updateInFlight = running
    return running
  }

  async #buildSnapshot(force: boolean): Promise<GodotIntegrationSnapshot> {
    const [uvx, backend, update] = await Promise.all([
      this.#probeUvx(),
      probeBackend(this.#manifest, this.#fetch),
      this.#update(force),
    ])
    let editor: EditorState
    if (backend.kind !== 'ready') {
      editor = { kind: 'unavailable', reason: 'compatible backend is not running' }
    } else {
      try {
        const sessions = await this.#readEditorSessions(new URL(`http://127.0.0.1:${this.#manifest.godotAi.httpPort}/mcp`))
        editor = sessions.length === 0 ? { kind: 'not-connected' } : { kind: 'connected', sessions }
      } catch (error) {
        editor = { kind: 'unknown', reason: reason(error, 'editor session probe failed') }
      }
    }
    return Object.freeze({
      checkedAt: new Date(this.#now()).toISOString(),
      wrapperVersion: this.#wrapperVersion,
      testedVersion: this.#manifest.godotAi.defaultVersion,
      godotMinimum: this.#manifest.godotAi.godotMinimum,
      godotRecommended: this.#manifest.godotAi.godotRecommended,
      uvx,
      backend,
      editor,
      update,
    })
  }
}
