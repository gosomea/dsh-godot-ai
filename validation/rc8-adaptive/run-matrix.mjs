#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const here = dirname(fileURLToPath(import.meta.url))
const baseUrl = process.env.DSH_EVAL_URL ?? 'http://127.0.0.1:3081'
const projectPath = resolve(process.env.DSH_EVAL_PROJECT
  ?? '/Users/yuqixian/forever-skills/projects/godot-test-project')
const provider = 'deepseek-official'
const reasoningEffort = 'max'
const outputRoot = join(here, 'formal-runs')
const gameArtifactRoot = join(here, 'game-artifacts')
const matrixGameRoot = resolve(projectPath, 'validation_games/rc8_matrix')
const runBudgetMs = Number(process.env.DSH_EVAL_RUN_BUDGET_MS ?? 12 * 60_000)
const uvxPath = process.env.DSH_EVAL_UVX ?? '/Users/yuqixian/.local/bin/uvx'
const matrixOrderSeed = 'rc8-formal-v1'
const freezeManifestPath = join(here, 'freeze-manifest.json')

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function hashTree(root) {
  const entries = []
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile()) entries.push(`${relative(root, child)}\0${await sha256File(child)}`)
    }
  }
  await visit(root)
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

async function assertFrozenInputs() {
  const manifest = JSON.parse(await readFile(freezeManifestPath, 'utf8'))
  const checks = [
    ['runner', await sha256File(fileURLToPath(import.meta.url))],
    ['orchestrationSkill', await sha256File(resolve(here, '../..', manifest.artifacts.orchestrationSkill.path))],
    ['projectGodot', await sha256File(manifest.artifacts.projectGodot.path)],
    ['neutralScene', await sha256File(manifest.artifacts.neutralScene.path)],
    ['neonDashSeed', await hashTree(manifest.artifacts.neonDashSeed.path)],
    ['tarball', await sha256File(resolve(here, '../..', manifest.artifacts.tarball.path))],
  ]
  for (const [name, actual] of checks) {
    const expected = manifest.artifacts[name].sha256
    if (actual !== expected) throw new Error(`frozen input ${name} changed: expected ${expected}, got ${actual}`)
  }
  if (manifest.candidateVersion !== '0.5.0-rc.1') throw new Error(`unexpected frozen candidate ${manifest.candidateVersion}`)
  if (manifest.matrixOrderSeed !== matrixOrderSeed) throw new Error(`unexpected matrix seed ${manifest.matrixOrderSeed}`)
  return manifest
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : process.argv[index + 1]
}

const selectedRun = option('run')
const limit = Number(option('limit') ?? Number.POSITIVE_INFINITY)
const force = process.argv.includes('--force')
const dryRun = process.argv.includes('--dry-run')

const models = [
  { id: 'deepseek-v4-pro-ioa', short: 'pro' },
  { id: 'deepseek-v4-flash-ioa', short: 'flash' },
]

