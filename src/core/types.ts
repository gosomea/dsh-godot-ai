export const GODOT_PRESET_ID = 'godot-creator'
export const PRESET_API_PREFIX = '/api/dsh-godot-ai/preset'
export const INTEGRATION_API_PREFIX = '/api/dsh-godot-ai/integration'
export const SKILL_MARKET_API_PREFIX = '/api/dsh-godot-ai/skills'

/** The bundle declares one preset; changing its composition requires updating the plugin/profile patch. */
export type ManagedPresetState =
  | { kind: 'current'; wrapperVersion: string; installedSchema: number }
  | { kind: 'broken'; reason: string }
  | { kind: 'unavailable'; reason: string }

export interface ManagedPresetResponse {
  readonly state: ManagedPresetState
}

export type UvxState =
  | { kind: 'available'; version: string }
  | { kind: 'missing' }
  | { kind: 'error'; reason: string }

export interface BackendDetails {
  readonly serverVersion: string
  readonly attachProtocolVersion: number
  readonly wsPort: number
  readonly excludeDomains: readonly string[]
  readonly ownerType: string
  readonly toolCatalogHash: string
  readonly activeLeaseCount: number
}

export type BackendState =
  | { kind: 'stopped' }
  | { kind: 'ready'; details: BackendDetails }
  | { kind: 'incompatible'; reason: string; details?: BackendDetails }
  | { kind: 'foreign-listener'; reason: string }
  | { kind: 'error'; reason: string }

export interface GodotEditorSession {
  readonly sessionId: string
  readonly name: string
  readonly godotVersion: string
  readonly projectPath: string
  readonly pluginVersion: string
  readonly currentScene: string
  readonly playState: string
  readonly readiness: string
  readonly isActive: boolean
}

export type EditorState =
  | { kind: 'not-connected' }
  | { kind: 'connected'; sessions: readonly GodotEditorSession[] }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'unknown'; reason: string }

export type GodotAiUpdateState =
  | { kind: 'current'; latestVersion: string }
  | { kind: 'verified-update'; latestVersion: string }
  | { kind: 'unverified-update'; latestVersion: string }
  | { kind: 'unavailable'; reason: string }

export interface GodotIntegrationSnapshot {
  readonly checkedAt: string
  readonly wrapperVersion: string
  readonly testedVersion: string
  readonly godotMinimum: string
  readonly godotRecommended: string
  readonly uvx: UvxState
  readonly backend: BackendState
  readonly editor: EditorState
  readonly update: GodotAiUpdateState
}

export interface GodotIntegrationResponse {
  readonly integration: GodotIntegrationSnapshot
}
