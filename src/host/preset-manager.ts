import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import { GODOT_PRESET_ID, type ManagedPresetState } from '../core/types.js'

/** Read-only status: the bundle owns the declaration; no user files are copied or removed. */
export class GodotPresetManager {
  constructor(
    private readonly registry: Pick<AgentPresetRegistry, 'resolve'>,
    private readonly wrapperVersion: string,
  ) {}

  async state(): Promise<ManagedPresetState> {
    try {
      const preset = await this.registry.resolve(GODOT_PRESET_ID)
      if (preset.broken !== undefined) return { kind: 'broken', reason: preset.broken }
      return { kind: 'current', wrapperVersion: this.wrapperVersion, installedSchema: 2 }
    } catch (error) {
      return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) }
    }
  }
}