const categories = [
  {
    id: '2d-create',
    title: '2D 从零创建',
    prompt: target => `只在 ${target} 内从零创建一个极小但可玩的 2D 躲避游戏。玩家用方向键移动，固定障碍不能穿过或接触后立即重置，HUD 显示说明；把交互设计成最多两次短输入就能确定性验证，不要使用需要长时间追逐的移动障碍。不要改 project.godot 或目标目录外的文件。完成后必须回读场景和脚本，运行目标场景，读取 editor/game 日志并截图验收，截图后停止游戏；没有真实证据不要声称完成。`,
  },
  {
    id: '3d-create',
    title: '3D 从零创建',
    prompt: target => `只在 ${target} 内从零创建一个极小 3D 收集原型：可移动玩家、一个收集物、相机、灯光、碰撞和 HUD。不要改 project.godot 或目标目录外的文件。完成后回读 3D 层级，运行目标场景，验证收集状态、日志和游戏截图，截图后停止游戏；按最小可玩切片交付。`,
  },
  {
    id: 'bugfix',
    title: '现有项目修复与重构',
    prompt: target => `把 validation_games/neon_dash 的必要源文件复制到 ${target} 作为独立副本，只修改这个副本。先运行和读取日志/层级，找出一项有证据的缺陷或脆弱点并做最小修复；若没有功能 bug，就选择一项能通过运行时读回证明的健壮性改进。不要改原 Neon Dash 或 project.godot。修复后重新运行、读日志、验证玩法状态并截图，截图后停止游戏。`,
  },
  {
    id: 'ui-animation',
    title: 'UI、布局与动画',
    prompt: target => `只在 ${target} 内创建一个独立的 Godot UI 小场景：标题、计数标签、可键鼠聚焦按钮、点击反馈和 Tween 动画，布局在窗口缩放时不溢出。不要改 project.godot 或其他目录。完成后回读 Control 布局/焦点/信号，运行并触发按钮，读取日志和运行时 UI 状态，再截图验收，截图后停止游戏。`,
  },
  {
    id: 'long-resume',
    title: '长会话恢复',
    prompt: target => `第一阶段只在 ${target} 内创建一个可运行的计时点击游戏：按钮增加分数，倒计时结束后显示结果。不要改 project.godot 或其他目录。完成后回读、运行、读日志并截图，截图后停止游戏，然后明确记录可继续扩展的验证点。`,
    followup: target => `继续同一个会话和 ${target}：在不重写已验证实现的前提下加入重新开始和最高分显示，先复查第一阶段现状，再小批修改。最后完整运行两轮，验证分数、倒计时、重新开始、日志和截图，截图后停止游戏，并说明从哪个验证点恢复。`,
  },
]

function buildMatrix() {
  const rows = []
  let cell = 0
  for (const [categoryIndex, category] of categories.entries()) {
    for (const [modelIndex, model] of models.entries()) {
      const order = (categoryIndex + modelIndex) % 2 === 0
        ? ['classic', 'adaptive', 'classic']
        : ['adaptive', 'classic', 'adaptive']
      for (let repeat = 0; repeat < order.length; repeat += 1) {
        const mode = order[repeat]
        const id = `${String(cell + 1).padStart(2, '0')}-${category.id}-${model.short}-${mode}-${repeat + 1}`
        rows.push({ id, cell, repeat: repeat + 1, category, model, mode })
      }
      cell += 1
    }
  }
  return rows
}

function seededShuffle(rows, seed) {
  let state = [...seed].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16_777_619), 2_166_136_261) >>> 0
  const random = () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
  }
  const shuffled = [...rows]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]]
  }
  return shuffled
}

let rpcSequence = 0
async function rpc(method, payload) {
  const rpcId = `godot-rc8-eval-${Date.now()}-${++rpcSequence}`
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  const body = await response.json()
  if (!response.ok || body?.result?.ok !== true) {
    throw new Error(`${method}: ${body?.result?.error?.code ?? response.status}: ${body?.result?.error?.message ?? JSON.stringify(body)}`)
  }
  return body.result.value
}

async function integration() {
  const response = await fetch(`${baseUrl}/api/dsh-godot-ai/integration`)
  if (!response.ok) throw new Error(`integration HTTP ${response.status}`)
  return (await response.json()).integration
}

async function resetEditorToNeutralScene() {
  const transport = new StdioClientTransport({
    command: uvxPath,
    args: ['--from', 'godot-ai==3.1.5', 'godot-ai', 'attach'],
    stderr: 'pipe',
  })
  const client = new Client({ name: 'dsh-godot-ai-rc8-eval-setup', version: '1.0.0' })
  await client.connect(transport)
  try {
    const stopped = await client.callTool({ name: 'project_manage', arguments: { op: 'stop' } })
    if (stopped.isError === true) throw new Error('Godot setup could not stop the running project')
    const opened = await client.callTool({
      name: 'scene_open',
      arguments: { path: 'res://main.tscn', force_reload: true },
    })
    if (opened.isError === true) throw new Error('Godot setup could not open res://main.tscn')
    const state = await client.callTool({ name: 'editor_state', arguments: {} })
    const currentScene = state.structuredContent?.current_scene
    if (state.isError === true || currentScene !== 'res://main.tscn') {
      throw new Error(`Godot setup expected res://main.tscn, got ${String(currentScene)}`)
    }
  } finally {
    await client.close()
  }
}

