import {
  INTEGRATION_API_PREFIX,
  PRESET_API_PREFIX,
  type GodotIntegrationResponse,
  type GodotIntegrationSnapshot,
  type ManagedPresetAction,
  type ManagedPresetResponse,
  type ManagedPresetState,
} from '../core/types.js'

async function requestPreset(path: string, init?: RequestInit): Promise<ManagedPresetState> {
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(`${PRESET_API_PREFIX}${path}`, {
    ...init,
    headers,
  })
  const body = await response.json() as Partial<ManagedPresetResponse> & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  if (body.state === undefined) throw new Error('managed preset response has no state')
  return body.state
}

export class GodotPresetApi {
  state(): Promise<ManagedPresetState> {
    return requestPreset('')
  }

  mutate(action: ManagedPresetAction): Promise<ManagedPresetState> {
    return requestPreset(`/${action}`, { method: 'POST', body: '{}' })
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
