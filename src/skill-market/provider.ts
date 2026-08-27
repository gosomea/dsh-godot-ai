import type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillLookupOptions,
  SkillProvider,
} from '@deepseek-ai/dsh-skill'
import { MARKET_SKILL_RANK } from './contracts.js'

export const MARKET_SKILL_PROVIDER_NAME = 'dsh-godot-ai:market'

export interface InstalledMarketSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: SkillInvocationPolicy
  readonly resourceBase?: SkillDefinition['resourceBase']
  readonly path?: string
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly content: string
  readonly enabled: boolean
  readonly artifactHash: string
}

/**
 * Provider seam for enabled market skills. Phase 2 replaces the empty source
 * with an immutable Store snapshot without changing the DSH registry contract.
 */
export class MarketSkillProvider implements SkillProvider {
  readonly name = MARKET_SKILL_PROVIDER_NAME
  private readonly installed: ReadonlyMap<string, InstalledMarketSkill>

  constructor(skills: readonly InstalledMarketSkill[] = []) {
    const installed = new Map<string, InstalledMarketSkill>()
    for (const skill of skills) {
      if (skill.invocation.modelInvocable) {
        throw new Error(`market skill ${skill.name} cannot be model-invocable`)
      }
      if (skill.enabled && !skill.invocation.userInvocable) {
        throw new Error(`enabled market skill ${skill.name} must be user-invocable`)
      }
      if (!/^[a-f0-9]{64}$/.test(skill.artifactHash)) {
        throw new Error(`market skill ${skill.name} requires a SHA-256 artifact hash`)
      }
      if (installed.has(skill.name)) throw new Error(`duplicate market skill ${skill.name}`)
      installed.set(skill.name, skill)
    }
    this.installed = installed
  }

  async list(_options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
    return [...this.installed.values()].filter(skill => skill.enabled).map(skill => ({
      name: skill.name,
      description: skill.description,
      ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
      invocation: skill.invocation,
      source: 'dsh-godot-ai-market',
      provider: this.name,
      ...skill.resourceBase === undefined ? {} : { resourceBase: skill.resourceBase },
      rank: MARKET_SKILL_RANK,
      locator: { name: skill.name, artifactHash: skill.artifactHash },
      ...skill.path === undefined ? {} : { path: skill.path },
      ...skill.metadata === undefined ? {} : { metadata: skill.metadata },
    }))
  }

  async get(candidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    if (candidate.provider !== this.name || !isMarketLocator(candidate.locator)) return undefined
    const skill = this.installed.get(candidate.locator.name)
    if (skill === undefined || !skill.enabled || skill.artifactHash !== candidate.locator.artifactHash) return undefined
    return {
      name: skill.name,
      description: skill.description,
      ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
      invocation: skill.invocation,
      source: 'dsh-godot-ai-market',
      provider: this.name,
      ...skill.resourceBase === undefined ? {} : { resourceBase: skill.resourceBase },
      ...skill.path === undefined ? {} : { path: skill.path },
      ...skill.metadata === undefined ? {} : { metadata: skill.metadata },
      content: skill.content,
    }
  }
}

function isMarketLocator(value: unknown): value is { name: string; artifactHash: string } {
  if (typeof value !== 'object' || value === null) return false
  const locator = value as Record<string, unknown>
  return typeof locator.name === 'string' && typeof locator.artifactHash === 'string'
}
