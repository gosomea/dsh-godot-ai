import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  ADAPTIVE_ROUTE_API_PREFIX,
  GODOT_ADAPTIVE_PRESET_ID,
  INTEGRATION_API_PREFIX,
  PRESET_API_PREFIX,
  type GodotIntegrationResponse,
  type GodotAdaptiveRouteResponse,
  type GodotAdaptiveSelection,
  type ManagedPresetAction,
  type ManagedPresetResponse,
} from '../core/types.js'
import { appendAdaptiveSelection, currentAdaptiveState, foldAdaptiveSession } from '../agent/adaptive-runtime.js'
import { GodotIntegrationManager } from './integration-manager.js'
import { ManagedPresetManager } from './preset-manager.js'
import { assertJsonRequest, assertTrustedRequest } from './request-trust.js'

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function route(
  method: 'GET' | 'POST',
  handler: () => Promise<unknown>,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      assertTrustedRequest(req)
      if (req.method !== method) { sendJson(res, 405, { error: 'method not allowed' }); return }
      if (method === 'POST') assertJsonRequest(req)
      sendJson(res, 200, await handler())
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

async function readJson(req: IncomingMessage, maxBytes = 4096): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    bytes += buffer.byteLength
    if (bytes > maxBytes) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function adaptiveAgent(agents: AgentRegistry, rawId: string) {
  const agent = agents.get(SessionId(rawId))
  if (agent === undefined) throw new Error(`session "${rawId}" is not active`)
  if (resolveSessionPreset(agent.session) !== GODOT_ADAPTIVE_PRESET_ID) {
    throw new Error(`session "${rawId}" does not use ${GODOT_ADAPTIVE_PRESET_ID}`)
  }
  return agent
}

function adaptiveSessionId(req: IncomingMessage): string {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const prefix = `${ADAPTIVE_ROUTE_API_PREFIX}/`
  if (!pathname.startsWith(prefix)) throw new Error('adaptive route requires a session id')
  const encoded = pathname.slice(prefix.length)
  if (encoded === '' || encoded.includes('/')) throw new Error('adaptive route has an invalid session id')
  return decodeURIComponent(encoded)
}

export function registerAdaptiveRoute(webServer: WebServer, agents: AgentRegistry): () => void {
  return webServer.register({
    kind: 'prefix',
    path: ADAPTIVE_ROUTE_API_PREFIX,
    handler: async (req, res) => {
      try {
        assertTrustedRequest(req)
        if (req.method !== 'GET' && req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        const agent = adaptiveAgent(agents, adaptiveSessionId(req))
        if (req.method === 'POST') {
          assertJsonRequest(req)
          if (agent.status !== 'idle' || foldAdaptiveSession(agent.session.events).state !== undefined
            || agent.session.events.some(event => event.type === 'user/message')) {
            throw new Error('adaptive selection can only change before the first message')
          }
          const body = await readJson(req) as { selection?: unknown }
          if (!['auto', 'build', 'repair'].includes(body.selection as string)) {
            throw new Error('selection must be auto, build, or repair')
          }
          appendAdaptiveSelection(agent, body.selection as GodotAdaptiveSelection)
        }
        const response: GodotAdaptiveRouteResponse = { state: currentAdaptiveState(agent) }
        sendJson(res, 200, response)
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}

export function registerPresetRoutes(webServer: WebServer, manager: ManagedPresetManager): () => void {
  return registerManagedPresetRoutes(webServer, manager, PRESET_API_PREFIX)
}

export function registerManagedPresetRoutes(
  webServer: WebServer,
  manager: ManagedPresetManager,
  apiPrefix: string,
): () => void {
  const actions: Record<ManagedPresetAction, () => Promise<ManagedPresetResponse>> = {
    install: async () => ({ state: await manager.install() }),
    sync: async () => ({ state: await manager.sync() }),
    rebuild: async () => ({ state: await manager.rebuild() }),
    uninstall: async () => ({ state: await manager.uninstall() }),
  }
  const disposers = [
    webServer.register({
      kind: 'exact',
      path: apiPrefix,
      handler: route('GET', async () => ({ state: await manager.state() })),
    }),
    ...Object.entries(actions).map(([action, handler]) => webServer.register({
      kind: 'exact' as const,
      path: `${apiPrefix}/${action}`,
      handler: route('POST', handler),
    })),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

export function registerIntegrationRoutes(webServer: WebServer, manager: GodotIntegrationManager): () => void {
  const get = async (): Promise<GodotIntegrationResponse> => ({ integration: await manager.snapshot() })
  const refresh = async (): Promise<GodotIntegrationResponse> => ({ integration: await manager.snapshot(true) })
  const disposers = [
    webServer.register({ kind: 'exact', path: INTEGRATION_API_PREFIX, handler: route('GET', get) }),
    webServer.register({ kind: 'exact', path: `${INTEGRATION_API_PREFIX}/refresh`, handler: route('POST', refresh) }),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
