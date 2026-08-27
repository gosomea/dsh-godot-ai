import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { ADAPTIVE_PRESET_API_PREFIX, GODOT_ADAPTIVE_PRESET_ID } from './core/types.js'
import { loadCompatibilityManifest } from './core/compatibility.js'
import { GodotIntegrationManager } from './host/integration-manager.js'
import { ManagedPresetManager } from './host/preset-manager.js'
import { registerAdaptiveRoute, registerIntegrationRoutes, registerManagedPresetRoutes, registerPresetRoutes } from './host/routes.js'
import { registerSkillMarketRoutes } from './host/skill-market-routes.js'
import { createPackagedSkillMarketService } from './skill-market/bootstrap.js'

export * from './core/types.js'
export * from './core/compatibility.js'
export { GodotIntegrationManager, type IntegrationProbeDependencies } from './host/integration-manager.js'
export { ManagedPresetManager, type ManagedPresetManagerOptions, type PresetRoster } from './host/preset-manager.js'
export * from './skill-market/approval.js'
export * from './skill-market/catalog.js'
export * from './skill-market/catalog-fetch.js'
export * from './skill-market/bootstrap.js'
export * from './skill-market/canonical-json.js'
export * from './skill-market/contracts.js'
export * from './skill-market/diff.js'
export * from './skill-market/github-import.js'
export * from './skill-market/service.js'
export * from './skill-market/preparation.js'
export * from './skill-market/scanner.js'

export const name = 'dsh-godot-ai'
export const inject = ['agents', 'agentPresets', 'webServer']

async function packageVersion(): Promise<string> {
  const path = fileURLToPath(new URL('../package.json', import.meta.url))
  const manifest = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('dsh-godot-ai package.json has no string version')
  return manifest.version
}

export async function apply(ctx: Context): Promise<void> {
  const wrapperVersion = await packageVersion()
  const compatibility = await loadCompatibilityManifest()
  if (compatibility.wrapperVersion !== wrapperVersion) {
    throw new Error(`compatibility wrapper version ${compatibility.wrapperVersion} does not match package ${wrapperVersion}`)
  }
  const managedBlock = await readFile(fileURLToPath(new URL('../templates/godot-creator-managed-row.yml', import.meta.url)), 'utf8')
  const adaptiveManagedBlock = await readFile(
    fileURLToPath(new URL('../templates/godot-creator-adaptive-managed-row.yml', import.meta.url)),
    'utf8',
  )
  const manager = new ManagedPresetManager({
    roster: ctx.agentPresets,
    wrapperVersion,
    schemaVersion: 1,
    managedBlock,
  })
  const adaptiveManager = new ManagedPresetManager({
    roster: ctx.agentPresets,
    wrapperVersion,
    schemaVersion: 1,
    managedBlock: adaptiveManagedBlock,
    presetId: GODOT_ADAPTIVE_PRESET_ID,
    displayName: 'Godot Creator Adaptive',
  })
  const integration = new GodotIntegrationManager(compatibility, wrapperVersion)
  const skillMarket = await createPackagedSkillMarketService()
  ctx.effect(() => {
    const disposers = [
      registerPresetRoutes(ctx.webServer, manager),
      registerManagedPresetRoutes(ctx.webServer, adaptiveManager, ADAPTIVE_PRESET_API_PREFIX),
      registerAdaptiveRoute(ctx.webServer, ctx.agents),
      registerIntegrationRoutes(ctx.webServer, integration),
      registerSkillMarketRoutes(ctx.webServer, skillMarket),
    ]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'dsh-godot-ai: local management routes')
}
