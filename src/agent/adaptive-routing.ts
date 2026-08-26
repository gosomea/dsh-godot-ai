import type {
  GodotAdaptivePhase,
  GodotAdaptiveRoute,
  GodotAdaptiveSelection,
  GodotAdaptiveSource,
  GodotAdaptiveState,
  GodotModelClass,
} from '../core/types.js'

export const ADAPTIVE_CLASSIFIER_VERSION = 'keyword-v1'

export interface AdaptiveRouteInput {
  readonly selection: GodotAdaptiveSelection
  readonly model?: string
  readonly text?: string
  readonly now?: string
}

interface KeywordScore {
  readonly build: number
  readonly repair: number
}

const BUILD_KEYWORDS = [
  '创建', '新建', '从零', '搭建', '生成', '做一个', '开发一个', '实现一个',
  'create', 'new game', 'from scratch', 'scaffold', 'build a', 'make a', 'prototype',
] as const

const REPAIR_KEYWORDS = [
  '修复', '报错', '错误', '崩溃', '不工作', '不能运行', '排查', '调试', '诊断',
  'fix', 'bug', 'error', 'crash', 'broken', 'debug', 'diagnose', 'not working',
] as const

const normalize = (text: string): string => text.normalize('NFKC').toLowerCase().trim()

const countMatches = (text: string, keywords: readonly string[]): number =>
  keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0)

export function classifyGodotModel(model?: string): GodotModelClass {
  const normalized = normalize(model ?? '')
  if (normalized.includes('flash')) return 'flash'
  if (normalized.includes('pro')) return 'pro'
  return 'other'
}

export function scoreAdaptiveRequest(text?: string): KeywordScore {
  const normalized = normalize(text ?? '')
  return {
    build: countMatches(normalized, BUILD_KEYWORDS),
    repair: countMatches(normalized, REPAIR_KEYWORDS),
  }
}

function createState(
  input: AdaptiveRouteInput,
  route: GodotAdaptiveRoute,
  phase: GodotAdaptivePhase,
  source: GodotAdaptiveSource,
  reason: string,
  modelClass: GodotModelClass,
): GodotAdaptiveState {
  return {
    selection: input.selection,
    route,
    phase,
    source,
    reason,
    classifierVersion: ADAPTIVE_CLASSIFIER_VERSION,
    promptVariant: route === 'classic' ? 'creator-classic-v1' : `${route}-minimal-v1`,
    modelClass,
    updatedAt: input.now ?? new Date().toISOString(),
  }
}

/**
 * Deterministic and deliberately conservative routing. Manual build/repair wins;
 * auto enters the minimal bootstrap only when one clear intent is present.
 * Model family is recorded for observability, not used as an admission input:
 * rc8 resolves a per-session model after prompt assembly, too late to safely
 * change the first-step permission surface.
 */
export function resolveAdaptiveRoute(input: AdaptiveRouteInput): GodotAdaptiveState {
  const modelClass = classifyGodotModel(input.model)

  if (input.selection === 'build' || input.selection === 'repair') {
    return createState(input, input.selection, 'bootstrap', 'manual', 'manual-selection', modelClass)
  }

  const text = normalize(input.text ?? '')
  if (!text) return createState(input, 'classic', 'full', 'fallback', 'empty-or-attachment-only', modelClass)

  const score = scoreAdaptiveRequest(text)
  if (score.build > 0 && score.repair === 0) {
    return createState(input, 'build', 'bootstrap', 'classifier', 'clear-build-intent', modelClass)
  }
  if (score.repair > 0 && score.build === 0) {
    return createState(input, 'repair', 'bootstrap', 'classifier', 'clear-repair-intent', modelClass)
  }
  return createState(
    input,
    'classic',
    'full',
    'fallback',
    score.build > 0 && score.repair > 0 ? 'conflicting-intent' : 'low-confidence',
    modelClass,
  )
}

export function promoteAdaptiveState(state: GodotAdaptiveState, now?: string): GodotAdaptiveState {
  if (state.phase !== 'bootstrap') return state
  return {
    ...state,
    phase: 'full',
    reason: 'bootstrap-inspection-succeeded',
    updatedAt: now ?? new Date().toISOString(),
  }
}

export interface AdaptiveToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

export function renderAdaptiveBootstrapPrompt(
  route: Exclude<GodotAdaptiveRoute, 'classic'>,
  tools: readonly AdaptiveToolSchema[] = [],
): string {
  const catalog = tools.map(tool => [
    `- ${JSON.stringify(tool.name)}: ${tool.description}`,
    `  arguments: ${JSON.stringify(tool.parameters)}`,
  ].join('\n')).join('\n')
  if (route === 'build') {
    return [
      'You are a helpful software engineer assistant creating a Godot game.',
      'First do one minimal orientation check of the running Godot editor with the available read-only tools through run_code.',
      'Do not modify the project in this step. This inspection is not task completion: after it succeeds, full tools unlock on the next step and you must continue the original request in the same turn.',
      codeModeBootstrapInstructions(catalog),
    ].join('\n')
  }
  return [
    'You are a helpful software engineer assistant repairing a Godot project.',
    'First do one minimal orientation check of the running Godot editor with the available read-only tools through run_code.',
    'Do not modify the project in this step. This inspection is not task completion: after it succeeds, full tools unlock on the next step and you must continue the original request in the same turn.',
    codeModeBootstrapInstructions(catalog),
  ].join('\n')
}

export function renderAdaptiveContinuationPrompt(
  route: Exclude<GodotAdaptiveRoute, 'classic'>,
): string {
  return [
    `The Adaptive ${route} bootstrap succeeded and full Godot Creator tools are now available.`,
    'Continue executing the user\'s original request in this same turn.',
    'Do not stop at an analysis, diagnosis, or implementation plan.',
    'Load godot-ai-orchestration and no more than two task-specific domain skills, then begin the smallest write batch immediately; do not spend another step expanding the design.',
    'Only finish after performing the requested work and collecting the required read-back, run, log, and visual evidence; if execution is genuinely blocked, report the concrete blocker and evidence instead.',
  ].join('\n')
}

function codeModeBootstrapInstructions(catalog: string): string {
  return [
    '',
    '`run_code` is the only tool you may call directly. It takes `code` (the body of an async TypeScript function) and `description`.',
    'Inside `code`, call a Godot tool with `await tools["tool-name"](arguments)`. Independent reads may use `Promise.all`.',
    'Return or console.log only the evidence needed for your diagnosis or plan. A failed nested call throws `ToolCallError`.',
    'The only tools available inside this bootstrap program are:',
    catalog,
  ].join('\n')
}
