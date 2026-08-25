import type { Context } from '@deepseek-ai/cordis'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import { loadCompatibilityManifest } from '../core/compatibility.js'
import { createGodotMcpConfig } from './launch-spec.js'
import { renderGodotCreatorPersona } from './persona.js'
import { loadBundledGodotSkills } from './skills.js'
import { loadWorkflowCatalog } from './workflows.js'

export const name = 'dsh-godot-ai/agent'
export const inject = ['skills', 'systemPrompt', 'tools']

/** Mount the tested Godot AI tool surface inside the Godot Creator preset only. */
export async function apply(ctx: Context): Promise<void> {
  const [manifest, workflows, skills] = await Promise.all([
    loadCompatibilityManifest(),
    loadWorkflowCatalog(),
    loadBundledGodotSkills(),
  ])
  for (const skill of skills) ctx.skills.register(skill)
  ctx.tools.presentAs('code')
  ctx.systemPrompt.section({
    name: 'godot-ai:creator-mode',
    order: 10,
    text: renderGodotCreatorPersona(manifest, workflows),
  })
  await McpClient.apply(ctx, createGodotMcpConfig(manifest))
}
