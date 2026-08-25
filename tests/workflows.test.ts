import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadWorkflowCatalog, parseWorkflowCatalog } from '../src/agent/workflows.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('Godot Creator workflow catalog', () => {
  it('loads declarative templates without executable tool details', async () => {
    const catalog = await loadWorkflowCatalog()
    expect(catalog.templates.map(template => template.id)).toEqual([
      'create-2d-game-foundation',
      'create-3d-prototype',
      'add-game-ui-flow',
    ])
    expect(catalog.templates.every(template => template.stages.length >= 2)).toBe(true)

    const source = await readFile(join(root, 'workflows/catalog.json'), 'utf8')
    expect(source).not.toMatch(/mcp__|run_code|\btools\.|```|typescript/iu)
  })

  it('rejects extra fields, duplicate ids, and hard-coded execution details', () => {
    const valid = {
      schemaVersion: 1,
      templates: [{
        id: 'valid-flow', name: 'Valid', description: 'Goal only',
        inputs: [{ id: 'gameplay', label: 'Gameplay', kind: 'text', required: true }],
        stages: [
          { id: 'discover', goal: 'Inspect the project', acceptance: ['Context known'], recovery: 'Stop safely' },
          { id: 'verify', goal: 'Verify the result', acceptance: ['Result known'], recovery: 'Retry the phase' },
        ],
        done: ['Accepted'],
      }],
    }
    expect(() => parseWorkflowCatalog({ ...valid, command: 'execute' })).toThrow(/unsupported fields/)
    expect(() => parseWorkflowCatalog({ ...valid, templates: [...valid.templates, valid.templates[0]] })).toThrow(/duplicate template ids/)
    expect(() => parseWorkflowCatalog({
      ...valid,
      templates: [{ ...valid.templates[0], description: 'Call tools.node_create now' }],
    })).toThrow(/execution detail/)
  })
})
