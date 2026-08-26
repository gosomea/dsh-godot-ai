import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  admitAdaptiveGodotToolCall,
  admitAdaptiveGodotSkill,
  extractAdaptiveTarget,
  foldAdaptiveSession,
  guardAdaptiveProjectRun,
} from '../src/agent/adaptive-runtime.js'
import { resolveAdaptiveRoute } from '../src/agent/adaptive-routing.js'

const event = <T extends SessionEvent['type']>(type: T, data: Extract<SessionEvent, { type: T }>['data'], seq: number): SessionEvent => ({
  type,
  data,
  seq,
  time: seq,
} as SessionEvent)

describe('Godot Adaptive durable state fold', () => {
  it('defaults to auto and no decision', () => {
    expect(foldAdaptiveSession([])).toEqual({ selection: 'auto' })
  })

  it('uses the latest manual selection until a route is logged', () => {
    const events = [
      event('godot-ai/adaptive-selection', { selection: 'build', updatedAt: '1' }, 0),
      event('godot-ai/adaptive-selection', { selection: 'repair', updatedAt: '2' }, 1),
    ]
    expect(foldAdaptiveSession(events)).toEqual({ selection: 'repair' })
  })

  it('restores the latest route and clears it after a newer selection', () => {
    const state = resolveAdaptiveRoute({ selection: 'build', model: 'pro', now: '1' })
    expect(foldAdaptiveSession([event('godot-ai/adaptive-route', state, 0)])).toEqual({ selection: 'build', state })
    expect(foldAdaptiveSession([
      event('godot-ai/adaptive-route', state, 0),
      event('godot-ai/adaptive-selection', { selection: 'auto', updatedAt: '2' }, 1),
    ])).toEqual({ selection: 'auto' })
  })
})

describe('Godot Adaptive per-turn skill budget', () => {
  it('allows orchestration and two distinct domains, then rejects more Godot domains', () => {
    const loaded = new Set<string>()
    expect(admitAdaptiveGodotSkill(loaded, 'godot-ai-orchestration')).toBeUndefined()
    expect(admitAdaptiveGodotSkill(loaded, 'godot-gdscript')).toBeUndefined()
    expect(admitAdaptiveGodotSkill(loaded, 'godot-2d-movement')).toBeUndefined()
    expect(admitAdaptiveGodotSkill(loaded, 'godot-ui-control')).toContain('at most two Godot domain skills')
    expect([...loaded]).toEqual(['godot-ai-orchestration', 'godot-gdscript', 'godot-2d-movement'])
  })

  it('does not charge repeats or non-Godot skills against the domain budget', () => {
    const loaded = new Set(['godot-ai-orchestration', 'godot-gdscript', 'godot-2d-movement'])
    expect(admitAdaptiveGodotSkill(loaded, 'godot-gdscript')).toContain('already loaded')
    expect(admitAdaptiveGodotSkill(loaded, 'plan-and-phase')).toBeUndefined()
  })
})

describe('Godot Adaptive explicit target run guard', () => {
  const target = 'validation_games/rc8_matrix/08-ui-animation-flash-adaptive-1'

  it('extracts the isolated matrix target from the user request', () => {
    expect(extractAdaptiveTarget(`只在 ${target} 内创建 UI`)).toBe(target)
    expect(extractAdaptiveTarget('创建一个普通项目')).toBeUndefined()
  })

  it('requires custom mode and a scene below the isolated target', () => {
    expect(guardAdaptiveProjectRun(target, {
      mode: 'custom',
      scene: `res://${target}/main.tscn`,
    })).toBeUndefined()
    expect(guardAdaptiveProjectRun(target, { mode: 'current' })).toContain('mode="custom"')
    expect(guardAdaptiveProjectRun(target, {
      mode: 'custom',
      scene: 'res://main.tscn',
    })).toContain(`res://${target}/`)
  })
})

describe('Godot Adaptive per-turn verification budget', () => {
  it('rejects a fourth identical Godot request even when object key order changes', () => {
    const calls = new Map<string, number>()
    const name = 'mcp__godot-ai-adaptive__game_manage'
    expect(admitAdaptiveGodotToolCall(calls, name, { op: 'get_node_info', params: { path: '/Player' } })).toBeUndefined()
    expect(admitAdaptiveGodotToolCall(calls, name, { params: { path: '/Player' }, op: 'get_node_info' })).toBeUndefined()
    expect(admitAdaptiveGodotToolCall(calls, name, { op: 'get_node_info', params: { path: '/Player' } })).toBeUndefined()
    expect(admitAdaptiveGodotToolCall(calls, name, { op: 'get_node_info', params: { path: '/Player' } })).toContain('three times')
  })

  it('allows one diagnosis and one verification launch, then rejects more', () => {
    const calls = new Map<string, number>()
    const name = 'mcp__godot-ai-adaptive__project_run'
    expect(admitAdaptiveGodotToolCall(calls, name, { mode: 'custom', scene: 'res://before.tscn' })).toBeUndefined()
    expect(admitAdaptiveGodotToolCall(calls, name, { mode: 'custom', scene: 'res://after.tscn' })).toBeUndefined()
    expect(admitAdaptiveGodotToolCall(calls, name, { mode: 'custom', scene: 'res://third.tscn' })).toContain('at most two project launches')
  })

  it('caps unique game_eval probes and ignores non-Adaptive tools', () => {
    const calls = new Map<string, number>()
    expect(admitAdaptiveGodotToolCall(calls, 'read', { file_path: 'x' })).toBeUndefined()
    for (let index = 0; index < 8; index += 1) {
      expect(admitAdaptiveGodotToolCall(calls, 'mcp__godot-ai-adaptive__editor_manage', {
        op: 'game_eval',
        params: { code: `return ${index}` },
      })).toBeUndefined()
    }
    expect(admitAdaptiveGodotToolCall(calls, 'mcp__godot-ai-adaptive__editor_manage', {
      op: 'game_eval',
      params: { code: 'return 9' },
    })).toContain('at most eight game_eval calls')
  })
})
