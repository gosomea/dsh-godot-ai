#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const validationRoot = dirname(fileURLToPath(import.meta.url))
const campaign = JSON.parse(await readFile(join(validationRoot, 'campaign.json'), 'utf8'))

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const runId = argument('run')
const dryRun = process.argv.includes('--dry-run')
const compactExisting = process.argv.includes('--compact-existing')
if (runId === undefined) {
  throw new Error('usage: node validation/run-session.mjs --run <game-id> [--dry-run | --compact-existing]')
}
const game = campaign.games.find(entry => entry.id === runId)
if (game === undefined) throw new Error(`unknown validation run ${runId}`)

let rpcSequence = 0
async function rpc(method, payload) {
  rpcSequence += 1
  const response = await fetch(`${campaign.dshUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `godot-validation-${runId}-${rpcSequence}`,
      method,
      payload,
    }),
  })
  if (!response.ok) throw new Error(`${method} failed over HTTP ${response.status}: ${await response.text()}`)
  const body = await response.json()
  if (body?.result?.ok !== true) {
    const error = body?.result?.error
    throw new Error(`${method} failed: ${error?.code ?? 'UNKNOWN'}: ${error?.message ?? JSON.stringify(body)}`)
  }
  return body.result.value
}

async function integration() {
  const response = await fetch(`${campaign.dshUrl}/api/dsh-godot-ai/integration`)
  if (!response.ok) throw new Error(`integration probe failed over HTTP ${response.status}`)
  return (await response.json()).integration
}

function assertPreflight(snapshot) {
  if (snapshot.wrapperVersion !== '0.4.1') throw new Error(`expected wrapper 0.4.1, got ${snapshot.wrapperVersion}`)
  if (snapshot.backend?.kind !== 'ready') throw new Error(`Godot AI backend is ${snapshot.backend?.kind ?? 'missing'}`)
  if (snapshot.backend.details?.serverVersion !== '3.1.5') {
    throw new Error(`expected Godot AI 3.1.5, got ${snapshot.backend.details?.serverVersion}`)
  }
  if (snapshot.backend.details?.excludeDomains?.length !== 0) throw new Error('Godot AI domains are excluded')
  if (snapshot.editor?.kind !== 'connected') throw new Error(`Godot editor is ${snapshot.editor?.kind ?? 'missing'}`)
  const target = resolve(campaign.projectPath)
  const matching = snapshot.editor.sessions.filter(session => resolve(session.projectPath) === target)
  if (matching.length !== 1) throw new Error(`expected one connected ${target} editor session, got ${matching.length}`)
  if (matching[0].pluginVersion !== '3.1.5') throw new Error(`expected addon 3.1.5, got ${matching[0].pluginVersion}`)
}

function assertSkills(value) {
  const godot = value.skills.filter(skill => skill.name.startsWith('godot-'))
  if (godot.length !== 16) throw new Error(`expected 16 Godot skills, got ${godot.length}`)
  const blocked = godot.filter(skill => !skill.modelInvocable)
  if (blocked.length > 0) throw new Error(`Godot skills not model-invocable: ${blocked.map(skill => skill.name).join(', ')}`)
  return godot
}

function latestSeq(history) {
  return history.events.reduce((value, entry) => Math.max(value, entry.event.seq), -1)
}

function compactString(value, limit = 12_000) {
  if (value.length <= limit) return value
  const digest = createHash('sha256').update(value).digest('hex')
  return `${value.slice(0, limit)}\n<omitted ${value.length - limit} chars; sha256=${digest}>`
}

function compactValue(value, depth = 0) {
  if (typeof value === 'string') return compactString(value)
  if (value === null || typeof value !== 'object') return value
  if (depth >= 10) return '<omitted nested value at depth 10>'
  if (Array.isArray(value)) {
    const kept = value.slice(0, 200).map(entry => compactValue(entry, depth + 1))
    if (value.length > kept.length) kept.push(`<omitted ${value.length - kept.length} array entries>`)
    return kept
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, compactValue(entry, depth + 1)]),
  )
}

function compactHistory(history) {
  const retainedTypes = new Set([
    'user/message',
    'assistant/message',
    'tool/result',
    'turn/start',
    'turn/end',
  ])
  const events = history.events
    .filter(entry => retainedTypes.has(entry.event.type))
    .map(entry => compactValue(entry))
  return {
    totalEvents: history.events.length,
    retainedEvents: events.length,
    omittedEvents: history.events.length - events.length,
    lastSeq: latestSeq(history),
    hasMore: history.hasMore,
    events,
  }
}

if (compactExisting) {
  const evidencePath = join(validationRoot, 'runs', `${runId}.json`)
  const existing = JSON.parse(await readFile(evidencePath, 'utf8'))
  if (Array.isArray(existing.history?.events)) existing.history = compactHistory(existing.history)
  await writeFile(evidencePath, `${JSON.stringify(existing, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ runId, evidencePath, history: existing.history }, null, 2)}\n`)
  process.exit(0)
}

async function waitForTurn(sessionId, afterSeq, timeoutMs = 45 * 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const history = await rpc('session.history', { sessionId, maxMessages: 64 })
    const terminal = history.events.find(entry =>
      entry.event.seq > afterSeq && entry.event.type === 'turn/end')
    if (terminal !== undefined) return history
    await new Promise(resolvePromise => setTimeout(resolvePromise, 5_000))
  }
  throw new Error(`validation run ${runId} timed out waiting for turn/end`)
}

const snapshot = await integration()
assertPreflight(snapshot)

const created = await rpc('session.create', {
  cwd: campaign.projectPath,
  agentPreset: campaign.agentPreset,
})
if (created.agentPreset !== campaign.agentPreset) {
  throw new Error(`expected preset ${campaign.agentPreset}, got ${created.agentPreset}`)
}

const skills = assertSkills(await rpc('skill.list', { sessionId: created.sessionId }))
const models = await rpc('session.models', { sessionId: created.sessionId })
const available = models.groups.some(group =>
  group.id === campaign.provider && group.models.some(model => model.id === game.model))
if (!available) throw new Error(`${campaign.provider}/${game.model} is not routable`)

const selected = await rpc('session.selectModel', {
  sessionId: created.sessionId,
  provider: campaign.provider,
  model: game.model,
  reasoningEffort: campaign.reasoningEffort,
})
await rpc('session.rename', { sessionId: created.sessionId, title: `Godot validation: ${game.id}` })

const promptPath = join(validationRoot, game.prompt)
const prompt = await readFile(promptPath, 'utf8')
const before = await rpc('session.history', { sessionId: created.sessionId, maxMessages: 8 })
const evidence = {
  schemaVersion: 1,
  runId,
  startedAt: new Date().toISOString(),
  sessionId: created.sessionId,
  promptPath,
  target: game.target,
  selected: selected.selected,
  godotSkills: skills.map(skill => skill.name),
  integration: snapshot,
  dryRun,
}

await mkdir(join(validationRoot, 'runs'), { recursive: true })
const evidencePath = join(validationRoot, 'runs', `${runId}.json`)
if (dryRun) {
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ ...evidence, prompt: basename(promptPath) }, null, 2)}\n`)
  process.exit(0)
}

await rpc('session.prompt', {
  sessionId: created.sessionId,
  mode: 'queue',
  clientTimeZone: 'Asia/Shanghai',
  content: [{ type: 'text', text: prompt }],
})
const history = await waitForTurn(created.sessionId, latestSeq(before))
evidence.completedAt = new Date().toISOString()
evidence.history = compactHistory(history)
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({
  runId,
  sessionId: created.sessionId,
  selected: selected.selected,
  events: history.events.length,
  evidencePath,
}, null, 2)}\n`)
