import { describe, expect, it } from 'vitest'
import {
  classifyGodotModel,
  promoteAdaptiveState,
  renderAdaptiveBootstrapPrompt,
  renderAdaptiveContinuationPrompt,
  resolveAdaptiveRoute,
  scoreAdaptiveRequest,
} from '../src/agent/adaptive-routing.js'

const NOW = '2026-08-26T00:00:00.000Z'

describe('Godot Creator Adaptive routing', () => {
  it('classifies current DeepSeek model families without exact model ids', () => {
    expect(classifyGodotModel('deepseek-v4-pro-ioa')).toBe('pro')
    expect(classifyGodotModel('deepseek-v4-flash-ioa')).toBe('flash')
    expect(classifyGodotModel('something-else')).toBe('other')
  })

  it('recognizes clear Chinese and English build/repair intent', () => {
    expect(scoreAdaptiveRequest('从零创建一个 2D 平台游戏')).toEqual({ build: 2, repair: 0 })
    expect(scoreAdaptiveRequest('Fix this crash and inspect the error')).toEqual({ build: 0, repair: 3 })
  })

  it('routes clear auto requests through minimal bootstrap for either model family', () => {
    expect(resolveAdaptiveRoute({ selection: 'auto', model: 'deepseek-v4-pro-ioa', text: '新建一个塔防游戏', now: NOW }))
      .toMatchObject({ route: 'build', phase: 'bootstrap', source: 'classifier', reason: 'clear-build-intent' })
    expect(resolveAdaptiveRoute({ selection: 'auto', model: 'deepseek-v4-pro-ioa', text: '修复运行时报错', now: NOW }))
      .toMatchObject({ route: 'repair', phase: 'bootstrap', source: 'classifier', reason: 'clear-repair-intent' })
    expect(resolveAdaptiveRoute({ selection: 'auto', model: 'deepseek-v4-flash-ioa', text: '创建游戏', now: NOW }))
      .toMatchObject({ route: 'build', phase: 'bootstrap', modelClass: 'flash' })
  })

  it('keeps conflicts and attachment-only requests classic regardless of model family', () => {
    expect(resolveAdaptiveRoute({ selection: 'auto', model: 'deepseek-v4-pro-ioa', text: '创建后修复错误', now: NOW }))
      .toMatchObject({ route: 'classic', phase: 'full', reason: 'conflicting-intent' })
    expect(resolveAdaptiveRoute({ selection: 'auto', model: 'deepseek-v4-pro-ioa', text: '   ', now: NOW }))
      .toMatchObject({ route: 'classic', phase: 'full', reason: 'empty-or-attachment-only' })
  })

  it('lets an explicit user selection override auto intent classification', () => {
    expect(resolveAdaptiveRoute({ selection: 'repair', model: 'deepseek-v4-flash-ioa', text: '', now: NOW }))
      .toMatchObject({ route: 'repair', phase: 'bootstrap', source: 'manual' })
  })

  it('promotes once and preserves the resolved route', () => {
    const bootstrap = resolveAdaptiveRoute({ selection: 'build', model: 'deepseek-v4-pro-ioa', now: NOW })
    const full = promoteAdaptiveState(bootstrap, '2026-08-26T00:00:01.000Z')
    expect(full).toMatchObject({
      route: 'build',
      phase: 'full',
      reason: 'bootstrap-inspection-succeeded',
      updatedAt: '2026-08-26T00:00:01.000Z',
    })
    expect(promoteAdaptiveState(full, 'later')).toBe(full)
  })

  it('uses read-only evidence-first prompts for both adaptive routes', () => {
    for (const route of ['build', 'repair'] as const) {
      const prompt = renderAdaptiveBootstrapPrompt(route, [{ name: 'mcp__godot-ai-adaptive__editor_state', description: 'Read state', parameters: { type: 'object' } }])
      expect(prompt).toContain('read-only tools')
      expect(prompt).toContain('Do not modify the project')
      expect(prompt).toContain('continue the original request in the same turn')
      expect(prompt).toContain('`run_code` is the only tool you may call directly')
      expect(prompt).toContain('mcp__godot-ai-adaptive__editor_state')
    }
  })

  it('forces the post-bootstrap step to execute instead of ending at a plan', () => {
    for (const route of ['build', 'repair'] as const) {
      const prompt = renderAdaptiveContinuationPrompt(route)
      expect(prompt).toContain('Continue executing the user\'s original request in this same turn')
      expect(prompt).toContain('Do not stop at an analysis, diagnosis, or implementation plan')
      expect(prompt).toContain('no more than two task-specific domain skills')
      expect(prompt).toContain('visual evidence')
    }
  })
})
