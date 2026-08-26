import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {
  GodotAdaptiveSelection,
  GodotAdaptiveState,
} from '../core/types.js'
import { GODOT_ADAPTIVE_PRESET_ID } from '../core/types.js'
import {
  ADAPTIVE_CLASSIFIER_VERSION,
  classifyGodotModel,
  promoteAdaptiveState,
  renderAdaptiveBootstrapPrompt,
  renderAdaptiveContinuationPrompt,
  resolveAdaptiveRoute,
} from './adaptive-routing.js'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'godot-ai/adaptive-selection': { selection: GodotAdaptiveSelection; updatedAt: string }
    'godot-ai/adaptive-route': GodotAdaptiveState
  }
}

export const ADAPTIVE_READ_ONLY_TOOLS = [
  'mcp__godot-ai-adaptive__session_manage',
  'mcp__godot-ai-adaptive__editor_state',
] as const

export interface FoldedAdaptiveSession {
  readonly selection: GodotAdaptiveSelection
  readonly state?: GodotAdaptiveState
}

interface BootstrapController {
  state: GodotAdaptiveState
  bootstrapSucceeded: boolean
  invalidToolNameObserved: boolean
  readonly successfulInspectionRoots: Set<string>
  dispose(): void
}

interface AdaptiveSkillBudget {
  readonly loaded: Set<string>
  readonly toolCalls: Map<string, number>
  expectedTarget: string | undefined
  dispose(): void
}

const controllers = new WeakMap<Agent, BootstrapController>()
const continuationPrompts = new WeakMap<Agent, () => void>()
const skillBudgets = new WeakMap<Agent, AdaptiveSkillBudget>()

export function admitAdaptiveGodotSkill(loaded: Set<string>, skillName: string): string | undefined {
  if (!skillName.startsWith('godot-')) return undefined
  if (loaded.has(skillName)) {
    return `Godot Adaptive skill ${skillName} is already loaded in this user turn. Continue without loading it again.`
  }
  if (skillName === 'godot-ai-orchestration') {
    loaded.add(skillName)
    return undefined
  }
  const domainCount = [...loaded].filter(name => name.startsWith('godot-') && name !== 'godot-ai-orchestration').length
  if (domainCount >= 2) {
    return 'Godot Adaptive permits godot-ai-orchestration plus at most two Godot domain skills in one user turn. Continue with the skills already loaded.'
  }
  loaded.add(skillName)
  return undefined
}

export function extractAdaptiveTarget(text: string): string | undefined {
  return text.match(/validation_games\/rc8_matrix\/[A-Za-z0-9._-]+/)?.[0]
}

