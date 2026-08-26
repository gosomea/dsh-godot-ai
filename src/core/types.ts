export const GODOT_PRESET_ID = 'godot-creator'
export const GODOT_ADAPTIVE_PRESET_ID = 'godot-creator-adaptive'
export const SOURCE_PRESET_ID = 'standard'
export const PRESET_API_PREFIX = '/api/dsh-godot-ai/preset'
export const ADAPTIVE_PRESET_API_PREFIX = '/api/dsh-godot-ai/adaptive/preset'
export const ADAPTIVE_ROUTE_API_PREFIX = '/api/dsh-godot-ai/adaptive/route'
export const INTEGRATION_API_PREFIX = '/api/dsh-godot-ai/integration'

export type GodotAdaptiveSelection = 'auto' | 'build' | 'repair'
export type GodotAdaptiveRoute = 'build' | 'repair' | 'classic'
export type GodotAdaptivePhase = 'unclassified' | 'bootstrap' | 'full'
export type GodotAdaptiveSource = 'manual' | 'classifier' | 'model-policy' | 'fallback'
export type GodotModelClass = 'pro' | 'flash' | 'other'

export interface GodotAdaptiveState {
  readonly selection: GodotAdaptiveSelection
  readonly route: GodotAdaptiveRoute
  readonly phase: GodotAdaptivePhase
  readonly source: GodotAdaptiveSource
  readonly reason: string
  readonly classifierVersion: string
  readonly promptVariant: string
  readonly modelClass: GodotModelClass
  readonly updatedAt: string
}

export interface GodotAdaptiveRouteResponse {
  readonly state: GodotAdaptiveState
}

export type ManagedPresetState =
  | { kind: 'not-installed' }
  | { kind: 'current'; wrapperVersion: string; installedWrapperVersion: string; baseHash: string }
  | { kind: 'sync-available'; installedSchema: number; currentSchema: number }
  | { kind: 'base-update-available'; installedBaseHash: string; currentBaseHash: string }
  | { kind: 'user-modified'; reason: string }
  | { kind: 'broken'; reason: string }
  | { kind: 'unavailable'; reason: string }

export type ManagedPresetAction = 'install' | 'sync' | 'rebuild' | 'uninstall'

export interface ManagedPresetResponse {
  readonly state: ManagedPresetState
}

export interface ManagedPresetSidecar {
  readonly schemaVersion: number
  readonly wrapperVersion: string
  readonly sourcePreset: typeof SOURCE_PRESET_ID
  readonly sourceCompositionHash: string
  readonly managedBlockHash: string
  readonly installedCompositionHash: string
  readonly installedAt: string
  readonly updatedAt: string
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
