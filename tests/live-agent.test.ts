import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import { createScope } from '@deepseek-ai/dsh-scope'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { RUN_CODE_NAME, defineTool } from '@deepseek-ai/dsh-tools'
import { afterAll, describe, expect, it } from 'vitest'
import * as GodotAgent from '../src/agent/index.js'

const live = process.env.npm_lifecycle_event === 'test:live' || process.env.DSH_GODOT_AI_LIVE === '1'
let liveRuntime: NoopCodeRuntime

class NoopCodeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'live-contract-test'
  behavior: (request: CodeRunRequest) => Promise<CodeRunResult> = () => Promise.resolve({ logs: [] })

  constructor(ctx: Context) {
    super(ctx)
    liveRuntime = this
  }

  run(request: CodeRunRequest): Promise<CodeRunResult> {
    return this.behavior(request)
  }
}

describe.skipIf(!live)('live Godot Creator / DSH integration', () => {
  const ctx = new Context()
  const agent = {
    id: 'godot-creator-live',
    session: {
      header: { cwd: process.cwd() },
      append: (_type: string, _data: unknown): void => {},
    },
  }
  let scope: ReturnType<typeof createScope> | undefined
  let scopeFiber: Fiber | undefined
  let agentFiber: Fiber | undefined

  afterAll(async () => {
    await agentFiber?.dispose()
    await scope?.dispose()
    await scopeFiber?.dispose()
  })

  it('discovers all pinned Godot tools and exposes them only through the Code Mode SDK', async () => {
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(NoopCodeRuntime)
    ctx.tools.register(defineTool({
      name: 'workspace_read',
      description: 'Representative standard read tool.',
      parameters: { path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: args => Promise.resolve(args.path),
    }))
    scopeFiber = ctx.plugin(Object.assign((host: Context) => {
      scope = createScope(host, agent)
    }, { inject: ['skills', 'tools', 'systemPrompt'] }))
    await scopeFiber.await()
    agentFiber = scope!.ctx.plugin(GodotAgent)
    await agentFiber.await()

    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    const sdk = assembly.sections.find(section => section.name === 'tools:sdk')?.text ?? ''
    const godotSdkNames = [...sdk.matchAll(/mcp__godot-ai__([a-z0-9_]+)"?:/g)].map(match => match[1])

    expect(assembly.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
    expect(new Set(godotSdkNames).size).toBe(45)
    expect(godotSdkNames).toContain('session_manage')
    expect(godotSdkNames).toContain('scene_get_hierarchy')
    expect(godotSdkNames).toContain('project_run')
    expect(godotSdkNames).toContain('batch_execute')
    expect(sdk).toContain('workspace_read:')
    expect(sdk).not.toContain(`${RUN_CODE_NAME}:`)
    expect(assembly.sections.find(section => section.name === 'godot-ai:creator-mode')?.text)
      .toContain('Godot Creator')

    const skills = await ctx.skills.list({ scope: agent, cwd: process.cwd() })
    expect(skills).toHaveLength(16)
    expect(skills.map(skill => skill.name)).toContain('godot-ai-orchestration')
    expect((await ctx.skills.get('godot-ai-orchestration', { scope: agent, cwd: process.cwd() }))?.content)
      .toContain('45 个工具')

    const nativeAssembly = await ctx.systemPrompt.assemble()
    expect(nativeAssembly.tools.map(tool => tool.name)).toEqual(['workspace_read'])
    expect(nativeAssembly.sections.some(section => section.name === 'tools:sdk')).toBe(false)
    expect(JSON.stringify(nativeAssembly)).not.toContain('mcp__godot-ai__')

    liveRuntime.behavior = async (request) => ({
      logs: [],
      value: await request.bindings[0]!.functions['mcp__godot-ai__session_manage']!({ op: 'list' }),
    })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'godot-live-call' as never,
      name: RUN_CODE_NAME,
      arguments: { code: 'return await tools["mcp__godot-ai__session_manage"]({ op: "list" })', description: 'List sessions read-only' },
      agent,
    })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.value)).toContain('sessions')
  }, 120_000)
})
