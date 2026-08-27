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
    candidateNotices: [],
    starterSkillIds: ['game-feel', 'game-ui-ux', 'game-ui-design'],
    trash: [],
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

  it('exposes staged review, rollback, discard, and recoverable trash actions', async () => {
    const artifactHash = 'c'.repeat(64)
    const inspectionId = '1'.repeat(36)
    const richState: SkillMarketStateResponse = {
      market: {
        ...state.market,
        revision: 4,
        catalog: [],
        installed: {
          'game-feel': {
            source: { kind: 'curated', catalogSerial: 2, skillId: 'game-feel' }, state: 'ready',
            activeArtifactHash: 'd'.repeat(64), activeVersion: '2.0.0', enabled: false,
            modelInvocable: false, userInvocable: false, installedAt: '2026-08-27T00:00:00.000Z',
            updatedAt: '2026-08-27T01:00:00.000Z', scannerRulesVersion: '2026-08-27.1',
            riskReportHash: 'e'.repeat(64), approvalHash: 'f'.repeat(64), acknowledgedFindingIds: [],
            history: [{
              source: { kind: 'curated', catalogSerial: 1, skillId: 'game-feel' }, artifactHash,
              version: '1.0.0', activatedAt: '2026-08-27T00:00:00.000Z', scannerRulesVersion: '2026-08-27.1',
              riskReportHash: 'a'.repeat(64), approvalHash: 'b'.repeat(64), acknowledgedFindingIds: [],
            }],
          },
        },
        trash: [{
          schemaVersion: 1, trashId: 'trash-one', kind: 'artifact', originalName: artifactHash,
          artifactHash, trashedAt: '2026-08-27T02:00:00.000Z', purgeAfter: '2026-09-03T02:00:00.000Z',
        }],
      },
      inspections: [{
        schemaVersion: 1, inspectionId, state: 'ready', skillId: 'game-feel', version: '3.0.0',
        source: { kind: 'curated', catalogSerial: 3, skillId: 'game-feel' },
        resolvedSource: { owner: 'owner', repo: 'repo', ref: 'main', commit: '1'.repeat(40), subdir: 'skills/game-feel' },
        artifactHash: '9'.repeat(64), createdAt: '2026-08-27T02:00:00.000Z', expiresAt: '2026-08-27T03:00:00.000Z',
        report: {
          schemaVersion: 1, scannerRulesVersion: '2026-08-27.1', artifactHash: '9'.repeat(64),
          riskReportHash: '8'.repeat(64), scannedAt: '2026-08-27T02:00:00.000Z', blocked: false,
          summary: { critical: 0, high: 0, medium: 0, low: 0 }, findings: [],
        },
        license: { id: 'Apache-2.0', noticeRequired: true }, catalogSerial: 3, quarantinedFiles: [],
      }],
    }
    const api = {
      state: vi.fn(async () => richState), inspect: vi.fn(), install: vi.fn(),
      diff: vi.fn(async () => ({ skillId: 'game-feel', changed: true })),
      action: vi.fn(async () => undefined),
    }
    render(<GodotSkillMarketCard {...{ api } as never} />)
    await screen.findByText('game-feel')
    fireEvent.click(screen.getByText('历史版本（1）'))
    fireEvent.click(screen.getByRole('button', { name: '回滚（默认禁用）' }))
    await waitFor(() => expect(api.action).toHaveBeenCalledWith({
      action: 'rollback', skillId: 'game-feel', artifactHash, expectedRevision: 4,
    }))

    fireEvent.click(screen.getByRole('tab', { name: '更新' }))
    expect(screen.getByRole('button', { name: '继续审阅' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '放弃暂存' }))
    await waitFor(() => expect(api.action).toHaveBeenCalledWith({ action: 'discard-inspection', inspectionId }))
    fireEvent.click(screen.getByRole('button', { name: '恢复' }))
    await waitFor(() => expect(api.action).toHaveBeenCalledWith({ action: 'restore-trash', trashId: 'trash-one' }))
  })
})
