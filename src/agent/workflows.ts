import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export type WorkflowInputKind = 'text' | 'select'

export interface WorkflowInput {
  readonly id: string
  readonly label: string
  readonly kind: WorkflowInputKind
  readonly required: boolean
  readonly default?: string
  readonly options?: readonly string[]
}

export interface WorkflowStage {
  readonly id: string
  readonly goal: string
  readonly acceptance: readonly string[]
  readonly recovery: string
}

export interface WorkflowTemplate {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly inputs: readonly WorkflowInput[]
  readonly stages: readonly WorkflowStage[]
  readonly done: readonly string[]
}

export interface WorkflowCatalog {
  readonly schemaVersion: 1
  readonly templates: readonly WorkflowTemplate[]
}

const ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/
const FORBIDDEN_TEMPLATE_SOURCE = /mcp__|run_code|\btools\.|```|typescript/iu

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const extras = Object.keys(value).filter(key => !allowed.includes(key))
  if (extras.length > 0) throw new Error(`${path} has unsupported fields: ${extras.join(', ')}`)
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`)
  if (FORBIDDEN_TEMPLATE_SOURCE.test(value)) throw new Error(`${path} hard-codes an execution detail`)
  return value
}

function id(value: unknown, path: string): string {
  const parsed = text(value, path)
  if (!ID_PATTERN.test(parsed)) throw new Error(`${path} must be kebab-case`)
  return parsed
}

function textList(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${path} must be a non-empty array`)
  return Object.freeze(value.map((item, index) => text(item, `${path}[${index}]`)))
}

export function parseWorkflowCatalog(value: unknown): WorkflowCatalog {
  const root = object(value, 'workflow catalog')
  exactKeys(root, ['schemaVersion', 'templates'], 'workflow catalog')
  if (root.schemaVersion !== 1) throw new Error('workflow catalog schemaVersion must be 1')
  if (!Array.isArray(root.templates) || root.templates.length === 0) throw new Error('workflow catalog templates must be non-empty')
  const templates = root.templates.map((rawTemplate, templateIndex): WorkflowTemplate => {
    const path = `templates[${templateIndex}]`
    const template = object(rawTemplate, path)
    exactKeys(template, ['id', 'name', 'description', 'inputs', 'stages', 'done'], path)
    if (!Array.isArray(template.inputs) || template.inputs.length === 0) throw new Error(`${path}.inputs must be non-empty`)
    if (!Array.isArray(template.stages) || template.stages.length < 2) throw new Error(`${path}.stages must have at least two stages`)
    const inputs = template.inputs.map((rawInput, inputIndex): WorkflowInput => {
      const inputPath = `${path}.inputs[${inputIndex}]`
      const input = object(rawInput, inputPath)
      exactKeys(input, ['id', 'label', 'kind', 'required', 'default', 'options'], inputPath)
      if (input.kind !== 'text' && input.kind !== 'select') throw new Error(`${inputPath}.kind is unsupported`)
      if (typeof input.required !== 'boolean') throw new Error(`${inputPath}.required must be boolean`)
      const options = input.options === undefined ? undefined : textList(input.options, `${inputPath}.options`)
      if (input.kind === 'select' && options === undefined) throw new Error(`${inputPath}.options are required for select`)
      return Object.freeze({
        id: id(input.id, `${inputPath}.id`),
        label: text(input.label, `${inputPath}.label`),
        kind: input.kind,
        required: input.required,
        ...(input.default === undefined ? {} : { default: text(input.default, `${inputPath}.default`) }),
        ...(options === undefined ? {} : { options }),
      })
    })
    const stages = template.stages.map((rawStage, stageIndex): WorkflowStage => {
      const stagePath = `${path}.stages[${stageIndex}]`
      const stage = object(rawStage, stagePath)
      exactKeys(stage, ['id', 'goal', 'acceptance', 'recovery'], stagePath)
      return Object.freeze({
        id: id(stage.id, `${stagePath}.id`),
        goal: text(stage.goal, `${stagePath}.goal`),
        acceptance: textList(stage.acceptance, `${stagePath}.acceptance`),
        recovery: text(stage.recovery, `${stagePath}.recovery`),
      })
    })
    const inputIds = inputs.map(input => input.id)
    const stageIds = stages.map(stage => stage.id)
    if (new Set(inputIds).size !== inputIds.length) throw new Error(`${path} has duplicate input ids`)
    if (new Set(stageIds).size !== stageIds.length) throw new Error(`${path} has duplicate stage ids`)
    return Object.freeze({
      id: id(template.id, `${path}.id`),
      name: text(template.name, `${path}.name`),
      description: text(template.description, `${path}.description`),
      inputs: Object.freeze(inputs),
      stages: Object.freeze(stages),
      done: textList(template.done, `${path}.done`),
    })
  })
  const ids = templates.map(template => template.id)
  if (new Set(ids).size !== ids.length) throw new Error('workflow catalog has duplicate template ids')
  return Object.freeze({ schemaVersion: 1 as const, templates: Object.freeze(templates) })
}

export async function loadWorkflowCatalog(): Promise<WorkflowCatalog> {
  const candidates = [new URL('../workflows/catalog.json', import.meta.url), new URL('../../workflows/catalog.json', import.meta.url)]
  let lastError: unknown
  for (const candidate of candidates) {
    try { return parseWorkflowCatalog(JSON.parse(await readFile(fileURLToPath(candidate), 'utf8'))) }
    catch (error) {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') { lastError = error; continue }
      throw error
    }
  }
  throw new Error('dsh-godot-ai workflow catalog was not found', { cause: lastError })
}
