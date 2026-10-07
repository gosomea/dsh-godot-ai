/** Test-only read-only bridge. Not published in the npm package. */
export const inject = ['webServer', 'agents', 'agentPresets', 'sessionController', 'workspaceRegistry', 'tools', 'systemPrompt', 'skills']
export function apply(ctx) {
  ctx.webServer.register({
    kind: 'exact', path: '/__dga-smoke',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        let raw = ''
        for await (const chunk of req) {
          raw += chunk
          if (raw.length > 4096) throw new Error('body too large')
        }
        const { workspace } = JSON.parse(raw)
        if (typeof workspace !== 'string' || !workspace.startsWith('/')) throw new Error('absolute fixture required')
        const roster = await ctx.agentPresets.list()
        const fixture = await ctx.workspaceRegistry.create(workspace, 'Godot Creator 验证')
        const godot = await ctx.sessionController.create({ workspaceId: fixture.id, agentPreset: 'godot-creator' })
        const ordinary = await ctx.sessionController.create({ workspaceId: fixture.id, agentPreset: 'standard' })
        const agent = ctx.agents.get(godot.sessionId)
        const standard = ctx.agents.get(ordinary.sessionId)
        if (agent === undefined || standard === undefined) throw new Error('session not live')
        const assembly = await ctx.systemPrompt.assemble({ scope: agent })
        const sdk = assembly.sections.find(section => section.name === 'tools:sdk')?.text ?? ''
        const godotNames = [...new Set([...sdk.matchAll(/mcp__godot-ai__[a-z0-9_]+/g)].map(match => match[0]))]
        const skills = await ctx.skills.list({ scope: agent, cwd: workspace })
        const overridden = await ctx.skills.get('godot-audio', { scope: agent, cwd: workspace })
        const result = await ctx.tools.execute({
          agent, signal: AbortSignal.timeout(30000), callId: 'godot-rc2-ptc-probe',
          name: 'run_code', arguments: {
            code: 'return await tools["mcp__godot-ai__session_manage"]({ op: "list" })',
            description: 'Read-only Godot session list',
          },
        })
        const normal = await ctx.systemPrompt.assemble({ scope: standard })
        const report = {
          roster, sessionId: godot.sessionId, ordinarySessionId: ordinary.sessionId,
          cwd: agent.session.header.cwd, agentPreset: ctx.agentPresets.composedPreset(agent.ctx),
          directTools: assembly.tools.map(tool => tool.name), godotNames,
          creatorPersona: assembly.sections.some(section => section.name === 'godot-ai:creator-mode'),
          godotSkills: skills.filter(skill => skill.name.startsWith('godot-')).map(skill => skill.name),
          projectSkillOverride: overridden?.content.includes('RC2_PROJECT_OVERRIDE') === true,
          standardUnaffected: !JSON.stringify(normal).includes('mcp__godot-ai__')
            && normal.tools.some(tool => tool.name !== 'run_code'),
          ptc: { success: !result.isError, error: result.isError ? result.error : undefined,
            hasSessionList: !result.isError && JSON.stringify(result.value).includes('sessions') },
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(report))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(error) }))
      }
    },
  })
}
