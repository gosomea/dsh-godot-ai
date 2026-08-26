import {
  ADAPTIVE_PRESET_API_PREFIX,
  ADAPTIVE_ROUTE_API_PREFIX,
  INTEGRATION_API_PREFIX,
  PRESET_API_PREFIX,
  type GodotAdaptiveRouteResponse,
  type GodotAdaptiveSelection,
  type GodotAdaptiveState,
  type GodotIntegrationResponse,
  type GodotIntegrationSnapshot,
  type ManagedPresetAction,
  type ManagedPresetResponse,
  type ManagedPresetState,
} from '../core/types.js'

async function requestPreset(apiPrefix: string, path: string, init?: RequestInit): Promise<ManagedPresetState> {
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(`${apiPrefix}${path}`, {
    ...init,
    headers,
  })
  const body = await response.json() as Partial<ManagedPresetResponse> & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  if (body.state === undefined) throw new Error('managed preset response has no state')
  return body.state
}

export class GodotPresetApi {
  constructor(private readonly apiPrefix = PRESET_API_PREFIX) {}

  state(): Promise<ManagedPresetState> {
    return requestPreset(this.apiPrefix, '')
  }

  mutate(action: ManagedPresetAction): Promise<ManagedPresetState> {
    return requestPreset(this.apiPrefix, `/${action}`, { method: 'POST', body: '{}' })
  }
}

export class GodotAdaptivePresetApi extends GodotPresetApi {
  constructor() { super(ADAPTIVE_PRESET_API_PREFIX) }
}

export class GodotAdaptiveRouteApi {
  async state(sessionId: string): Promise<GodotAdaptiveState> {
    return this.request(sessionId)
  }

  async select(sessionId: string, selection: GodotAdaptiveSelection): Promise<GodotAdaptiveState> {
    return this.request(sessionId, selection)
  }

  private async request(sessionId: string, selection?: GodotAdaptiveSelection): Promise<GodotAdaptiveState> {
    const init: RequestInit | undefined = selection === undefined ? undefined : {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selection }),
    }
    const response = await fetch(`${ADAPTIVE_ROUTE_API_PREFIX}/${encodeURIComponent(sessionId)}`, init)
    const body = await response.json() as Partial<GodotAdaptiveRouteResponse> & { error?: string }
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    if (body.state === undefined) throw new Error('adaptive route response has no state')
    return body.state
  }
}

async function requestIntegration(path: string, init?: RequestInit): Promise<GodotIntegrationSnapshot> {
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(`${INTEGRATION_API_PREFIX}${path}`, { ...init, headers })
  const body = await response.json() as Partial<GodotIntegrationResponse> & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  if (body.integration === undefined) throw new Error('integration response has no snapshot')
  return body.integration
}

export class GodotIntegrationApi {
  state(): Promise<GodotIntegrationSnapshot> {
    return requestIntegration('')
  }

  refresh(): Promise<GodotIntegrationSnapshot> {
    return requestIntegration('/refresh', { method: 'POST', body: '{}' })
  }
}
