import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ManagedPresetAction, ManagedPresetState } from '../core/types.js'
import { GodotPresetApi } from './api.js'

export interface GodotPresetOnboardingProps extends PropsRuntime<'settings.onboarding'>, PropsLocale<'dsh-godot-ai'> {
  readonly api: GodotPresetApi
}

interface ViewState {
  readonly status: 'loading' | 'ready' | 'saving' | 'error'
  readonly preset?: ManagedPresetState
  readonly error?: string
}

function stateCopy(state: ManagedPresetState, t: TranslateNS<'dsh-godot-ai'>): { message: string; action?: ManagedPresetAction; actionLabel?: string; error?: boolean } {
  switch (state.kind) {
    case 'not-installed': return {
      message: t('onboarding.notInstalled'),
      action: 'install',
      actionLabel: t('onboarding.install'),
    }
    case 'sync-available': return {
      message: t('onboarding.syncAvailable', { installed: state.installedSchema, current: state.currentSchema }),
      action: 'sync',
      actionLabel: t('onboarding.sync'),
    }
    case 'base-update-available': return {
      message: t('onboarding.baseUpdate'),
      action: 'rebuild',
      actionLabel: t('onboarding.rebuild'),
    }
    case 'user-modified': return { message: state.reason, error: true }
    case 'broken': return { message: state.reason, error: true }
    case 'unavailable': return { message: state.reason, error: true }
    case 'current': return { message: t('onboarding.current') }
  }
}

export function GodotPresetOnboarding({ api, complete, t }: GodotPresetOnboardingProps): ReactNode {
  const [view, setView] = useState<ViewState>({ status: 'loading' })

  const refresh = useCallback(async (): Promise<void> => {
    setView({ status: 'loading' })
    try { setView({ status: 'ready', preset: await api.state() }) }
    catch (error) { setView({ status: 'error', error: error instanceof Error ? error.message : String(error) }) }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (view.preset?.kind === 'current') complete()
  }, [complete, view.preset?.kind])

  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const previous = appRoot.inert
    appRoot.inert = true
    return () => { appRoot.inert = previous }
  }, [])

  const copy = useMemo(() => view.preset === undefined ? undefined : stateCopy(view.preset, t), [t, view.preset])
  if (view.preset?.kind === 'current') return null

  const mutate = async (action: ManagedPresetAction): Promise<void> => {
    setView(previous => {
      const { error: _error, ...rest } = previous
      return { ...rest, status: 'saving' }
    })
    try { setView({ status: 'ready', preset: await api.mutate(action) }) }
    catch (error) {
      setView(previous => ({ ...previous, status: 'error', error: error instanceof Error ? error.message : String(error) }))
    }
  }

  const message = view.error ?? copy?.message ?? t('onboarding.checking')
  const hasError = view.status === 'error' || copy?.error === true

  return (
    <Modal open title="Godot Creator" onClose={() => { complete() }} headless className="dga-dialog">
      <div className="dga-content">
        <p className="dga-kicker">Godot × DeepSeek Harness</p>
        <h2 className="dga-title">{t('onboarding.title')}</h2>
        <p className="dga-copy">{t('onboarding.copy')}</p>
        <p className="dga-status" data-error={hasError}>{message}</p>
        <div className="dga-actions">
          <Button variant="outline" disabled={view.status === 'saving'} onClick={() => { complete() }}>{t('onboarding.later')}</Button>
          {copy?.action === undefined ? (
            <Button variant="primary" disabled={view.status === 'loading' || view.status === 'saving'} onClick={() => { void refresh() }}>{t('onboarding.recheck')}</Button>
          ) : (
            <Button variant="primary" disabled={view.status === 'saving'} onClick={() => { void mutate(copy.action as ManagedPresetAction) }}>
              {view.status === 'saving' ? t('onboarding.saving') : copy.actionLabel}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
