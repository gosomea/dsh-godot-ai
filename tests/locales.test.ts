import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.js'

describe('Godot AI locale dictionaries', () => {
  it('keeps Chinese and English key sets identical', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('localizes creator, addon, and workflow copy', () => {
    expect(en['workspace.title']).toBe('Game Workspace')
    expect(en['workspace.addonConnectedTitle']).toBe('Addon enabled')
    expect(en['workflow.2d.prompt']).toContain('Create 2D game foundation')
  })
})
