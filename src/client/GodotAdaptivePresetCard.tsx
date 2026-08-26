import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ManagedPresetAction, ManagedPresetState } from '../core/types.js'
import { GodotAdaptivePresetApi } from './api.js'

export interface GodotAdaptivePresetCardProps extends PropsRuntime<'settings.general.item'>, PropsLocale<'dsh-godot-ai'> {
  readonly api: GodotAdaptivePresetApi
}

function nextAction(state: ManagedPresetState): ManagedPresetAction | undefined {
  switch (state.kind) {
    case 'not-installed': return 'install'
    case 'sync-available': return 'sync'
    case 'base-update-available': return 'rebuild'
    default: return undefined
  }
}

function stateLabel(state: ManagedPresetState, t: TranslateNS<'dsh-godot-ai'>): string {
  switch (state.kind) {
    case 'not-installed': return t('adaptive.notInstalled')
    case 'current': return t('adaptive.current')
    case 'sync-available': return t('adaptive.syncAvailable')
    case 'base-update-available': return t('adaptive.baseUpdate')
    case 'user-modified':
    case 'broken':
    case 'unavailable': return state.reason
  }
}

export function GodotAdaptivePresetCard({ api, t }: GodotAdaptivePresetCardProps): ReactNode {
  const [state, setState] = useState<ManagedPresetState>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    try { setState(await api.state()); setError(undefined) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(false) }
  }, [api])
  useEffect(() => { void load() }, [load])
  const action = useMemo(() => state === undefined ? undefined : nextAction(state), [state])
  const mutate = async (): Promise<void> => {
    if (action === undefined) return
    setBusy(true)
    try { setState(await api.mutate(action)); setError(undefined) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(false) }
  }
  return (
    <section className="dga-integration dga-adaptive-card" aria-label={t('adaptive.aria')}>
      <div className="dga-integration-head">
        <div><div className="dga-integration-title">Godot Creator Adaptive</div><div className="dga-integration-desc">{t('adaptive.description')}</div></div>
        {action === undefined ? (
          <Button variant="outline" disabled={busy} onClick={() => { void load() }}>{busy ? t('common.checking') : t('common.refresh')}</Button>
        ) : (
          <Button variant="primary" disabled={busy} onClick={() => { void mutate() }}>{busy ? t('onboarding.saving') : t(`adaptive.action.${action}`)}</Button>
        )}
      </div>
      <p className="dga-status" data-error={error !== undefined || (state !== undefined && ['user-modified', 'broken', 'unavailable'].includes(state.kind))}>
        {error ?? (state === undefined ? t('onboarding.checking') : stateLabel(state, t))}
      </p>
      <p className="dga-integration-desc">{t('adaptive.policy')}</p>
    </section>
  )
}
