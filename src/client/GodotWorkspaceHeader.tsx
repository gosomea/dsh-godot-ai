import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { GodotIntegrationSnapshot } from '../core/types.js'
import { GODOT_PRESET_ID } from '../core/types.js'
import { GodotIntegrationApi } from './api.js'
import { GODOT_ICON_DATA_URL } from './godot-icon.js'
import { presentWorkspace, workspaceWorkflows } from './workspace.js'

export interface GodotWorkspaceHeaderProps extends PropsRuntime<'conversation.session.header.actions'>, PropsLocale<'dsh-godot-ai'> {
  readonly api: GodotIntegrationApi
}

const themedSessions = new Set<string>()

function activateTheme(sessionId: string): () => void {
  themedSessions.add(sessionId)
  document.documentElement.dataset.dgaMode = GODOT_PRESET_ID
  return () => {
    themedSessions.delete(sessionId)
    if (themedSessions.size === 0) delete document.documentElement.dataset.dgaMode
  }
}

function backendDetail(snapshot: GodotIntegrationSnapshot, t: TranslateNS<'dsh-godot-ai'>): string {
  switch (snapshot.backend.kind) {
    case 'ready': return t('backend.ready', { version: snapshot.backend.details.serverVersion, leases: snapshot.backend.details.activeLeaseCount })
    case 'stopped': return t('backend.stopped')
    case 'foreign-listener': return snapshot.backend.reason
    case 'incompatible': return snapshot.backend.reason
    case 'error': return snapshot.backend.reason
  }
}

function updateDetail(snapshot: GodotIntegrationSnapshot, t: TranslateNS<'dsh-godot-ai'>): string {
  switch (snapshot.update.kind) {
    case 'current': return t('update.current', { version: snapshot.update.latestVersion })
    case 'verified-update': return t('update.verified', { version: snapshot.update.latestVersion })
    case 'unverified-update': return t('update.unverified', { version: snapshot.update.latestVersion })
    case 'unavailable': return t('update.unavailable')
  }
}

interface DrawerProps {
  readonly snapshot: GodotIntegrationSnapshot | undefined
  readonly busy: boolean
  readonly error: string | undefined
  readonly draftOccupied: boolean
  readonly onClose: () => void
  readonly onReturnFocus: () => void
  readonly onRefresh: () => void
  readonly onDraft: (prompt: string) => void
  readonly t: TranslateNS<'dsh-godot-ai'>
}

