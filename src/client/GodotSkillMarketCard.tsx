import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RiskAcknowledgementKind } from '../skill-market/approval.js'
import type { SkillInspection, SkillMarketDiffSummary } from '../skill-market/service.js'
import { GodotSkillMarketApi, type SkillMarketStateResponse } from './api.js'

type Tab = 'installed' | 'curated' | 'github' | 'updates'

export interface GodotSkillMarketCardProps extends PropsRuntime<'settings.general.item'>, PropsLocale<'dsh-godot-ai'> {
  readonly api: GodotSkillMarketApi
}

function ErrorMessage({ value }: { readonly value: string | undefined }): ReactNode {
  return value === undefined ? null : <p className="dga-inline-error" role="alert">{value}</p>
}

export function GodotSkillMarketCard({ api }: GodotSkillMarketCardProps): ReactNode {
  const [state, setState] = useState<SkillMarketStateResponse>()
  const [tab, setTab] = useState<Tab>('installed')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [inspection, setInspection] = useState<SkillInspection>()
  const [diff, setDiff] = useState<SkillMarketDiffSummary>()
  const [acknowledgements, setAcknowledgements] = useState<Record<string, RiskAcknowledgementKind>>({})
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [ref, setRef] = useState('main')
  const [subdir, setSubdir] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try { setState(await api.state()) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(false) }
  }, [api])

  useEffect(() => { void load() }, [load])

  const reviewable = useMemo(() => inspection?.report.findings.filter(
    finding => finding.severity === 'high' || finding.severity === 'medium',
  ) ?? [], [inspection])
  const reviewComplete = reviewable.every(finding => acknowledgements[finding.findingId] !== undefined)

  const run = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try { await operation() }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(false) }
  }, [])

  const inspectCurated = (skillId: string): void => {
    void run(async () => {
      const next = await api.inspect({ source: { kind: 'curated', skillId } })
      setInspection(next)
      setDiff(await api.diff(next.skillId))
      setAcknowledgements({})
    })
  }

  const inspectGitHub = (event: FormEvent): void => {
    event.preventDefault()
    void run(async () => {
      const next = await api.inspect({ source: { kind: 'github', owner, repo, ref, subdir } })
      setInspection(next)
      setDiff(await api.diff(next.skillId))
      setAcknowledgements({})
    })
  }

  const install = (): void => {
    if (inspection === undefined) return
    void run(async () => {
      await api.install({
        inspectionId: inspection.inspectionId,
        acknowledgements: reviewable.map(finding => ({
          findingId: finding.findingId,
          kind: acknowledgements[finding.findingId]!,
        })),
        ...state === undefined ? {} : { expectedRevision: state.market.revision },
      })
      setInspection(undefined)
      setDiff(undefined)
      setAcknowledgements({})
      await load()
      setTab('installed')
    })
  }

  const continueInspection = (next: SkillInspection): void => {
    void run(async () => {
      setInspection(next)
      setDiff(await api.diff(next.skillId))
      setAcknowledgements({})
    })
  }

  const action = (value: Parameters<GodotSkillMarketApi['action']>[0]): void => {
    void run(async () => { await api.action(value); await load() })
  }

  return (
    <section className="dga-market" aria-label="Godot Skill 市场">
      <div className="dga-integration-head">
        <div>
          <div className="dga-integration-title">Godot Skill 市场</div>
          <div className="dga-integration-desc">发现、审阅、安装和更新游戏开发 Skills；不会自动安装或自动交给模型调用。</div>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => { void load() }}>{busy ? '处理中…' : '刷新'}</Button>
      </div>
      <div className="dga-market-warning">{state?.market.securityBoundary ?? '静态扫描不是沙箱；安装前仍需审阅正文和风险项。'}</div>
      <ErrorMessage value={error} />
      <div className="dga-market-tabs" role="tablist">
        {([['installed', '已安装'], ['curated', '精选'], ['github', 'GitHub 导入'], ['updates', '更新']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {inspection === undefined ? null : (
        <div className="dga-market-review">
          <div className="dga-market-row"><strong>{inspection.skillId}</strong><span>{inspection.version}</span></div>
          <div className="dga-risk-counts">
            <span data-severity="critical">critical {inspection.report.summary.critical}</span>
            <span data-severity="high">high {inspection.report.summary.high}</span>
            <span>medium {inspection.report.summary.medium}</span><span>low {inspection.report.summary.low}</span>
          </div>
          {diff?.diff === undefined ? null : (
            <details className="dga-market-diff" open>
              <summary>变更：{diff.diff.changedFiles} 个文件 · +{diff.diff.additions} / -{diff.diff.deletions}{diff.diff.truncated ? ' · 已截断' : ''}</summary>
              <pre>{diff.diff.patch || '文件内容没有变化。'}</pre>
              {diff.diff.omittedFiles > 0 ? <p>另有 {diff.diff.omittedFiles} 个文件未在响应中展开。</p> : null}
            </details>
          )}
          {inspection.report.findings.map(finding => (
            <div className="dga-finding" key={finding.findingId} data-severity={finding.severity}>
              <div><strong>{finding.severity} · {finding.ruleId}</strong><span>{finding.file}:{finding.line}</span></div>
              <code>{finding.excerpt}</code><p>{finding.explanation}</p>
              {finding.severity !== 'high' && finding.severity !== 'medium' ? null : (
                <select value={acknowledgements[finding.findingId] ?? ''} onChange={event => setAcknowledgements(current => ({
                  ...current,
                  [finding.findingId]: event.target.value as RiskAcknowledgementKind,
                }))}>
                  <option value="">请选择…</option><option value="false-positive">这是误报</option><option value="accepted-risk">我接受此风险</option>
                </select>
              )}
            </div>
          ))}
          <div className="dga-market-actions">
            <Button variant="outline" onClick={() => { setInspection(undefined); setDiff(undefined) }}>取消</Button>
            <Button disabled={busy || inspection.report.blocked || !reviewComplete} onClick={install}>安装（默认禁用）</Button>
          </div>
        </div>
      )}

      {inspection !== undefined ? null : tab === 'installed' ? (
        <div className="dga-market-list">
          {state === undefined || Object.keys(state.market.installed).length === 0 ? <p className="dga-market-empty">尚未安装第三方 Skill。</p> : null}
          {state === undefined ? null : Object.entries(state.market.installed).map(([id, item]) => (
            <div className="dga-market-skill" key={id}>
              <div className="dga-market-row"><strong>{id}</strong><span>{item.activeVersion} · {item.state}</span></div>
              <div className="dga-market-actions">
                {item.enabled ? <Button variant="outline" disabled={busy} onClick={() => action({ action: 'disable', skillId: id, expectedRevision: state.market.revision })}>禁用</Button>
                  : <Button disabled={busy || item.approvalHash === undefined || item.state !== 'ready'} onClick={() => action({ action: 'enable', skillId: id, approvalHash: item.approvalHash!, expectedRevision: state.market.revision })}>启用</Button>}
                <Button variant="outline" disabled={busy} onClick={() => action({ action: 'uninstall', skillId: id, expectedRevision: state.market.revision })}>卸载</Button>
              </div>
              {item.history.length === 0 ? null : (
                <details className="dga-market-diff">
                  <summary>历史版本（{item.history.length}）</summary>
                  {item.history.map(revision => (
                    <div className="dga-market-row" key={revision.artifactHash}>
                      <span>{revision.version} · {revision.artifactHash.slice(0, 12)}</span>
                      <Button variant="outline" disabled={busy} onClick={() => action({
                        action: 'rollback', skillId: id, artifactHash: revision.artifactHash, expectedRevision: state.market.revision,
                      })}>回滚（默认禁用）</Button>
                    </div>
                  ))}
                </details>
              )}
            </div>
          ))}
        </div>
      ) : tab === 'curated' ? (
        <div className="dga-market-list">
          <div className="dga-starter"><strong>Godot 游戏设计增强包</strong><span>game-feel · game-ui-ux · game-ui-design；仍会逐个审阅和安装。</span></div>
          {state?.market.catalog.length === 0 ? <p className="dga-market-empty">本地还没有已验证的精选 Catalog。可先使用 GitHub 导入。</p> : null}
          {state?.market.catalog.map(item => (
            <div className="dga-market-skill" key={item.id}>
              <div className="dga-market-row"><strong>{item.title}</strong><span>{item.license.id} · {item.compatibility}</span></div>
              <p>{item.description}</p><Button disabled={busy || !item.installable} onClick={() => inspectCurated(item.id)}>审阅</Button>
            </div>
          ))}
        </div>
      ) : tab === 'github' ? (
        <form className="dga-market-form" onSubmit={inspectGitHub}>
          <label>Owner<input value={owner} onChange={event => setOwner(event.target.value)} required /></label>
          <label>Repository<input value={repo} onChange={event => setRepo(event.target.value)} required /></label>
          <label>Ref<input value={ref} onChange={event => setRef(event.target.value)} required /></label>
          <label>Skill 子目录<input value={subdir} onChange={event => setSubdir(event.target.value)} placeholder="skills/game-feel" required /></label>
          <p>Ref 会先解析为不可变 commit；内容只从 codeload.github.com 获取。不会运行仓库安装器或脚本。</p>
          <Button disabled={busy} type="submit">下载并审阅</Button>
        </form>
      ) : (
        <div className="dga-market-list">
          <p className="dga-market-empty">更新不会自动激活；每个新版本都重新走 Inspect → Diff → Scan → Confirm。</p>
          <Button disabled={busy} onClick={() => action({ action: 'check-updates' })}>立即检查精选更新</Button>
          <Button variant="outline" disabled={busy} onClick={() => action({ action: 'gc' })}>清理过期暂存（可恢复）</Button>
          {state?.inspections.filter(item => item.state === 'ready').map(item => (
            <div className="dga-market-skill" key={item.inspectionId}>
              <div className="dga-market-row"><strong>{item.skillId}</strong><span>{item.version} · 待确认</span></div>
              <p>暂存至 {new Date(item.expiresAt).toLocaleString()}；确认前不会替换当前版本。</p>
              <div className="dga-market-actions">
                <Button disabled={busy} onClick={() => continueInspection(item)}>继续审阅</Button>
                <Button variant="outline" disabled={busy} onClick={() => action({ action: 'discard-inspection', inspectionId: item.inspectionId })}>放弃暂存</Button>
              </div>
            </div>
          ))}
          {state !== undefined && state.market.trash.length > 0 ? <strong>可恢复回收站</strong> : null}
          {state?.market.trash.map(item => (
            <div className="dga-market-skill" key={item.trashId}>
              <div className="dga-market-row"><strong>{item.kind}</strong><span>{item.originalName}</span></div>
              <p>将在 {new Date(item.purgeAfter).toLocaleString()} 后永久清理。</p>
              <Button variant="outline" disabled={busy} onClick={() => action({ action: 'restore-trash', trashId: item.trashId })}>恢复</Button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
