// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ variant: _variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => <button {...props} />,
}))

import { GodotSkillMarketCard } from '../src/client/GodotSkillMarketCard.js'
import type { SkillMarketStateResponse } from '../src/client/api.js'

afterEach(cleanup)

const state: SkillMarketStateResponse = {
  market: {
    schemaVersion: 1,
    scannerRulesVersion: '2026-08-27.1',
    revision: 2,
    installed: {},
    catalog: [{
      id: 'game-feel', title: 'Game Feel', description: 'Improve feedback.', version: '1.0.0',
      source: { owner: 'owner', repo: 'repo', commit: '1'.repeat(40), subdir: 'skills/game-feel' },
      artifactSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64),
      license: { id: 'Apache-2.0', noticeRequired: true }, upstreamStatus: 'active',
      compatibility: 'godot-compatible', decision: 'recommended', installable: true,
      defaultSelected: true, externalRequirements: [],
    }],
    starterSkillIds: ['game-feel', 'game-ui-ux', 'game-ui-design'],
    securityBoundary: '静态扫描不是沙箱。',
  },
  inspections: [],
}

describe('Godot Skill Market card', () => {
  it('renders four explicit workflow tabs and keeps GitHub import in review-first language', async () => {
    const api = { state: vi.fn(async () => state), inspect: vi.fn(), install: vi.fn(), action: vi.fn() }
    render(<GodotSkillMarketCard {...{ api } as never} />)
    await screen.findByText('Godot Skill 市场')
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    expect(screen.getByText('静态扫描不是沙箱。')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '精选' }))
    expect(screen.getByText('Godot 游戏设计增强包')).toBeTruthy()
    expect(screen.getByText('Game Feel')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'GitHub 导入' }))
    expect(screen.getByRole('button', { name: '下载并审阅' })).toBeTruthy()
    expect(screen.getByText(/不会运行仓库安装器或脚本/)).toBeTruthy()
    await waitFor(() => { expect(api.state).toHaveBeenCalledTimes(1) })
  })
})
