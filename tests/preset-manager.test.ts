import { describe, expect, it } from 'vitest'
import { GodotPresetManager } from '../src/host/preset-manager.js'

describe('declarative Godot preset status', () => {
  it('reports the bundle declaration as current without writing files', async () => {
    const manager = new GodotPresetManager({ resolve: async id => ({ id: id! }) }, '0.7.0')
    expect(await manager.state()).toEqual({ kind: 'current', wrapperVersion: '0.7.0', installedSchema: 2 })
  })
  it('exposes an activation failure rather than claiming installation succeeded', async () => {
    const manager = new GodotPresetManager({ resolve: async id => ({ id: id!, broken: 'PTC runtime missing' }) }, '0.7.0')
    expect(await manager.state()).toEqual({ kind: 'broken', reason: 'PTC runtime missing' })
  })
  it('reports missing declarations without creating a parallel legacy preset', async () => {
    const manager = new GodotPresetManager({ resolve: async () => { throw new Error('not declared') } }, '0.7.0')
    expect(await manager.state()).toEqual({ kind: 'unavailable', reason: 'not declared' })
    expect('install' in manager).toBe(false)
    expect('uninstall' in manager).toBe(false)
  })
})