export function guardAdaptiveProjectRun(expectedTarget: string, args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) {
    return `Godot Adaptive must run an explicit scene inside ${expectedTarget}.`
  }
  const { mode, scene } = args as { mode?: unknown; scene?: unknown }
  if (mode !== 'custom' || typeof scene !== 'string' || !scene.startsWith(`res://${expectedTarget}/`)) {
    return `Godot Adaptive must use project_run mode="custom" with a scene inside res://${expectedTarget}/; mode="current" can launch a stale editor tab.`
  }
  return undefined
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value !== 'object' || value === null) return JSON.stringify(value) ?? 'undefined'
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`
}

/**
 * Bound repeated verification in one user turn. The limits are intentionally
 * generous enough for before/after evidence, while preventing a model from
 * spending the rest of the turn on an already-observed runtime condition.
 */
export function admitAdaptiveGodotToolCall(
  calls: Map<string, number>,
  name: string,
  args: unknown,
): string | undefined {
  if (!name.startsWith('mcp__godot-ai-adaptive__')) return undefined
  const exactKey = `exact:${name}:${canonicalJson(args)}`
  const exactCount = calls.get(exactKey) ?? 0
  if (exactCount >= 3) {
    return 'Godot Adaptive already executed this exact Godot tool request three times in the current user turn. Stop repeating the same oracle; use existing evidence, choose one different bounded check, or report the limitation.'
  }

  const operation = typeof args === 'object' && args !== null
    ? (args as { op?: unknown }).op
    : undefined
  const budgetKey = name.endsWith('__project_run')
    ? 'budget:project_run'
    : name.endsWith('__editor_manage') && operation === 'game_eval'
      ? 'budget:game_eval'
      : undefined
  const budgetLimit = budgetKey === 'budget:project_run' ? 2 : 8
  if (budgetKey !== undefined && (calls.get(budgetKey) ?? 0) >= budgetLimit) {
    return budgetKey === 'budget:project_run'
      ? 'Godot Adaptive permits at most two project launches in one user turn: one diagnosis run and one final verification run. Use the evidence already collected and finish honestly.'
      : 'Godot Adaptive permits at most eight game_eval calls in one user turn. Use the runtime evidence already collected, switch to one bounded non-eval oracle, or report the remaining limitation.'
  }

  calls.set(exactKey, exactCount + 1)
  if (budgetKey !== undefined) calls.set(budgetKey, (calls.get(budgetKey) ?? 0) + 1)
  return undefined
}

function installAdaptiveSkillBudget(agent: Agent): AdaptiveSkillBudget {
  const existing = skillBudgets.get(agent)
  if (existing !== undefined) return existing
  const loaded = new Set<string>()
  const toolCalls = new Map<string, number>()
  let budget: AdaptiveSkillBudget
  const disposeGuard = agent.ctx.tools.guard(execution => {
    if (execution.name === 'skill') {
      const args = execution.arguments
      if (typeof args !== 'object' || args === null || typeof (args as { name?: unknown }).name !== 'string') return undefined
      return admitAdaptiveGodotSkill(loaded, (args as { name: string }).name)
    }
    const toolBudgetError = admitAdaptiveGodotToolCall(toolCalls, execution.name, execution.arguments)
    if (toolBudgetError !== undefined) return toolBudgetError
    if (
      execution.name === 'mcp__godot-ai-adaptive__project_run'
      && budget.expectedTarget !== undefined
    ) {
      return guardAdaptiveProjectRun(budget.expectedTarget, execution.arguments)
    }
    return undefined
  })
  budget = {
    loaded,
    toolCalls,
    expectedTarget: undefined,
    dispose: () => {
      if (skillBudgets.get(agent) !== budget) return
      skillBudgets.delete(agent)
      disposeGuard()
    },
  }
  skillBudgets.set(agent, budget)
  return budget
}

export function foldAdaptiveSession(events: readonly SessionEvent[]): FoldedAdaptiveSession {
  let selection: GodotAdaptiveSelection = 'auto'
  let state: GodotAdaptiveState | undefined
  for (const event of events) {
    if (event.type === 'godot-ai/adaptive-selection') {
      selection = event.data.selection
      state = undefined
    } else if (event.type === 'godot-ai/adaptive-route') {
      selection = event.data.selection
      state = event.data
    }
  }
  return { selection, ...(state === undefined ? {} : { state }) }
}

export function appendAdaptiveSelection(agent: Agent, selection: GodotAdaptiveSelection): void {
  agent.session.append('godot-ai/adaptive-selection', { selection, updatedAt: new Date().toISOString() })
}

export function currentAdaptiveState(agent: Agent): GodotAdaptiveState {
  const folded = foldAdaptiveSession(agent.session.events)
  if (folded.state !== undefined) return folded.state
  const model = agent.session.requestHeader()?.config.model ?? agent.options.model
  return {
    selection: folded.selection,
    route: 'classic',
    phase: 'unclassified',
    source: 'fallback',
    reason: 'awaiting-first-message',
    classifierVersion: ADAPTIVE_CLASSIFIER_VERSION,
    promptVariant: 'creator-classic-v1',
    modelClass: classifyGodotModel(model),
    updatedAt: new Date().toISOString(),
  }
}

function messageText(message: UserMessage): string {
  return message.content
    .filter((block): block is Extract<(typeof message.content)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

function installBootstrap(agent: Agent, state: GodotAdaptiveState): BootstrapController {
  const existing = controllers.get(agent)
  if (existing !== undefined) return existing
  if (state.route === 'classic' || state.phase !== 'bootstrap') {
    throw new Error('adaptive bootstrap requires a build or repair route in bootstrap phase')
  }

  const tools = ADAPTIVE_READ_ONLY_TOOLS.filter(name => agent.ctx.tools.get(name, agent) !== undefined)
  if (tools.length === 0) throw new Error('adaptive bootstrap could not find any Godot read-only tools')

  const schemas = agent.ctx.tools.schemas(agent).filter(schema => tools.includes(schema.name as (typeof tools)[number]))
  const disposePrompt = agent.ctx.systemPrompt.section({
    name: 'godot-ai:adaptive-bootstrap',
    order: 0,
    text: renderAdaptiveBootstrapPrompt(state.route, schemas),
    complete: true,
  })
  const disposePresentation = agent.ctx.tools.presentAs('code')
  const disposeRestriction = agent.ctx.tools.restrict({ allow: tools })
  const disposeGuard = agent.ctx.tools.guard(execution => {
    if (execution.name === 'run_code') return undefined
    if (!tools.includes(execution.name as (typeof tools)[number])) {
      return 'Godot Adaptive bootstrap permits read-only inspection tools only.'
    }
    if (execution.name === 'mcp__godot-ai-adaptive__session_manage') {
      const args = execution.arguments
      if (typeof args !== 'object' || args === null || (args as { op?: unknown }).op !== 'list') {
        return 'Godot Adaptive bootstrap permits session_manage only with op="list".'
      }
    }
    return undefined
  })

  let active = true
  const controller: BootstrapController = {
    state,
    bootstrapSucceeded: false,
    invalidToolNameObserved: false,
    successfulInspectionRoots: new Set(),
    dispose: () => {
      if (!active) return
      active = false
      disposeGuard()
      disposeRestriction()
      disposePresentation()
      disposePrompt()
      controllers.delete(agent)
    },
  }
  controllers.set(agent, controller)
  return controller
}

function promoteAfterFirstStep(agent: Agent, controller: BootstrapController): void {
  queueMicrotask(() => {
    if (controllers.get(agent) !== controller) return
    if (!controller.bootstrapSucceeded) {
      controller.state = {
        ...controller.state,
        reason: 'bootstrap-inspection-not-confirmed',
        updatedAt: new Date().toISOString(),
      }
      agent.session.append('godot-ai/adaptive-route', controller.state)
      return
    }
    controller.dispose()
    const disposePrompt = agent.ctx.systemPrompt.section({
      name: 'godot-ai:adaptive-continuation',
      order: 1,
      text: renderAdaptiveContinuationPrompt(controller.state.route as 'build' | 'repair'),
    })
    const disposeContinuation = (): void => {
      if (continuationPrompts.get(agent) !== disposeContinuation) return
      continuationPrompts.delete(agent)
      disposePrompt()
    }
    continuationPrompts.get(agent)?.()
    continuationPrompts.set(agent, disposeContinuation)
    agent.session.append('godot-ai/adaptive-route', promoteAdaptiveState(controller.state))
  })
}

/** Install the per-agent Adaptive state machine after the Godot MCP catalog is mounted. */
export function installAdaptiveRuntime(ctx: Context): void {
  const agents = new Map<string, Agent>()

  ctx.on('agent/created', ({ agent }) => {
    if (resolveSessionPreset(agent.session) !== GODOT_ADAPTIVE_PRESET_ID) return
    agents.set(agent.id, agent)
    installAdaptiveSkillBudget(agent)
    const folded = foldAdaptiveSession(agent.session.events)
    if (folded.state?.phase === 'bootstrap') installBootstrap(agent, folded.state)
  })

  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (agents.get(agent.id) !== agent || message.source.kind !== 'user') return
    const skillBudget = skillBudgets.get(agent)
    if (skillBudget !== undefined) {
      skillBudget.loaded.clear()
      skillBudget.toolCalls.clear()
      skillBudget.expectedTarget = extractAdaptiveTarget(messageText(message))
    }
    const controller = controllers.get(agent)
    if (controller !== undefined) controller.invalidToolNameObserved = false
    const current = foldAdaptiveSession(agent.session.events)
    if (current.state !== undefined) return
    const model = agent.options.model ?? agent.session.requestHeader()?.config.model
    const state = resolveAdaptiveRoute({
      selection: current.selection,
      ...(model === undefined ? {} : { model }),
      text: messageText(message),
    })
    agent.session.append('godot-ai/adaptive-route', state)
    if (state.phase === 'bootstrap') installBootstrap(agent, state)
  })

  ctx.on('tools/result', (execution, result) => {
    const agent = execution.agent
    if (agent === undefined || agents.get(agent.id) !== agent) return
    const controller = controllers.get(agent)
    if (controller === undefined) return
    if (execution.name.length === 0) controller.invalidToolNameObserved = true
    if (result.isError) return
    if (
      execution.parent !== undefined
      && ADAPTIVE_READ_ONLY_TOOLS.includes(execution.name as (typeof ADAPTIVE_READ_ONLY_TOOLS)[number])
    ) {
      controller.successfulInspectionRoots.add(String(execution.rootCallId))
    } else if (
      execution.parent === undefined
      && execution.name === 'run_code'
      && controller.successfulInspectionRoots.has(String(execution.rootCallId))
    ) {
      controller.bootstrapSucceeded = true
    }
  })

  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const controller = controllers.get(agent)
    if (controller?.invalidToolNameObserved === true && messages.length === 0) return { kind: 'reject' }
    return next()
  })

  ctx.on('session/event', (session, event) => {
    const agent = agents.get(session.id)
    if (agent === undefined || session !== agent.session) return
    if (event.type === 'request/header') {
      const folded = foldAdaptiveSession(session.events)
      const state = folded.state
      if (state === undefined) return
      const modelClass = classifyGodotModel(event.data.header.config.model)
      if (modelClass === state.modelClass) return
      const updated = { ...state, modelClass, updatedAt: new Date().toISOString() }
      const controller = controllers.get(agent)
      if (controller !== undefined) controller.state = updated
      queueMicrotask(() => {
        if (agents.get(agent.id) === agent) session.append('godot-ai/adaptive-route', updated)
      })
      return
    }
    if (event.type !== 'step/end') return
    const controller = controllers.get(agent)
    if (controller !== undefined) {
      promoteAfterFirstStep(agent, controller)
      return
    }
    const disposeContinuation = continuationPrompts.get(agent)
    if (disposeContinuation !== undefined) queueMicrotask(disposeContinuation)
  })

  ctx.on('agent/disposed', ({ agent: subject }) => {
    if (agents.get(subject.id) !== subject) return
    controllers.get(subject)?.dispose()
    continuationPrompts.get(subject)?.()
    skillBudgets.get(subject)?.dispose()
    agents.delete(subject.id)
  })
}
