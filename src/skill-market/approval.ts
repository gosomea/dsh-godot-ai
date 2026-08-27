import { sha256CanonicalJson } from './canonical-json.js'
import { verifyRiskReport, type RiskFinding, type SkillRiskReport } from './scanner.js'

export type RiskAcknowledgementKind = 'accepted-risk' | 'false-positive'

export interface RiskAcknowledgement {
  readonly findingId: string
  readonly kind: RiskAcknowledgementKind
}

export interface SkillRiskApproval {
  readonly schemaVersion: 1
  readonly riskReportHash: string
  readonly acknowledgedFindingIds: readonly string[]
  readonly acknowledgementKinds: Readonly<Record<string, RiskAcknowledgementKind>>
  readonly approvalHash: string
}

export type RiskApprovalResult =
  | { readonly status: 'blocked'; readonly criticalFindings: readonly RiskFinding[] }
  | { readonly status: 'review-required'; readonly missingFindings: readonly RiskFinding[] }
  | { readonly status: 'approved'; readonly approval: SkillRiskApproval }

/** Validate acknowledgements and produce a content/rules-bound approval hash. */
export function reviewRiskReport(
  report: SkillRiskReport,
  acknowledgements: readonly RiskAcknowledgement[],
): RiskApprovalResult {
  verifyRiskReport(report)
  const criticalFindings = report.findings.filter(finding => finding.severity === 'critical')
  if (criticalFindings.length > 0) return { status: 'blocked', criticalFindings }

  const reviewable = new Map(report.findings
    .filter(finding => finding.severity === 'high' || finding.severity === 'medium')
    .map(finding => [finding.findingId, finding]))
  const acknowledgementKinds: Record<string, RiskAcknowledgementKind> = {}
  for (const acknowledgement of acknowledgements) {
    if (acknowledgement.kind !== 'accepted-risk' && acknowledgement.kind !== 'false-positive') {
      throw new Error(`finding ${acknowledgement.findingId} has an unsupported acknowledgement kind`)
    }
    if (!reviewable.has(acknowledgement.findingId)) {
      throw new Error(`finding ${acknowledgement.findingId} does not require acknowledgement`)
    }
    if (acknowledgementKinds[acknowledgement.findingId] !== undefined) {
      throw new Error(`finding ${acknowledgement.findingId} was acknowledged more than once`)
    }
    acknowledgementKinds[acknowledgement.findingId] = acknowledgement.kind
  }
  const missingFindings = [...reviewable.values()].filter(finding => acknowledgementKinds[finding.findingId] === undefined)
  if (missingFindings.length > 0) return { status: 'review-required', missingFindings }

  const acknowledgedFindingIds = Object.keys(acknowledgementKinds).sort()
  const sortedKinds = Object.fromEntries(acknowledgedFindingIds.map(findingId => [findingId, acknowledgementKinds[findingId]!]))
  const body = {
    riskReportHash: report.riskReportHash,
    acknowledgedFindingIds,
    acknowledgementKinds: sortedKinds,
  }
  return {
    status: 'approved',
    approval: {
      schemaVersion: 1,
      ...body,
      approvalHash: sha256CanonicalJson(body),
    },
  }
}

export function verifyRiskApproval(report: SkillRiskReport, approval: SkillRiskApproval): void {
  const reviewed = reviewRiskReport(report, approval.acknowledgedFindingIds.map(findingId => ({
    findingId,
    kind: approval.acknowledgementKinds[findingId]!,
  })))
  if (reviewed.status !== 'approved' || reviewed.approval.approvalHash !== approval.approvalHash) {
    throw new Error('risk approval hash mismatch')
  }
}
