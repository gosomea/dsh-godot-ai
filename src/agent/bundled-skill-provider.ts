import { dirname } from 'node:path'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillLookupOptions,
  type SkillProvider,
  type SkillRegistration,
} from '@deepseek-ai/dsh-skill'

export const BUNDLED_GODOT_SKILL_PROVIDER_NAME = 'dsh-godot-ai:bundled'

const invocation = Object.freeze({ modelInvocable: true, userInvocable: true })

/** Immutable provider for the 16 Godot skills shipped in the npm package. */
export class BundledGodotSkillProvider implements SkillProvider {
  readonly name = BUNDLED_GODOT_SKILL_PROVIDER_NAME
  private readonly definitions: ReadonlyMap<string, SkillDefinition>

  constructor(skills: readonly SkillRegistration[]) {
    const definitions = new Map<string, SkillDefinition>()
    for (const skill of skills) {
      if (definitions.has(skill.name)) throw new Error(`duplicate bundled Godot skill ${skill.name}`)
      const resourceBase = skill.resourceBase
        ?? (skill.path === undefined ? undefined : { kind: 'directory' as const, path: dirname(skill.path) })
      definitions.set(skill.name, {
        ...skill,
        invocation: skill.invocation ?? invocation,
        source: 'bundled',
        provider: this.name,
        ...resourceBase === undefined ? {} : { resourceBase },
      })
    }
    this.definitions = definitions
  }

  async list(_options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
    return [...this.definitions.values()].map(skill => ({
      name: skill.name,
      description: skill.description,
      ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
      invocation: skill.invocation,
      source: skill.source,
      provider: this.name,
      ...skill.resourceBase === undefined ? {} : { resourceBase: skill.resourceBase },
      rank: BUNDLED_SKILL_RANK,
      locator: skill.name,
      ...skill.path === undefined ? {} : { path: skill.path },
      ...skill.metadata === undefined ? {} : { metadata: skill.metadata },
    }))
  }

  async get(candidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    if (candidate.provider !== this.name || typeof candidate.locator !== 'string') return undefined
    return this.definitions.get(candidate.locator)
  }
}