async function quarantinePreviousMatrixGames() {
  await mkdir(matrixGameRoot, { recursive: true })
  await mkdir(gameArtifactRoot, { recursive: true })
  const quarantined = []
  for (const entry of await readdir(matrixGameRoot, { withFileTypes: true })) {
    const source = join(matrixGameRoot, entry.name)
    const destinationRoot = join(gameArtifactRoot, entry.name)
    await mkdir(destinationRoot, { recursive: true })
    const existing = await readdir(destinationRoot)
    const sequence = existing.filter(name => /^snapshot-\d+$/.test(name)).length + 1
    const destination = join(destinationRoot, `snapshot-${sequence}`)
    await rename(source, destination)
    quarantined.push({ source: relative(projectPath, source), destination: relative(here, destination) })
  }
  return quarantined
}

function assertPreflight(snapshot) {
  if (snapshot.wrapperVersion !== '0.5.0-rc.1') throw new Error(`expected wrapper 0.5.0-rc.1, got ${snapshot.wrapperVersion}`)
  if (snapshot.backend?.kind !== 'ready') throw new Error(`backend is ${snapshot.backend?.kind ?? 'missing'}`)
  if (snapshot.backend.details?.serverVersion !== '3.1.5') throw new Error(`backend is ${snapshot.backend.details?.serverVersion}`)
  if (snapshot.editor?.kind !== 'connected') throw new Error(`editor is ${snapshot.editor?.kind ?? 'missing'}`)
  const matches = snapshot.editor.sessions.filter(session => resolve(session.projectPath) === projectPath)
  if (matches.length !== 1 || matches[0].readiness !== 'ready') {
    throw new Error(`expected one ready editor for ${projectPath}, got ${matches.length}`)
  }
}

async function walkFiles(root, ignoredRoots, result = new Map()) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    const normalized = resolve(path)
    if (ignoredRoots.some(ignored => normalized === ignored || normalized.startsWith(`${ignored}/`))) continue
    if (entry.isDirectory()) {
      await walkFiles(path, ignoredRoots, result)
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.uid')) continue
      const data = await readFile(path)
      result.set(relative(projectPath, path), createHash('sha256').update(data).digest('hex'))
    }
  }
  return result
}

function diffSnapshots(before, after) {
  const changed = []
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(name) !== after.get(name)) changed.push(name)
  }
  return changed.sort()
}

async function waitForIdle(sessionId, timeoutMs = runBudgetMs) {
  const deadline = Date.now() + timeoutMs
  let observedRunning = false
  while (Date.now() < deadline) {
    const row = (await rpc('session.list', {})).items.find(item => item.sessionId === sessionId)
    if (row?.running) observedRunning = true
    if (observedRunning && row !== undefined && !row.running) return { timedOut: false }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1_000))
  }
  await rpc('session.cancel', { sessionId })
  const cancelDeadline = Date.now() + 30_000
  while (Date.now() < cancelDeadline) {
    const row = (await rpc('session.list', {})).items.find(item => item.sessionId === sessionId)
    if (row !== undefined && !row.running) return { timedOut: true }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
  }
  throw new Error(`session ${sessionId} did not become idle after budget cancellation`)
}

function compactHistory(history) {
  const retained = new Set([
    'godot-ai/adaptive-selection', 'godot-ai/adaptive-route', 'request/header',
    'user/message', 'assistant/message', 'tool/call', 'tool/code-dispatch',
    'tool/result', 'turn/end',
  ])
  return history.events.filter(item => retained.has(item.event.type))
}

