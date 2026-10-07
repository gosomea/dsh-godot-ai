import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { GodotIntegrationCard } from './GodotIntegrationCard.js'
import { GodotPresetOnboarding } from './GodotPresetOnboarding.js'
import { GodotWorkspaceHeader } from './GodotWorkspaceHeader.js'
import { GodotSkillMarketCard } from './GodotSkillMarketCard.js'
import { GodotIntegrationApi, GodotPresetApi, GodotSkillMarketApi } from './api.js'
import { installStyles } from './styles.js'
import { installWorkspaceStyles } from './workspace-styles.js'
import { en, zh, type GodotAiKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-godot-ai': GodotAiKey
  }
}

const NS = 'dsh-godot-ai'

export const name = 'dsh-godot-ai/client'
export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  const api = new GodotPresetApi()
  const integrationApi = new GodotIntegrationApi()
  const skillMarketApi = new GodotSkillMarketApi()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-godot-ai: dictionaries')
  ctx.effect(installStyles, 'dsh-godot-ai: onboarding styles')
  ctx.effect(installWorkspaceStyles, 'dsh-godot-ai: Creator workspace v0 styles')
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'dsh-godot-ai',
    order: 20,
    locale: NS,
  }, props => createElement(GodotPresetOnboarding, { ...props, api })))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'godot-ai',
    order: 40,
    locale: NS,
  }, props => createElement(GodotIntegrationCard, { ...props, api: integrationApi })))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'godot-skill-market',
    order: 42,
    locale: NS,
  }, props => createElement(GodotSkillMarketCard, { ...props, api: skillMarketApi })))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'dsh-godot-ai-workspace',
    order: -5,
    locale: NS,
  }, props => createElement(GodotWorkspaceHeader, { ...props, api: integrationApi })))
}
