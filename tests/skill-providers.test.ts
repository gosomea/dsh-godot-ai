import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillLookupOptions,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'
import { describe, expect, it } from 'vitest'
import {
  BUNDLED_GODOT_SKILL_PROVIDER_NAME,
  BundledGodotSkillProvider,
} from '../src/agent/bundled-skill-provider.js'
import { loadBundledGodotSkills } from '../src/agent/skills.js'
import { MARKET_SKILL_RANK } from '../src/skill-market/contracts.js'
import { MARKET_SKILL_PROVIDER_NAME, MarketSkillProvider } from '../src/skill-market/provider.js'

function rankedProvider(name: string, entries: ReadonlyArray<{ skill: string; rank: number; content: string }>): SkillProvider {
  return {
    name,
    async list(_options: SkillLookupOptions): Promise<SkillCandidate[]> {
      return entries.map(entry => ({
        name: entry.skill,
        description: `${name} ${entry.skill}`,
        invocation: { modelInvocable: true, userInvocable: true },
        source: name,
        provider: name,
        rank: entry.rank,
        locator: entry,
      }))
    },
    async get(candidate: SkillCandidate): Promise<SkillDefinition> {
      const locator = candidate.locator as { content: string }
      return { ...candidate, content: locator.content }
    },
  }
}

function marketSkill(name: string, content: string) {
  return {
    name,
    description: `${name} description`,
    invocation: { modelInvocable: false, userInvocable: true },
    content,
    enabled: true,
    artifactHash: 'a'.repeat(64),
  } as const
}

describe('dsh-godot-ai skill providers', () => {
  it('publishes the 16 npm skills through the standard bundled rank', async () => {
    const provider = new BundledGodotSkillProvider(await loadBundledGodotSkills())
    const candidates = await provider.list({})

    expect(provider.name).toBe(BUNDLED_GODOT_SKILL_PROVIDER_NAME)
    expect(candidates).toHaveLength(16)
    expect(candidates.every(candidate => candidate.rank === BUNDLED_SKILL_RANK)).toBe(true)
    expect(candidates.every(candidate => candidate.provider === provider.name)).toBe(true)
    expect(candidates.every(candidate => candidate.invocation.modelInvocable && candidate.invocation.userInvocable)).toBe(true)
    expect((await provider.get(candidates[0]!, {}))?.content.length).toBeGreaterThan(300)
  })

  it('keeps market skills user-only, hides disabled records, and rejects model invocation', async () => {
    const enabled = marketSkill('enabled-market-skill', 'enabled body')
    const disabled = { ...marketSkill('disabled-market-skill', 'disabled body'), enabled: false }
    const provider = new MarketSkillProvider([enabled, disabled])
    const candidates = await provider.list({})

    expect(provider.name).toBe(MARKET_SKILL_PROVIDER_NAME)
    expect(candidates.map(candidate => candidate.name)).toEqual(['enabled-market-skill'])
    expect(candidates[0]).toMatchObject({
      rank: MARKET_SKILL_RANK,
      invocation: { modelInvocable: false, userInvocable: true },
    })
    expect((await provider.get(candidates[0]!, {}))?.content).toBe('enabled body')
    expect(() => new MarketSkillProvider([{ ...enabled, invocation: { modelInvocable: true, userInvocable: true } }]))
      .toThrow(/cannot be model-invocable/)
  })

  it('fixes precedence: custom beats market, market beats user, and user beats bundled fallback', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const bundledSkills = await loadBundledGodotSkills()
    ctx.skills.registerProvider(() => new BundledGodotSkillProvider(bundledSkills))
    ctx.skills.registerProvider(() => new MarketSkillProvider([
      marketSkill('market-over-user', 'market body'),
      marketSkill('custom-over-market', 'market body'),
    ]))
    ctx.skills.registerProvider(() => rankedProvider('user-provider', [
      { skill: 'godot-audio', rank: 400, content: 'user body' },
      { skill: 'market-over-user', rank: 400, content: 'user body' },
    ]))
    ctx.skills.registerProvider(() => rankedProvider('custom-provider', [
      { skill: 'custom-over-market', rank: 300, content: 'custom body' },
    ]))

    expect((await ctx.skills.get('godot-audio'))?.provider).toBe('user-provider')
    expect((await ctx.skills.get('market-over-user'))?.provider).toBe(MARKET_SKILL_PROVIDER_NAME)
    expect((await ctx.skills.get('custom-over-market'))?.provider).toBe('custom-provider')
  })
})
