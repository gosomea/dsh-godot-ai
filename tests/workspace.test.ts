import { describe, expect, it } from 'vitest'
import type { GodotIntegrationSnapshot } from '../src/core/types.js'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type GodotAiKey } from '../src/client/locales.js'
import { presentWorkspace, workspaceWorkflows } from '../src/client/workspace.js'

function translator(dict: Record<GodotAiKey, string>): TranslateNS<'dsh-godot-ai'> {
  return ((key: GodotAiKey, params?: Record<string, unknown>) => Object.entries(params ?? {}).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), dict[key],
  )) as TranslateNS<'dsh-godot-ai'>
}

const t = translator(zh)

const base: GodotIntegrationSnapshot = {
  checkedAt: '2026-08-23T00:00:00.000Z', wrapperVersion: '0.3.0', testedVersion: '3.1.5',
  godotMinimum: '4.5', godotRecommended: '4.7',
  uvx: { kind: 'available', version: 'uvx 0.8.13' },
  backend: {
    kind: 'ready', details: {
      serverVersion: '3.1.5', attachProtocolVersion: 1, wsPort: 9500, excludeDomains: [],
      ownerType: 'attach', toolCatalogHash: 'a'.repeat(64), activeLeaseCount: 1,
    },
  },
  editor: { kind: 'not-connected' },
  update: { kind: 'current', latestVersion: '3.1.5' },
}

describe('Godot workspace presentation', () => {
  it('keeps loading, offline, ready, and playing states factual', () => {
    expect(presentWorkspace(t)).toMatchObject({ tone: 'loading', status: '正在检查' })
    expect(presentWorkspace(t, base)).toMatchObject({ tone: 'offline', status: 'Editor 离线' })
    const connected: GodotIntegrationSnapshot = {
      ...base,
      editor: { kind: 'connected', sessions: [{
        sessionId: 'game@1', name: '', godotVersion: '4.7', projectPath: '/projects/space-game',
        pluginVersion: '3.1.5', currentScene: 'res://levels/main.tscn', playState: 'playing',
        readiness: 'ready', isActive: true,
      }] },
    }
    expect(presentWorkspace(t, connected)).toMatchObject({
      tone: 'playing', status: '运行中', project: 'space-game', scene: 'main.tscn', run: '运行中',
    })

    const noScene: GodotIntegrationSnapshot = {
      ...connected,
      editor: { kind: 'connected', sessions: [{
        ...connected.editor.sessions[0]!, currentScene: '', playState: 'stopped', readiness: 'no_scene',
      }] },
    }
    expect(presentWorkspace(t, noScene)).toMatchObject({
      tone: 'warn', status: '等待场景', scene: '未打开场景', run: '未运行',
    })
    const noSceneView = presentWorkspace(t, noScene)
    expect([noSceneView.status, noSceneView.scene, noSceneView.run].join(' ')).not.toMatch(/no_scene|stopped/u)
  })

  it('ships reviewable prompts without executable tool details', () => {
    const workflows = workspaceWorkflows(t)
    expect(workflows.map(workflow => workflow.id)).toEqual([
      'create-2d-game-foundation', 'create-3d-prototype', 'add-game-ui-flow',
    ])
    expect(JSON.stringify(workflows)).not.toMatch(/mcp__|run_code|\btools\.|```|typescript/iu)
  })

  it('renders the same states and workflows in English', () => {
    const english = translator(en)
    expect(presentWorkspace(english, base)).toMatchObject({ status: 'Editor offline', project: 'Open Godot and enable the Addon' })
    expect(workspaceWorkflows(english)[0]).toMatchObject({ title: 'Create game foundation' })
  })
})