function GodotWorkspaceDrawer({ snapshot, busy, error, draftOccupied, onClose, onReturnFocus, onRefresh, onDraft, t }: DrawerProps): ReactNode {
  const titleId = useId()
  const view = presentWorkspace(t, snapshot)
  const workflows = workspaceWorkflows(t)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { onClose(); return }
      if (event.key !== 'Tab') return
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])') ?? [])]
      if (focusable.length === 0) { event.preventDefault(); return }
      const first = focusable[0]!
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); onReturnFocus() }
  }, [onClose, onReturnFocus])

  return createPortal(
    <div className="dga-ws-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <aside ref={dialogRef} className="dga-ws-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dga-ws-drawer-head">
          <div className="dga-ws-brand">
            <img src={GODOT_ICON_DATA_URL} alt="" width="36" height="36" />
            <div><span>GODOT CREATOR</span><h2 id={titleId}>{t('workspace.title')}</h2></div>
          </div>
          <button autoFocus type="button" className="dga-ws-icon-button" aria-label={t('workspace.close')} onClick={onClose}>
            <svg viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </header>

        <div className="dga-ws-scroll">
          <section className="dga-ws-overview" data-tone={view.tone}>
            <div className="dga-ws-overview-top"><span className="dga-ws-status-dot" /><strong>{view.status}</strong><span>{snapshot?.checkedAt === undefined ? t('workspace.readingLocal') : t('workspace.lastChecked')}</span></div>
            <div className="dga-ws-project">{view.project}</div>
            <div className="dga-ws-scene"><code>{view.scene}</code><span>{view.run}</span></div>
          </section>

          {error === undefined ? null : <p className="dga-ws-error" role="alert">{error}</p>}

          <section className="dga-ws-section">
            <div className="dga-ws-section-title"><span>{t('workspace.connection')}</span><button type="button" disabled={busy} onClick={onRefresh}>{busy ? t('common.checking') : t('common.refresh')}</button></div>
            <dl className="dga-ws-facts">
              <div><dt>uvx</dt><dd>{snapshot === undefined ? '—' : snapshot.uvx.kind === 'available' ? snapshot.uvx.version : snapshot.uvx.kind === 'missing' ? t('workspace.notInstalled') : t('workspace.checkFailed')}</dd></div>
              <div><dt>Backend</dt><dd>{snapshot === undefined ? '—' : backendDetail(snapshot, t)}</dd></div>
              <div><dt>Editor / Addon</dt><dd>{view.active === undefined ? t('workspace.notConnected') : `${view.active.godotVersion} · Addon ${view.active.pluginVersion}`}</dd></div>
            </dl>
          </section>

          <section className="dga-ws-section">
            <div className="dga-ws-section-title"><span>{t('workspace.workflows')}</span></div>
            <div className="dga-ws-workflows">
              {workflows.map(workflow => (
                <button key={workflow.id} type="button" disabled={draftOccupied} onClick={() => { onDraft(workflow.prompt) }}>
                  <span className="dga-ws-workflow-tag">{workflow.eyebrow}</span>
                  <span><strong>{workflow.title}</strong><small>{workflow.description}</small></span>
                  <svg viewBox="0 0 16 16" aria-hidden><path d="M3 8h10m-4-4 4 4-4 4" /></svg>
                </button>
              ))}
            </div>
            <p className="dga-ws-workflow-help">{draftOccupied ? t('workspace.draftOccupied') : t('workspace.draftSafe')}</p>
          </section>

          <section className="dga-ws-section">
            <div className="dga-ws-section-title"><span>{t('workspace.versions')}</span></div>
            <dl className="dga-ws-facts">
              <div><dt>Wrapper</dt><dd>{snapshot?.wrapperVersion ?? '0.4.1'}</dd></div>
              <div><dt>Tested backend</dt><dd>{snapshot?.testedVersion ?? '3.1.5'}</dd></div>
              <div><dt>Update</dt><dd>{snapshot === undefined ? '—' : updateDetail(snapshot, t)}</dd></div>
            </dl>
          </section>

          {view.active === undefined ? (
            <div className="dga-ws-addon-note"><strong>{t('workspace.addonInstallTitle')}</strong><span>{t('workspace.addonInstallCopy')}</span></div>
          ) : (
            <div className="dga-ws-addon-note" data-connected="true"><strong>{t('workspace.addonConnectedTitle')}</strong><span>{t('workspace.addonConnectedCopy', { project: view.project })}</span></div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}

export function GodotWorkspaceHeader({ sessionId, useSessions, useInput, inputActions, api, t }: GodotWorkspaceHeaderProps): ReactNode {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const draftOccupied = useInput(state => state.draft.trim() !== '')
  const creator = preset === GODOT_PRESET_ID
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<GodotIntegrationSnapshot>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const triggerRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async (force: boolean, background = false): Promise<void> => {
    if (!background) { setBusy(true); setError(undefined) }
    try { setSnapshot(await (force ? api.refresh() : api.state())) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { if (!background) setBusy(false) }
  }, [api])

  useEffect(() => creator ? activateTheme(sessionId) : undefined, [creator, sessionId])
  useEffect(() => {
    if (!creator) return undefined
    void load(false)
    const timer = window.setInterval(() => { void load(false, true) }, 5_000)
    return () => { window.clearInterval(timer) }
  }, [creator, load])
  useEffect(() => { if (!creator) setOpen(false) }, [creator])

  const close = useCallback((): void => { setOpen(false) }, [])
  const returnFocus = useCallback((): void => { triggerRef.current?.focus() }, [])

  if (!creator) return null
  const view = presentWorkspace(t, snapshot)

  return (
    <>
      <button ref={triggerRef} type="button" className="dga-ws-header" data-tone={view.tone} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        <img src={GODOT_ICON_DATA_URL} alt="" width="18" height="18" />
        <span className="dga-ws-header-name">Godot Creator</span>
        <span className="dga-ws-header-project">{view.project}</span>
        <span className="dga-ws-status-dot" aria-label={view.status} />
      </button>
      {open && <GodotWorkspaceDrawer
        snapshot={snapshot} busy={busy} error={error} draftOccupied={draftOccupied}
        onClose={close} onReturnFocus={returnFocus} onRefresh={() => { void load(true) }}
        onDraft={(prompt) => { inputActions.setDraft(prompt); close() }} t={t}
      />}
    </>
  )
}
