import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GodotIntegrationSnapshot } from '../core/types.js'
import { GodotIntegrationApi } from './api.js'

export interface GodotIntegrationCardProps extends PropsRuntime<'settings.general.item'>, PropsLocale<'dsh-godot-ai'> {
  readonly api: GodotIntegrationApi
}

function uvxLabel(snapshot: GodotIntegrationSnapshot, t: TranslateNS<'dsh-godot-ai'>): string {
  if (snapshot.uvx.kind === 'available') return snapshot.uvx.version
  if (snapshot.uvx.kind === 'missing') return t('integration.uvxMissing')
  return t('integration.uvxFailed', { reason: snapshot.uvx.reason })
}

function backendLabel(snapshot: GodotIntegrationSnapshot, t: TranslateNS<'dsh-godot-ai'>): string {
  switch (snapshot.backend.kind) {
    case 'ready': return t('integration.backendReady', { version: snapshot.backend.details.serverVersion, leases: snapshot.backend.details.activeLeaseCount })
    case 'stopped': return t('integration.backendStopped')
    case 'incompatible': return t('integration.backendIncompatible', { reason: snapshot.backend.reason })
    case 'foreign-listener': return t('integration.backendConflict', { reason: snapshot.backend.reason })
    case 'error': return t('integration.backendFailed', { reason: snapshot.backend.reason })
  }
}

function editorLabel(snapshot: GodotIntegrationSnapshot, t: TranslateNS<'dsh-godot-ai'>): string {
  switch (snapshot.editor.kind) {
    case 'connected': {
      const active = snapshot.editor.sessions.find(session => session.isActive) ?? snapshot.editor.sessions[0]
      const activeLabel = active === undefined ? '' : t('integration.editorActive', { name: active.name || active.projectPath })
      return t('integration.editorsConnected', { count: snapshot.editor.sessions.length, active: activeLabel })
    }
    case 'not-connected': return t('integration.editorNone')
    case 'unavailable': return t('integration.editorUnavailable')
    case 'unknown': return t('integration.editorFailed', { reason: snapshot.editor.reason })
  }
}

function updateLabel(snapshot: GodotIntegrationSnapshot, t: TranslateNS<'dsh-godot-ai'>): { label: string; tone: 'ok' | 'warn' | 'neutral' } {
  switch (snapshot.update.kind) {
    case 'current': return { label: t('integration.updateCurrent', { version: snapshot.update.latestVersion }), tone: 'ok' }
    case 'verified-update': return { label: t('integration.updateVerified', { version: snapshot.update.latestVersion }), tone: 'ok' }
    case 'unverified-update': return { label: t('integration.updateUnverified', { version: snapshot.update.latestVersion }), tone: 'warn' }
    case 'unavailable': return { label: t('integration.updateUnavailable', { reason: snapshot.update.reason }), tone: 'neutral' }
  }
}

export function GodotIntegrationCard({ api, t }: GodotIntegrationCardProps): ReactNode {
  const [snapshot, setSnapshot] = useState<GodotIntegrationSnapshot>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async (force: boolean): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try { setSnapshot(await (force ? api.refresh() : api.state())) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(false) }
  }, [api])

  useEffect(() => { void load(false) }, [load])
  const update = snapshot === undefined ? undefined : updateLabel(snapshot, t)

  return (
    <section className="dga-integration" aria-label={t('integration.aria')}>
      <div className="dga-integration-head">
        <div>
          <div className="dga-integration-title">Godot AI</div>
          <div className="dga-integration-desc">{t('integration.description')}</div>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => { void load(true) }}>
          {busy ? t('common.checking') : t('common.refreshStatus')}
        </Button>
      </div>
      {error === undefined ? null : <p className="dga-inline-error" role="alert">{error}</p>}
      {snapshot === undefined ? (
        <p className="dga-integration-loading">{t('integration.loading')}</p>
      ) : (
        <div className="dga-integration-grid">
          <div className="dga-fact"><span>{t('integration.testedVersion')}</span><strong>{snapshot.testedVersion}</strong></div>
          <div className="dga-fact"><span>uvx</span><strong>{uvxLabel(snapshot, t)}</strong></div>
          <div className="dga-fact"><span>Backend</span><strong>{backendLabel(snapshot, t)}</strong></div>
          <div className="dga-fact"><span>Godot / Addon</span><strong>{editorLabel(snapshot, t)}</strong></div>
          <div className="dga-fact"><span>{t('integration.update')}</span><strong data-tone={update?.tone}>{update?.label}</strong></div>
          <div className="dga-fact"><span>{t('integration.requirement')}</span><strong>≥ {snapshot.godotMinimum} · {t('integration.recommended', { version: snapshot.godotRecommended })}</strong></div>
        </div>
      )}
      <div className="dga-install-help">
        <strong>{t('integration.addonManual')}</strong>
        <span>{t('integration.addonGuide')}</span>
        <div className="dga-links">
          <a href="https://godotengine.org/asset-library/asset/5050" target="_blank" rel="noreferrer">Asset Library</a>
          <a href="https://github.com/hi-godot/godot-ai/releases/latest" target="_blank" rel="noreferrer">GitHub Release</a>
          <a href="https://docs.astral.sh/uv/getting-started/installation/" target="_blank" rel="noreferrer">{t('integration.installUv')}</a>
        </div>
      </div>
      <p className="dga-update-help">{t('integration.updateHelp')}<code>dsh plugin --profile web update dsh-godot-ai</code>{t('integration.updatePolicy')}</p>
    </section>
  )
}
