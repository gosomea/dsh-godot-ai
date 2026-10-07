// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GodotIntegrationSnapshot } from '../src/core/types.js'
import { GodotWorkspaceHeader } from '../src/client/GodotWorkspaceHeader.js'
import { zh, type GodotAiKey } from '../src/client/locales.js'

const t = (key: GodotAiKey, params?: Record<string, unknown>): string => Object.entries(params ?? {}).reduce(
  (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), zh[key],
)

const snapshot: GodotIntegrationSnapshot = {
  checkedAt: '2026-08-23T00:00:00.000Z', wrapperVersion: '0.3.0', testedVersion: '3.1.5',
  godotMinimum: '4.5', godotRecommended: '4.7', uvx: { kind: 'available', version: 'uvx 0.8.13' },
  backend: {
    kind: 'ready', details: {
      serverVersion: '3.1.5', attachProtocolVersion: 1, wsPort: 9500, excludeDomains: [],
      ownerType: 'attach', toolCatalogHash: 'a'.repeat(64), activeLeaseCount: 1,
    },
  },
  editor: { kind: 'connected', sessions: [{
    sessionId: 'game@1', name: 'Space Garden', godotVersion: '4.7', projectPath: '/projects/space-garden',
    pluginVersion: '3.1.5', currentScene: 'res://main.tscn', playState: 'stopped', readiness: 'ready', isActive: true,
  }] },
  update: { kind: 'current', latestVersion: '3.1.5' },
}

function props(preset = 'godot-creator', draft = '') {
  const setDraft = vi.fn()
  return {
    setDraft,
    value: {
      sessionId: 'session-1',
      useSessions: (select: (state: unknown) => unknown) => select({ byId: { 'session-1': { projectionValues: { agentPreset: preset } } } }),
      useInput: (select: (state: unknown) => unknown) => select({ draft }),
      inputActions: { setDraft },
      api: { state: vi.fn(async () => snapshot), refresh: vi.fn(async () => snapshot) },
      t,
    },
  }
}

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.dgaMode
})

describe('Godot Creator workspace header', () => {
  it('is absent outside the godot-creator session scope', () => {
    const { value } = props('standard')
    const { container } = render(<GodotWorkspaceHeader {...value as never} />)
    expect(container.textContent).toBe('')
    expect(document.documentElement.dataset.dgaMode).toBeUndefined()
  })

  it('opens the drawer and inserts a reviewed workflow into an empty composer', async () => {
    const { value, setDraft } = props()
    const rendered = render(<GodotWorkspaceHeader {...value as never} />)
    await screen.findByText('Space Garden')
    expect(document.documentElement.dataset.dgaMode).toBe('godot-creator')

    fireEvent.click(screen.getByRole('button', { name: /Godot Creator/ }))
    expect(screen.getByRole('dialog', { name: '游戏创作台' })).toBeTruthy()
    expect(screen.getByText('Addon 已启用')).toBeTruthy()
    expect(screen.queryByText('Addon 由你安装和启用')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /创建游戏骨架/ }))
    expect(setDraft).toHaveBeenCalledWith(expect.stringContaining('创建 2D 游戏骨架'))
    expect(screen.queryByRole('dialog')).toBeNull()

    rendered.unmount()
    await waitFor(() => { expect(document.documentElement.dataset.dgaMode).toBeUndefined() })
  })

  it('protects an existing draft and closes with Escape', async () => {
    const { value, setDraft } = props('godot-creator', 'my current draft')
    render(<GodotWorkspaceHeader {...value as never} />)
    await screen.findByText('Space Garden')
    fireEvent.click(screen.getByRole('button', { name: /Godot Creator/ }))
    expect((screen.getByRole('button', { name: /创建游戏骨架/ }) as HTMLButtonElement).disabled).toBe(true)
    const opener = screen.getByRole('button', { name: /Godot Creator/ })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(setDraft).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(opener)
  })

  it('does not mount a legacy Adaptive theme', () => {
    const { value } = props('godot-creator-adaptive')
    const { container } = render(<GodotWorkspaceHeader {...value as never} />)
    expect(container.textContent).toBe('')
    expect(document.documentElement.dataset.dgaMode).toBeUndefined()
  })
})
