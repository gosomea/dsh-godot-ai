// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { installWorkspaceStyles } from '../src/client/workspace-styles.js'

afterEach(() => { document.head.replaceChildren() })

describe('Godot workspace responsive styles', () => {
  it('ships mobile sheet, touch targets, safe areas, and reduced motion', () => {
    const dispose = installWorkspaceStyles()
    const css = document.querySelector('style[data-plugin-css="dsh-godot-ai/workspace"]')?.textContent ?? ''
    expect(css).toContain('@media(max-width:640px)')
    expect(css).toContain('max-height:min(82dvh,760px)')
    expect(css).toContain('.dga-ws-icon-button{width:44px;height:44px}')
    expect(css).toContain('.dga-ws-header{height:44px')
    expect(css).toContain('env(safe-area-inset-bottom)')
    expect(css).toContain('@media(prefers-reduced-motion:reduce)')
    expect(css).toContain('data-dga-mode=godot-creator-adaptive')
    expect(css).toContain('.dga-ws-route-options')
    dispose()
    expect(document.querySelector('style[data-plugin-css="dsh-godot-ai/workspace"]')).toBeNull()
  })
})