function summarizeEvents(events, target, mode) {
  const routes = []
  const routeEntries = []
  const dispatches = []
  const dispatchEntries = []
  const toolCalls = []
  const turnEnds = []
  const targetRuns = []
  const screenshotAttempts = []
  let inputTokens = 0
  let outputTokens = 0
  let emptyToolNames = 0
  const scopeViolations = new Set()
  const matrixPathPattern = /validation_games\/rc8_matrix\/[A-Za-z0-9._/-]+/g
  for (const { event } of events) {
    if (event.type === 'godot-ai/adaptive-route') {
      routes.push(event.data)
      routeEntries.push({ seq: event.seq, data: event.data })
    }
    if (event.type === 'tool/code-dispatch') {
      const dispatch = {
        name: event.data.name,
        isError: event.data.isError,
      }
      dispatches.push(dispatch)
      dispatchEntries.push({ seq: event.seq, ...dispatch })
      const serializedArguments = JSON.stringify(event.data.arguments ?? '')
      for (const match of serializedArguments.match(matrixPathPattern) ?? []) {
        if (match !== target && !match.startsWith(`${target}/`)) scopeViolations.add(match)
      }
      if (event.data.name.includes('project_run') && !event.data.isError) {
        const args = event.data.arguments
        targetRuns.push({
          mode: typeof args === 'object' && args !== null ? args.mode : undefined,
          scene: typeof args === 'object' && args !== null ? args.scene : undefined,
        })
      }
      if (event.data.name.includes('editor_screenshot')) {
        let metadata
        for (const block of event.data.content ?? []) {
          if (block.type !== 'text') continue
          try {
            const parsed = JSON.parse(block.text)
            if (parsed !== null && typeof parsed === 'object' && 'stale_frame' in parsed) metadata = parsed
          } catch {}
        }
        screenshotAttempts.push({
          isError: event.data.isError,
          staleFrame: metadata?.stale_frame,
          framesDrawn: metadata?.frames_drawn,
        })
      }
    }
    if (event.type === 'assistant/message') {
      const usage = event.data.usage
      inputTokens += usage?.inputTokens ?? 0
      outputTokens += usage?.outputTokens ?? 0
      for (const block of event.data.message?.content ?? []) {
        if (block.type !== 'tool-call') continue
        toolCalls.push({ name: block.name, argumentsLength: block.arguments?.length ?? 0 })
        if (!block.name) emptyToolNames += 1
      }
    }
    if (event.type === 'turn/end') turnEnds.push(event.data.reason)
  }
  const successful = name => dispatches.some(item => item.name.includes(name) && !item.isError)
  const adaptiveDispatches = dispatchEntries.filter(item => item.name.startsWith('mcp__godot-ai-adaptive__'))
  const classicDispatches = dispatchEntries.filter(item => item.name.startsWith('mcp__godot-ai__'))
  const firstFullRouteSeq = routeEntries.find(entry => entry.data.phase === 'full')?.seq ?? Number.POSITIVE_INFINITY
  const bootstrapAdaptiveDispatches = adaptiveDispatches.filter(item => item.seq < firstFullRouteSeq)
  const bootstrapReadOnlyNames = new Set(['mcp__godot-ai-adaptive__session_manage', 'mcp__godot-ai-adaptive__editor_state'])
  const pluginEvidence = {
    expectedMode: mode,
    namespaceMatches: mode === 'adaptive'
      ? adaptiveDispatches.length > 0 && classicDispatches.length === 0
      : classicDispatches.length > 0 && adaptiveDispatches.length === 0,
    routeLifecycle: mode === 'adaptive'
      ? routes.some(route => route.phase === 'bootstrap') && routes.some(route => route.phase === 'full')
      : routes.length === 0,
    bootstrapReadOnlyOnly: mode === 'adaptive'
      ? bootstrapAdaptiveDispatches.length > 0 && bootstrapAdaptiveDispatches.every(item => bootstrapReadOnlyNames.has(item.name))
      : true,
    runCodeUsed: toolCalls.some(call => call.name === 'run_code'),
  }
  return {
    routes,
    dispatches,
    toolCalls,
    turnEnds,
    inputTokens,
    outputTokens,
    emptyToolNames,
    targetRuns,
    screenshotAttempts,
    scopeReferences: [...scopeViolations].sort(),
    scopeViolations: [],
    pluginEvidence,
    evidence: {
      ranProject: targetRuns.some(run =>
        run.mode === 'custom'
        && typeof run.scene === 'string'
        && run.scene.startsWith(`res://${target}/`)),
      readLogs: successful('logs_read'),
      capturedScreenshot: screenshotAttempts.some(attempt => !attempt.isError && attempt.staleFrame === false),
      readScene: successful('scene_get_hierarchy') || successful('game_manage'),
    },
  }
}

