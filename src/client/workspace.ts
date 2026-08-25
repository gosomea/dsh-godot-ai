import type { GodotEditorSession, GodotIntegrationSnapshot } from '../core/types.js'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

export type WorkspaceTone = 'loading' | 'ready' | 'playing' | 'warn' | 'offline'

export interface WorkspacePresentation {
  readonly tone: WorkspaceTone
  readonly status: string
  readonly project: string
  readonly scene: string
  readonly run: string
  readonly active?: GodotEditorSession
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
}

export function activeEditor(snapshot: GodotIntegrationSnapshot): GodotEditorSession | undefined {
  if (snapshot.editor.kind !== 'connected') return undefined
  return snapshot.editor.sessions.find(session => session.isActive) ?? snapshot.editor.sessions[0]
}

function readinessLabel(readiness: string, t: TranslateNS<'dsh-godot-ai'>): string {
  switch (readiness.toLowerCase()) {
    case 'ready': return t('workspace.readiness.ready')
    case 'no_scene': return t('workspace.readiness.noScene')
    case 'importing': return t('workspace.readiness.importing')
    case 'reloading': return t('workspace.readiness.reloading')
    case 'busy': return t('workspace.readiness.busy')
    default: return t('workspace.readiness.preparing')
  }
}

function playStateLabel(playState: string, t: TranslateNS<'dsh-godot-ai'>): string {
  switch (playState.toLowerCase()) {
    case 'playing':
    case 'running': return t('workspace.run.playing')
    case 'paused': return t('workspace.run.paused')
    case 'stopped':
    case 'idle':
    case '': return t('workspace.run.stopped')
    default: return t('workspace.run.unknown')
  }
}

export function presentWorkspace(t: TranslateNS<'dsh-godot-ai'>, snapshot?: GodotIntegrationSnapshot): WorkspacePresentation {
  if (snapshot === undefined) return {
    tone: 'loading', status: t('workspace.loading.status'), project: t('workspace.loading.project'), scene: '—', run: '—',
  }
  if (snapshot.backend.kind === 'foreign-listener') return {
    tone: 'warn', status: t('workspace.portConflict.status'), project: t('workspace.portConflict.project'), scene: '—', run: '—',
  }
  if (snapshot.backend.kind === 'incompatible') return {
    tone: 'warn', status: t('workspace.incompatible.status'), project: t('workspace.incompatible.project'), scene: '—', run: '—',
  }
  if (snapshot.backend.kind === 'error') return {
    tone: 'warn', status: t('workspace.failed.status'), project: t('workspace.failed.project'), scene: '—', run: '—',
  }
  if (snapshot.backend.kind === 'stopped') return {
    tone: 'offline', status: t('workspace.stopped.status'), project: t('workspace.stopped.project'), scene: '—', run: '—',
  }
  const active = activeEditor(snapshot)
  if (active === undefined) return {
    tone: 'offline', status: t('workspace.offline.status'), project: t('workspace.offline.project'), scene: '—', run: '—',
  }
  const playing = /play|run/i.test(active.playState)
  return {
    tone: playing ? 'playing' : active.readiness === 'ready' ? 'ready' : 'warn',
    status: playing ? t('workspace.run.playing') : readinessLabel(active.readiness, t),
    project: active.name || basename(active.projectPath) || t('workspace.unnamedProject'),
    scene: basename(active.currentScene) || t('workspace.noScene'),
    run: playStateLabel(active.playState, t),
    active,
  }
}

export interface WorkspaceWorkflow {
  readonly id: string
  readonly eyebrow: string
  readonly title: string
  readonly description: string
  readonly prompt: string
}

export function workspaceWorkflows(t: TranslateNS<'dsh-godot-ai'>): readonly WorkspaceWorkflow[] { return [
  {
    id: 'create-2d-game-foundation', eyebrow: '2D', title: t('workflow.2d.title'),
    description: t('workflow.2d.description'), prompt: t('workflow.2d.prompt'),
  },
  {
    id: 'create-3d-prototype', eyebrow: '3D', title: t('workflow.3d.title'),
    description: t('workflow.3d.description'), prompt: t('workflow.3d.prompt'),
  },
  {
    id: 'add-game-ui-flow', eyebrow: 'UI', title: t('workflow.ui.title'),
    description: t('workflow.ui.description'), prompt: t('workflow.ui.prompt'),
  },
] }
