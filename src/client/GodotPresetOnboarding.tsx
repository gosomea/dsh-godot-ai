import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { GodotPresetApi } from './api.js'

export interface GodotPresetOnboardingProps extends PropsRuntime<'settings.onboarding'>, PropsLocale<'dsh-godot-ai'> {
  readonly api: GodotPresetApi
}

/** The preset is supplied by the bundle. Onboarding never writes the profile or disables the app. */
export function GodotPresetOnboarding({ api, complete, t }: GodotPresetOnboardingProps): ReactNode {
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    void api.state().then(state => {
      if (!active) return
      if (state.kind === 'current') complete()
      else if ('reason' in state) setError(state.reason)
    }).catch(caught => { if (active) setError(String(caught)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, complete])
  if (loading || error === undefined) return null
  return <Modal open title="Godot Creator" onClose={complete} headless className="dga-dialog">
    <div className="dga-content"><h2 className="dga-title">{t('onboarding.title')}</h2>
      <p className="dga-status" role="alert">{error}</p>
      <p className="dga-copy">{t('onboarding.copy')}</p>
      <Button variant="outline" onClick={complete}>{t('onboarding.later')}</Button>
    </div>
  </Modal>
}