async function runRow(row, attempt) {
  const target = `validation_games/rc8_matrix/${row.id}`
  const targetPath = resolve(projectPath, target)
  const ignored = [
    resolve(projectPath, '.godot'),
    resolve(projectPath, 'addons'),
    resolve(projectPath, 'validation_games/rc8_matrix'),
  ]
  let quarantinedGames = []
  if (!dryRun) {
    await resetEditorToNeutralScene()
    quarantinedGames = await quarantinePreviousMatrixGames()
  }
  const before = await walkFiles(projectPath, ignored)
  const snapshot = await integration()
  assertPreflight(snapshot)
  const sessionId = randomUUID()
  const preset = row.mode === 'adaptive' ? 'godot-creator-adaptive' : 'godot-creator'
  const created = await rpc('session.create', { cwd: projectPath, sessionId, agentPreset: preset })
  const skillCatalog = await rpc('skill.list', { sessionId })
  const godotSkills = (skillCatalog.skills ?? []).filter(skill => skill.name?.startsWith('godot-'))
  await rpc('session.selectModel', {
    sessionId,
    provider,
    model: row.model.id,
    reasoningEffort,
  })
  await rpc('session.rename', { sessionId, title: `rc8 eval ${row.id}` })

  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  let timedOut = false
  let followupSkipped = false
  if (!dryRun) {
    await rpc('session.prompt', {
      sessionId,
      mode: 'queue',
      clientTimeZone: 'Asia/Shanghai',
      content: [{ type: 'text', text: row.category.prompt(target) }],
    })
    timedOut = (await waitForIdle(sessionId)).timedOut
    if (row.category.followup !== undefined) {
      if (timedOut) {
        followupSkipped = true
      } else {
        await rpc('session.prompt', {
          sessionId,
          mode: 'queue',
          clientTimeZone: 'Asia/Shanghai',
          content: [{ type: 'text', text: row.category.followup(target) }],
        })
        timedOut = (await waitForIdle(sessionId)).timedOut
      }
    }
  }
  const history = await rpc('session.history', { sessionId, maxMessages: 160 })
  const events = compactHistory(history)
  const summary = summarizeEvents(events, target, row.mode)
  summary.scopeViolations = (await Promise.all(summary.scopeReferences.map(async path => ({
    path,
    exists: await stat(resolve(projectPath, path)).then(() => true, () => false),
  })))).filter(item => item.exists).map(item => item.path)
  const after = await walkFiles(projectPath, ignored)
  const outsideChanges = diffSnapshots(before, after)
  const targetExists = await stat(targetPath).then(value => value.isDirectory(), () => false)
  const report = {
    schemaVersion: 1,
    attempt,
    runId: row.id,
    category: { id: row.category.id, title: row.category.title },
    repeat: row.repeat,
    mode: row.mode,
    preset,
    model: row.model.id,
    provider,
    sessionId,
    target,
    startedAt,
    completedAt: new Date().toISOString(),
    wallTimeMs: Date.now() - startedMs,
    runBudgetMs,
    timedOut,
    followupSkipped,
    dryRun,
    integration: snapshot,
    godotSkills: godotSkills.map(skill => ({ name: skill.name, modelInvocable: skill.modelInvocable })),
    setup: {
      neutralScene: dryRun ? null : 'res://main.tscn',
      quarantinedGames,
    },
    targetExists,
    outsideChanges,
    summary,
    pass: !dryRun
      && !timedOut
      && created.agentPreset === preset
      && godotSkills.length === 16
      && godotSkills.every(skill => skill.modelInvocable === true)
      && targetExists
      && outsideChanges.length === 0
      && summary.emptyToolNames === 0
      && summary.pluginEvidence.namespaceMatches
      && summary.pluginEvidence.routeLifecycle
      && summary.pluginEvidence.bootstrapReadOnlyOnly
      && summary.pluginEvidence.runCodeUsed
      && summary.scopeViolations.length === 0
      && summary.turnEnds.every(reason => reason.kind === 'completed')
      && summary.evidence.ranProject
      && summary.evidence.readLogs
      && summary.evidence.capturedScreenshot,
    events,
  }
  await mkdir(outputRoot, { recursive: true })
  await writeFile(join(outputRoot, `${row.id}.json`), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

const matrix = seededShuffle(buildMatrix(), matrixOrderSeed)
let chosen = selectedRun === undefined ? matrix : matrix.filter(row => row.id === selectedRun)
if (selectedRun !== undefined && chosen.length === 0) throw new Error(`unknown run ${selectedRun}`)
chosen = chosen.slice(0, Number.isFinite(limit) ? limit : chosen.length)
const freezeManifest = await assertFrozenInputs()

if (dryRun) {
  const planned = []
  for (const row of chosen) {
    const path = join(outputRoot, `${row.id}.json`)
    const existing = await readFile(path, 'utf8').then(JSON.parse, () => undefined)
    const item = {
      runId: row.id,
      status: existing === undefined ? 'planned' : 'skipped-existing',
      mode: row.mode,
      model: row.model.id,
      existingPass: existing?.pass,
    }
    planned.push(item)
    process.stdout.write(`${JSON.stringify(item)}\n`)
  }
  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    projectPath,
    selectedRun,
    dryRun: true,
    matrixOrderSeed,
    candidateSha256: freezeManifest.artifacts.tarball.sha256,
    total: planned.length,
    planned: planned.filter(item => item.status === 'planned').length,
    existing: planned.filter(item => item.status === 'skipped-existing').length,
  })}\n`)
  process.exit(0)
}

await mkdir(outputRoot, { recursive: true })

const results = []
for (const row of chosen) {
  const path = join(outputRoot, `${row.id}.json`)
  const existing = await readFile(path, 'utf8').then(JSON.parse, () => undefined)
  let attempt = 1
  if (existing !== undefined) {
    if (!force) {
      process.stdout.write(`${JSON.stringify({ runId: row.id, status: 'skipped-existing', pass: existing.pass })}\n`)
      results.push(existing)
      continue
    }
    const attemptsDir = join(outputRoot, 'attempts', row.id)
    await mkdir(attemptsDir, { recursive: true })
    const previousAttempts = await readdir(attemptsDir)
    const archivedAttempt = previousAttempts.filter(name => /^attempt-\d+\.json$/.test(name)).length + 1
    await rename(path, join(attemptsDir, `attempt-${archivedAttempt}.json`))
    attempt = archivedAttempt + 1
  }
  process.stdout.write(`${JSON.stringify({ runId: row.id, status: 'started', mode: row.mode, model: row.model.id })}\n`)
  try {
    const report = await runRow(row, attempt)
    results.push(report)
    process.stdout.write(`${JSON.stringify({ runId: row.id, status: 'completed', pass: report.pass, wallTimeMs: report.wallTimeMs })}\n`)
  } catch (error) {
    const failure = { runId: row.id, status: 'runner-error', message: error instanceof Error ? error.message : String(error) }
    results.push(failure)
    process.stdout.write(`${JSON.stringify(failure)}\n`)
  }
}

const completed = results.filter(result => result.schemaVersion === 1)
const summary = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  projectPath,
  selectedRun,
  dryRun,
  matrixOrderSeed,
  candidateSha256: freezeManifest.artifacts.tarball.sha256,
  total: results.length,
  completed: completed.length,
  passed: completed.filter(result => result.pass).length,
  classic: {
    total: completed.filter(result => result.mode === 'classic').length,
    passed: completed.filter(result => result.mode === 'classic' && result.pass).length,
  },
  adaptive: {
    total: completed.filter(result => result.mode === 'adaptive').length,
    passed: completed.filter(result => result.mode === 'adaptive' && result.pass).length,
  },
  runnerErrors: results.filter(result => result.status === 'runner-error'),
}
await writeFile(join(here, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(summary)}\n`)
