#!/usr/bin/env node

/**
 * Focused live check for dsh-godot-ai's own value. This intentionally asks for
 * read-only orientation instead of creating a game, so the report measures the
 * wrapper's adaptive route, bootstrap surface, continuation and event trace.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const baseUrl = process.env.DSH_EVAL_URL ?? 'http://127.0.0.1:3081'
const outputPath = process.env.DSH_CAPABILITY_REPORT
  ?? '/Users/yuqixian/forever-skills/projects/deepseek-harness-plugins/dsh-godot-ai/validation/plugin-capability-report.json'
const model = process.env.DSH_CAPABILITY_MODEL ?? 'deepseek-v4-flash-ioa'
const timeoutMs = Number(process.env.DSH_CAPABILITY_TIMEOUT_MS ?? 180_000)
const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const expectedWrapperVersion = packageManifest.version
if (typeof expectedWrapperVersion !== 'string') throw new Error('package.json has no string version')

async function rpc(method, payload) {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `capability-${Date.now()}-${Math.random()}`, method, payload }),
  })
  const body = await response.json()
  if (!response.ok || body?.result?.ok !== true) {
    throw new Error(`${method}: ${body?.result?.error?.message ?? JSON.stringify(body)}`)
  }
  return body.result.value
}

async function waitForIdle(sessionId) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const sessions = await rpc('session.list', {})
    const session = sessions.items.find(item => item.sessionId === sessionId)
    if (session === undefined) throw new Error(`session ${sessionId} disappeared`)
    if (!session.running) return { timedOut: false, session }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return { timedOut: true }
}

function latestSeq(history) {
  return Math.max(-1, ...eventsFrom(history).map(event => Number.isFinite(event.seq) ? event.seq : -1))
}

async function waitForTurnEnd(sessionId, afterSeq) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const history = await rpc('session.history', { sessionId, maxMessages: 160 })
    const ended = eventsFrom(history).some(event =>
      event.seq > afterSeq && event.type === 'turn/end' && event.data?.reason?.kind === 'completed')
    if (ended) return history
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`session ${sessionId} timed out waiting for a second completed turn`)
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`)
  const body = await response.json()
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(body)}`)
  return body
}

function eventsFrom(history) {
  return (history.items ?? history.events ?? []).map(item => item.event ?? item)
}

function dispatches(events) {
  return events.filter(event => event.type === 'tool/code-dispatch').map(event => event.data ?? {})
}

function assistantToolCalls(events) {
  return events
    .filter(event => event.type === 'assistant/message')
    .flatMap(event => event.data?.message?.content ?? [])
    .filter(block => block.type === 'tool-call')
}

function routeEvents(events) {
  return events.filter(event => event.type === 'godot-ai/adaptive-route').map(event => event.data)
}

const readOnlyPrompt = '只做一次只读的 Godot 编辑器连接检查：读取当前 editor 状态和会话列表，不要创建、修改、运行或保存任何文件。检查完成后直接报告读取到的事实，不要重复调用。'

function commonTrace(events) {
  const tools = dispatches(events)
  const toolCalls = assistantToolCalls(events)
  return {
    tools,
    toolCalls,
    routes: routeEvents(events),
  }
}

async function runClassic() {
  const sessionId = `capability-classic-${Date.now()}`
  const created = await rpc('session.create', {
    cwd: '/Users/yuqixian/forever-skills/projects/godot-test-project',
    sessionId,
    agentPreset: 'godot-creator',
  })
  const selected = await rpc('session.selectModel', { sessionId, provider: 'deepseek-official', model, reasoningEffort: 'max' })
  const skillCatalog = await rpc('skill.list', { sessionId })
  const godotSkills = (skillCatalog.skills ?? []).filter(skill => skill.name?.startsWith('godot-'))
  await rpc('session.prompt', {
    sessionId,
    mode: 'queue',
    clientTimeZone: 'Asia/Shanghai',
    content: [{ type: 'text', text: readOnlyPrompt }],
  })
  const waited = await waitForIdle(sessionId)
  const history = await rpc('session.history', { sessionId, maxMessages: 120 })
  const events = eventsFrom(history)
  const trace = commonTrace(events)
  return {
    sessionId,
    agentPreset: created.agentPreset,
    selected: selected.selected,
    godotSkills: godotSkills.map(skill => skill.name),
    timedOut: waited.timedOut,
    routes: trace.routes,
    assistantToolCalls: trace.toolCalls.map(block => ({ name: block.name, id: block.id })),
    dispatches: trace.tools.map(item => ({ name: item.name, isError: item.isError })),
    checks: {
      classicPresetSelected: created.agentPreset === 'godot-creator',
      classicGodotToolsMounted: trace.tools.some(item => item.name?.startsWith('mcp__godot-ai__')),
      godotSkillCatalogComplete: godotSkills.length === 16 && godotSkills.every(skill => skill.modelInvocable === true),
      noAdaptiveRouteEvents: trace.routes.length === 0,
      noWriteTools: !trace.tools.some(item => /(?:write|create|patch|save|run)/i.test(item.name ?? '') && !item.name?.includes('run_code')),
      completedTurn: events.some(event => event.type === 'turn/end' && event.data?.reason?.kind === 'completed'),
      noEmptyToolNames: trace.toolCalls.every(block => typeof block.name === 'string' && block.name.length > 0),
    },
  }
}

async function runAdaptive({ selection: requestedSelection, prompt = readOnlyPrompt } = { selection: 'build' }) {
  const sessionId = `capability-adaptive-${Date.now()}`
  await rpc('session.create', {
    cwd: '/Users/yuqixian/forever-skills/projects/godot-test-project',
    sessionId,
    agentPreset: 'godot-creator-adaptive',
  })
  await rpc('session.selectModel', { sessionId, provider: 'deepseek-official', model, reasoningEffort: 'max' })
  const skillCatalog = await rpc('skill.list', { sessionId })
  const godotSkills = (skillCatalog.skills ?? []).filter(skill => skill.name?.startsWith('godot-'))
  const selection = await fetch(`${baseUrl}/api/dsh-godot-ai/adaptive/route/${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ selection: requestedSelection }),
  }).then(async response => {
    const body = await response.json()
    if (!response.ok) throw new Error(`adaptive selection: ${JSON.stringify(body)}`)
    return body.state
  })
  await rpc('session.prompt', {
    sessionId,
    mode: 'queue',
    clientTimeZone: 'Asia/Shanghai',
    content: [{ type: 'text', text: prompt }],
  })
  const waited = await waitForIdle(sessionId)
  const firstHistory = await rpc('session.history', { sessionId, maxMessages: 120 })
  const firstSeq = latestSeq(firstHistory)
  await rpc('session.prompt', {
    sessionId,
    mode: 'queue',
    clientTimeZone: 'Asia/Shanghai',
    content: [{ type: 'text', text: '继续做一次只读检查：读取当前打开场景的层级摘要，只调用一次合适的 Godot 读取工具，不要创建、修改、运行或保存任何文件，然后直接报告事实。' }],
  })
  const history = await waitForTurnEnd(sessionId, firstSeq)
  const events = eventsFrom(history)
  const tools = dispatches(events)
  const toolCalls = assistantToolCalls(events)
  const routes = routeEvents(events)
  const firstTurnEndSeq = events.find(event => event.type === 'turn/end')?.seq ?? -1
  const continuationDispatches = events
    .filter(event => event.type === 'tool/code-dispatch' && event.seq > firstTurnEndSeq)
    .map(event => event.data ?? {})
  const routeResponse = await fetch(`${baseUrl}/api/dsh-godot-ai/adaptive/route/${encodeURIComponent(sessionId)}`).then(response => response.json())
  const lockedSelectionResponse = await fetch(`${baseUrl}/api/dsh-godot-ai/adaptive/route/${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ selection: 'repair' }),
  })
  const lockedSelectionBody = await lockedSelectionResponse.json()
  const readOnlyBootstrapTools = new Set(['session_manage', 'editor_state'])
  const bootstrapDispatches = events
    .filter(event => event.type === 'tool/code-dispatch' && event.seq <= firstTurnEndSeq)
    .map(event => event.data ?? {})
  return {
    sessionId,
    timedOut: waited.timedOut,
    selection,
    finalRoute: routeResponse.state,
    godotSkills: godotSkills.map(skill => skill.name),
    routes,
    assistantToolCalls: toolCalls.map(block => ({ name: block.name, id: block.id })),
    dispatches: tools.map(item => ({ name: item.name, isError: item.isError })),
    checks: {
      // The route GET endpoint intentionally returns its fallback state before
      // the first user message. The POST response is the durable selection
      // record; route events are the authoritative transition trace.
      selectionAcceptedBeforeMessage: selection.selection === requestedSelection,
      classifiedBuildIntent: requestedSelection === 'auto'
        ? routes.some(route => route.source === 'classifier' && route.route === 'build' && route.reason === 'clear-build-intent')
        : true,
      promotedToFull: routes.some(route => route.phase === 'full' && route.reason === 'bootstrap-inspection-succeeded'),
      bootstrapUsedRunCode: toolCalls.some(block => block.name === 'run_code'),
      adaptiveToolsMounted: tools.some(item => item.name?.startsWith('mcp__godot-ai-adaptive__')),
      fullContinuationCompleted: events.filter(event => event.type === 'turn/end' && event.data?.reason?.kind === 'completed').length >= 2,
      fullToolsUsedAfterPromotion: continuationDispatches.some(item => item.name?.startsWith('mcp__godot-ai-adaptive__')),
      godotSkillCatalogComplete: godotSkills.length === 16 && godotSkills.every(skill => skill.modelInvocable === true),
      bootstrapReadOnlyOnly: bootstrapDispatches
        .map(item => item.name?.replace('mcp__godot-ai-adaptive__', ''))
        .every(name => readOnlyBootstrapTools.has(name)),
      noWriteTools: !tools.some(item => /(?:write|create|patch|save|run)/i.test(item.name ?? '') && !item.name?.includes('run_code')),
      completedTurn: events.filter(event => event.type === 'turn/end').some(event => event.data?.reason?.kind === 'completed'),
      noEmptyToolNames: toolCalls.every(block => typeof block.name === 'string' && block.name.length > 0),
      selectionLockedAfterMessage: lockedSelectionResponse.status === 400
        && /before the first message/i.test(lockedSelectionBody.error ?? ''),
    },
  }
}

async function inspectHostContracts() {
  const integration = (await getJson('/api/dsh-godot-ai/integration')).integration
  const classicPreset = (await getJson('/api/dsh-godot-ai/preset')).state
  const adaptivePreset = (await getJson('/api/dsh-godot-ai/adaptive/preset')).state
  return {
    integration,
    presetStates: { classic: classicPreset, adaptive: adaptivePreset },
    checks: {
      wrapperVersion: integration.wrapperVersion === expectedWrapperVersion,
      backendReady: integration.backend?.kind === 'ready' && integration.backend.details?.serverVersion === '3.1.5',
      editorConnected: integration.editor?.kind === 'connected'
        && integration.editor.sessions.some(session => session.pluginVersion === '3.1.5'),
      updateProbePresent: ['current', 'update-available', 'unverified-update', 'unavailable'].includes(integration.update?.kind),
      classicPresetRoute: ['current', 'not-installed', 'sync-available', 'base-update-available', 'user-modified', 'broken', 'unavailable'].includes(classicPreset.kind),
      adaptivePresetRoute: ['current', 'not-installed', 'sync-available', 'base-update-available', 'user-modified', 'broken', 'unavailable'].includes(adaptivePreset.kind),
    },
  }
}

const host = await inspectHostContracts()
const adaptiveManual = await runAdaptive({ selection: 'build' })
const adaptiveAuto = await runAdaptive({
  selection: 'auto',
  prompt: '创建前只做一次只读的 Godot 编辑器连接检查：读取当前 editor 状态和会话列表，不要创建、修改、运行或保存任何文件。检查完成后直接报告读取到的事实，不要重复调用。',
})
const classic = await runClassic()
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseUrl,
  model,
  timeoutMs,
  purpose: 'plugin-capability-smoke',
  scope: 'plugin capability, not game-delivery quality',
  host,
  classic,
  adaptive: { manual: adaptiveManual, auto: adaptiveAuto },
  pass: Object.values(host.checks).every(Boolean)
    && !classic.timedOut && !adaptiveManual.timedOut && !adaptiveAuto.timedOut
    && Object.values(classic.checks).every(Boolean)
    && Object.values(adaptiveManual.checks).every(Boolean)
    && Object.values(adaptiveAuto.checks).every(Boolean),
}
await mkdir(dirname(outputPath), { recursive: true }).catch(() => {})
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (!report.pass) process.exitCode = 1
