import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import {
  INTEGRATION_API_PREFIX,
  PRESET_API_PREFIX,
  type GodotIntegrationResponse,
  type ManagedPresetAction,
  type ManagedPresetResponse,
} from '../core/types.js'
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

export function registerPresetRoutes(webServer: WebServer, manager: ManagedPresetManager): () => void {
  const actions: Record<ManagedPresetAction, () => Promise<ManagedPresetResponse>> = {
    install: async () => ({ state: await manager.install() }),
    sync: async () => ({ state: await manager.sync() }),
    rebuild: async () => ({ state: await manager.rebuild() }),
    uninstall: async () => ({ state: await manager.uninstall() }),
  }
  const disposers = [
    webServer.register({
      kind: 'exact',
      path: PRESET_API_PREFIX,
      handler: route('GET', async () => ({ state: await manager.state() })),
    }),
    ...Object.entries(actions).map(([action, handler]) => webServer.register({
      kind: 'exact' as const,
      path: `${PRESET_API_PREFIX}/${action}`,
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
