import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import { sha256CanonicalJson } from './canonical-json.js'
import { hashArtifactDirectory } from './files.js'
import type { PreparedSkillArtifact } from './preparation.js'

export const SCANNER_RULES_VERSION = '2026-08-28.2'

export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface RiskFinding {
  readonly findingId: string
  readonly ruleId: string
  readonly severity: RiskSeverity
  readonly file: string
  readonly line: number
  readonly excerpt: string
  readonly explanation: string
  readonly recommendation: string
}

export interface RiskSummary {
  readonly low: number
  readonly medium: number
  readonly high: number
  readonly critical: number
}

export interface SkillRiskReport {
  readonly schemaVersion: 1
  readonly scannerRulesVersion: string
  readonly artifactHash: string
  readonly findings: readonly RiskFinding[]
  readonly summary: RiskSummary
  readonly blocked: boolean
  readonly riskReportHash: string
}

export interface SkillScannerLimits {
  readonly maxFiles: number
  readonly maxTotalBytes: number
  readonly maxFileBytes: number
  readonly maxDepth: number
  readonly maxFindings: number
}

export interface ScanSkillOptions {
  readonly scannerRulesVersion?: string
  readonly expectedArtifactHash?: string
  readonly limits?: Partial<SkillScannerLimits>
}

const DEFAULT_LIMITS: SkillScannerLimits = {
  maxFiles: 512,
  maxTotalBytes: 4 * 1024 * 1024,
  maxFileBytes: 512 * 1024,
  maxDepth: 16,
  maxFindings: 500,
}

const TEXT_EXTENSIONS = new Set([
  '', '.md', '.mdx', '.txt', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.xml', '.csv', '.tsv',
  '.gd', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.cc', '.cpp', '.h', '.hpp', '.html', '.css', '.scss', '.sh', '.bash', '.zsh', '.fish', '.ps1',
])
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar'])
const SCRIPT_COMPONENTS = new Set(['scripts', 'hooks', 'bin'])

interface ScannedFile {
  readonly absolute: string
  readonly relative: string
  readonly bytes: number
  readonly mode: number
}

interface FindingInput {
  readonly ruleId: string
  readonly severity: RiskSeverity
  readonly file: string
  readonly line: number
  readonly matchedText: string
  readonly excerpt: string
  readonly explanation: string
  readonly recommendation: string
}

interface LineRule {
  readonly ruleId: string
  readonly severity: RiskSeverity
  readonly pattern: RegExp
  readonly explanation: string
  readonly recommendation: string
}

const LINE_RULES: readonly LineRule[] = [
  {
    ruleId: 'prompt-ignore-instructions',
    severity: 'high',
    pattern: /(?:ignore|disregard|override).{0,48}(?:system|user|previous).{0,24}instructions?|忽略.{0,32}(?:系统|用户|之前|以上).{0,16}指令/iu,
    explanation: '正文要求覆盖系统、用户或既有指令，可能是 Prompt Injection。',
    recommendation: '删除覆盖上级指令的要求，只描述本 Skill 自身的工作流程。',
  },
  {
    ruleId: 'prompt-conceal-behavior',
    severity: 'high',
    pattern: /(?:do not|never).{0,24}(?:tell|reveal|mention).{0,32}(?:user|behavior|action)|(?:hide|conceal).{0,32}(?:behavior|action)|(?:隐藏|隐瞒).{0,24}(?:行为|操作|用户)|伪造.{0,20}(?:工具|结果)/iu,
    explanation: '正文要求隐藏行为或伪造结果，会破坏用户知情与工具结果真实性。',
    recommendation: '让所有副作用、外部调用和失败结果对用户保持透明。',
  },
  {
    ruleId: 'remote-exec-pipe',
    severity: 'critical',
    pattern: /(?:curl|wget)\b.{0,240}\|\s*(?:sudo\s+)?(?:sh|bash|zsh|fish|powershell|pwsh)\b/iu,
    explanation: '正文包含下载后直接交给 Shell 执行的远程执行链。',
    recommendation: '移除远程安装器；0.6.0 不允许运行第三方安装脚本。',
  },
  {
    ruleId: 'credential-exfiltration',
    severity: 'critical',
    pattern: /(?:(?:upload|send|post|paste|exfiltrat|上传|发送|提交).{0,100}(?:\.ssh\/(?:id_rsa|id_ed25519)|\.aws\/credentials|\.env\b|keychain|login data|cookies?)|(?:\.ssh\/(?:id_rsa|id_ed25519)|\.aws\/credentials|\.env\b|keychain|login data|cookies?).{0,100}(?:upload|post|paste|curl|fetch|上传))/iu,
    explanation: '正文把凭据或浏览器敏感数据与外传动作组合在一起。',
    recommendation: '删除读取、复制或发送凭据的全部指令。',
  },
  {
    ruleId: 'sensitive-path-reference',
    severity: 'high',
    pattern: /(?:~\/|\$HOME\/|\/Users\/[^/]+\/|\/home\/[^/]+\/)?(?:\.ssh\/(?:id_rsa|id_ed25519|config)|\.aws\/credentials|\.config\/gcloud|\.env\b)|(?:keychain|login data|browser cookies?)/iu,
    explanation: '正文提及凭据路径或浏览器敏感数据；安全建议也可能触发此规则。',
    recommendation: '逐条确认它只是禁止性说明；如果要求读取或传输这些内容则不要安装。',
  },
  {
    ruleId: 'privileged-shell-change',
    severity: 'high',
    pattern: /\bsudo\b|(?:\.zshrc|\.bashrc|\.profile|config\.fish)\b/iu,
    explanation: '正文涉及提权或修改 Shell 启动配置，副作用超出普通 Skill 范围。',
    recommendation: '移除提权和持久化 Shell 修改，改为用户明确执行的独立安装步骤。',
  },
  {
    ruleId: 'encoded-payload',
    severity: 'high',
    pattern: /(?:base64\s+(?:--decode|-d)|frombase64string|atob\s*\().{0,100}(?:exec|eval|sh\b|bash\b|powershell|child_process)/iu,
    explanation: '正文包含解码后执行的隐藏载荷模式。',
    recommendation: '把真实命令完整、可审阅地写出，并移除动态执行。',
  },
  {
    ruleId: 'external-filesystem-access',
    severity: 'high',
    pattern: /(?:read|write|delete|modify|scan|读取|写入|删除|修改|扫描).{0,48}(?:~\/|\$HOME|\/Users\/|\/home\/|\/etc\/)/iu,
    explanation: '正文要求访问项目目录之外的用户或系统路径。',
    recommendation: '限制文件操作到当前项目；确有需要时逐条确认路径和目的。',
  },
  {
    ruleId: 'authentication-or-secret',
    severity: 'medium',
    pattern: /(?:\bapi[_ -]?key\b|\baccess[_ -]?token\b|\bsecret\b|\boauth\b|\b(?:log|sign)\s+in(?:\s+(?:to|with|using|via|as)\b|(?=\s*(?:[.!?,;:]|$)))|认证|登录|密钥|令牌)/iu,
    explanation: '正文涉及认证或秘密信息，可能引入外部账户和凭据边界。',
    recommendation: '确认所需服务、凭据范围、保存位置和最小权限。',
  },
  {
    ruleId: 'publish-or-deploy',
    severity: 'medium',
    pattern: /\b(?:deploy|publish|upload)\b|\brelease\s+(?:the\s+)?(?:build|package|artifact|version|app|game|site|to\s+(?:production|an?\s+app\s+store))\b|\b(?:create|cut|ship)\s+(?:a\s+)?release\b|部署|发布|上传/iu,
    explanation: '正文可能要求向外部平台部署、发布或上传。',
    recommendation: '执行前必须再次获得用户对目标平台和具体副作用的确认。',
  },
  {
    ruleId: 'external-url',
    severity: 'low',
    pattern: /https?:\/\/[^\s)>\]"']+/iu,
    explanation: '正文引用外部网络地址。',
    recommendation: '确认域名和用途；链接本身不代表安全或授权。',
  },
]

function normalizedPath(path: string): string {
  return path.split(sep).join('/').normalize('NFKC')
}

function normalizedMatch(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US')
}

function createFinding(input: FindingInput): RiskFinding {
  const file = normalizedPath(input.file)
  const matchedText = normalizedMatch(input.matchedText)
  const findingId = createHash('sha256')
    .update(`${input.ruleId}\0${file}\0${input.line}\0${matchedText}`, 'utf8')
    .digest('hex')
  return {
    findingId,
    ruleId: input.ruleId,
    severity: input.severity,
    file,
    line: input.line,
    excerpt: input.excerpt.trim().slice(0, 320),
    explanation: input.explanation,
    recommendation: input.recommendation,
  }
}

function pushFinding(findings: RiskFinding[], limits: SkillScannerLimits, input: FindingInput): void {
  if (findings.length >= limits.maxFindings) return
  const finding = createFinding(input)
  if (!findings.some(existing => existing.findingId === finding.findingId)) findings.push(finding)
}

async function collectFiles(root: string, limits: SkillScannerLimits, findings: RiskFinding[]): Promise<ScannedFile[]> {
  const files: ScannedFile[] = []
  let totalBytes = 0

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > limits.maxDepth) {
      pushFinding(findings, limits, {
        ruleId: 'path-depth-limit', severity: 'critical', file: normalizedPath(relative(root, directory)) || '.', line: 1,
        matchedText: String(depth), excerpt: `目录深度 ${depth} 超过上限 ${limits.maxDepth}`,
        explanation: '文件树深度超过安全展开限制。', recommendation: '缩短目录结构后重新审计。',
      })
      return
    }
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))
    for (const entry of entries) {
      const absolute = join(directory, entry.name)
      const file = normalizedPath(relative(root, absolute))
      const details = await lstat(absolute)
      if (details.isSymbolicLink()) {
        pushFinding(findings, limits, {
          ruleId: 'symbolic-link', severity: 'critical', file, line: 1, matchedText: file, excerpt: file,
          explanation: '符号链接可能越过已审计的 Skill 根目录。', recommendation: '删除符号链接并复制必要的普通文件。',
        })
        continue
      }
      if (details.isDirectory()) {
        await visit(absolute, depth + 1)
        continue
      }
      if (!details.isFile()) {
        pushFinding(findings, limits, {
          ruleId: 'unsupported-file-type', severity: 'critical', file, line: 1, matchedText: file, excerpt: file,
          explanation: '文件树包含不受支持的特殊文件。', recommendation: '只保留普通目录和普通文件。',
        })
        continue
      }
      if (files.length >= limits.maxFiles) {
        pushFinding(findings, limits, {
          ruleId: 'file-count-limit', severity: 'critical', file, line: 1, matchedText: String(files.length + 1),
          excerpt: `文件数量超过上限 ${limits.maxFiles}`,
          explanation: 'Skill 文件数超过安全检查上限。', recommendation: '精简 Skill 内容后重新审计。',
        })
        continue
      }
      totalBytes += details.size
      if (totalBytes > limits.maxTotalBytes) {
        pushFinding(findings, limits, {
          ruleId: 'total-size-limit', severity: 'critical', file, line: 1, matchedText: String(totalBytes),
          excerpt: `总大小超过上限 ${limits.maxTotalBytes} bytes`,
          explanation: 'Skill 展开总大小超过安全检查上限。', recommendation: '移除大型资源或拆分 Skill。',
        })
      }
      files.push({ absolute, relative: file, bytes: details.size, mode: details.mode })
    }
  }

  await visit(root, 0)
  return files
}

function scanFileMetadata(file: ScannedFile, limits: SkillScannerLimits, findings: RiskFinding[]): boolean {
  const components = file.relative.split('/')
  if (components.some(component => SCRIPT_COMPONENTS.has(component.toLocaleLowerCase('en-US')))) {
    pushFinding(findings, limits, {
      ruleId: 'quarantined-script-tree', severity: 'high', file: file.relative, line: 1,
      matchedText: file.relative, excerpt: file.relative,
      explanation: 'scripts/hooks/bin 内容不会暴露给 Provider，也不会在 0.6.0 执行。',
      recommendation: '确认 Skill 在没有脚本执行能力时仍然有用；脚本必须保留在隔离区。',
    })
  }
  if ((file.mode & 0o111) !== 0) {
    pushFinding(findings, limits, {
      ruleId: 'executable-file', severity: 'high', file: file.relative, line: 1,
      matchedText: file.relative, excerpt: file.relative,
      explanation: '文件带可执行位；第三方 Skill 不获得脚本执行授权。',
      recommendation: '移除可执行位或将文件保留在隔离区。',
    })
  }
  if (file.relative.split('/').some(component => component.startsWith('.') && component !== '.well-known')) {
    pushFinding(findings, limits, {
      ruleId: 'hidden-file', severity: 'medium', file: file.relative, line: 1,
      matchedText: file.relative, excerpt: file.relative,
      explanation: '隐藏文件容易逃过普通人工审阅。', recommendation: '确认隐藏文件的必要性和全部内容。',
    })
  }
  const extension = extname(file.relative).toLocaleLowerCase('en-US')
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    pushFinding(findings, limits, {
      ruleId: 'nested-archive', severity: 'high', file: file.relative, line: 1,
      matchedText: file.relative, excerpt: file.relative,
      explanation: '嵌套压缩包不会被递归执行或信任，且可能隐藏未审计载荷。',
      recommendation: '移除压缩包并把需要审阅的文本直接展开。',
    })
    return false
  }
  if (file.bytes > limits.maxFileBytes) {
    pushFinding(findings, limits, {
      ruleId: 'single-file-size-limit', severity: 'critical', file: file.relative, line: 1,
      matchedText: String(file.bytes), excerpt: `文件大小 ${file.bytes} bytes 超过上限 ${limits.maxFileBytes}`,
      explanation: '单个文件超过安全检查上限，扫描结果不完整。', recommendation: '缩小或移除该文件后重新审计。',
    })
    return false
  }
  if (!TEXT_EXTENSIONS.has(extension)) {
    pushFinding(findings, limits, {
      ruleId: 'binary-or-unreviewed-file', severity: 'high', file: file.relative, line: 1,
      matchedText: file.relative, excerpt: file.relative,
      explanation: '此文件类型不会被作为透明文本审阅，可能包含二进制或隐藏载荷。',
      recommendation: '移除非文本文件，或从可信来源单独提供并明确其哈希和用途。',
    })
    return false
  }
  return true
}

async function scanTextFile(file: ScannedFile, limits: SkillScannerLimits, findings: RiskFinding[]): Promise<void> {
  const bytes = await readFile(file.absolute)
  if (bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0)) {
    pushFinding(findings, limits, {
      ruleId: 'binary-file', severity: 'high', file: file.relative, line: 1,
      matchedText: file.relative, excerpt: file.relative,
      explanation: '二进制内容无法作为透明的 Prompt/参考文本审阅。', recommendation: '移除二进制内容或改为明确来源的外部资源。',
    })
    return
  }
  const text = bytes.toString('utf8')
  const replacementCount = [...text].filter(character => character === '\uFFFD').length
  if (replacementCount > 0) {
    pushFinding(findings, limits, {
      ruleId: 'invalid-utf8', severity: 'high', file: file.relative, line: 1,
      matchedText: String(replacementCount), excerpt: `包含 ${replacementCount} 个无效 UTF-8 替换字符`,
      explanation: '无效 UTF-8 可能隐藏审阅工具与模型看到的差异。', recommendation: '使用规范 UTF-8 重新保存文件。',
    })
  }
  const lines = text.split(/\r?\n/u)
  for (const [index, line] of lines.entries()) {
    for (const rule of LINE_RULES) {
      const match = line.match(rule.pattern)
      if (match === null) continue
      pushFinding(findings, limits, {
        ruleId: rule.ruleId,
        severity: rule.severity,
        file: file.relative,
        line: index + 1,
        matchedText: match[0],
        excerpt: line,
        explanation: rule.explanation,
        recommendation: rule.recommendation,
      })
    }
  }
}

function summarize(findings: readonly RiskFinding[]): RiskSummary {
  const summary: { low: number; medium: number; high: number; critical: number } = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  }
  for (const finding of findings) summary[finding.severity] += 1
  return summary
}

function buildRiskReport(
  scannerRulesVersion: string,
  artifactHash: string,
  findings: readonly RiskFinding[],
): SkillRiskReport {
  const sortedFindings = [...findings].sort((left, right) => left.file.localeCompare(right.file, 'en') || left.line - right.line || left.ruleId.localeCompare(right.ruleId, 'en'))
  const summary = summarize(sortedFindings)
  const reportBody = { scannerRulesVersion, artifactHash, findings: sortedFindings }
  return {
    schemaVersion: 1,
    ...reportBody,
    summary,
    blocked: summary.critical > 0,
    riskReportHash: sha256CanonicalJson(reportBody),
  }
}

/** Deterministically scan a prepared third-party Skill directory. */
export async function scanSkillDirectory(directory: string, options: ScanSkillOptions = {}): Promise<SkillRiskReport> {
  const root = resolve(directory)
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`)
  }
  const scannerRulesVersion = options.scannerRulesVersion ?? SCANNER_RULES_VERSION
  if (scannerRulesVersion.length === 0) throw new Error('scannerRulesVersion must be non-empty')
  const findings: RiskFinding[] = []
  const files = await collectFiles(root, limits, findings)
  for (const file of files) if (scanFileMetadata(file, limits, findings)) await scanTextFile(file, limits, findings)
  let artifactHash: string
  try { artifactHash = await hashArtifactDirectory(root) }
  catch {
    // Unsafe trees cannot be installed, but still receive a stable report identity.
    artifactHash = createHash('sha256').update(findings.map(finding => finding.findingId).join('\n'), 'utf8').digest('hex')
  }
  if (options.expectedArtifactHash !== undefined && artifactHash !== options.expectedArtifactHash) {
    throw new Error(`scanned artifact hash mismatch: expected ${options.expectedArtifactHash}, got ${artifactHash}`)
  }
  return buildRiskReport(scannerRulesVersion, artifactHash, findings)
}

/** Scan both Provider-safe resources and never-executed quarantine as one review unit. */
export async function scanPreparedThirdPartyArtifact(
  prepared: PreparedSkillArtifact,
  options: Omit<ScanSkillOptions, 'expectedArtifactHash'> = {},
): Promise<SkillRiskReport> {
  const resourceReport = await scanSkillDirectory(prepared.resourceDirectory, {
    ...options,
    expectedArtifactHash: prepared.artifactHash,
  })
  const quarantineReport = await scanSkillDirectory(prepared.quarantineDirectory, options)
  const quarantineFindings = prepared.quarantinedFiles.map(file => createFinding({
    ruleId: 'quarantined-file',
    severity: 'high',
    file,
    line: 1,
    matchedText: file,
    excerpt: file,
    explanation: '该文件因脚本目录、扩展名或可执行位而被移出 Provider 资源树；0.6.0 永不执行它。',
    recommendation: '确认 Skill 在不执行此文件时仍然可用；风险确认不构成脚本执行授权。',
  }))
  return buildRiskReport(
    resourceReport.scannerRulesVersion,
    prepared.artifactHash,
    [...resourceReport.findings, ...quarantineReport.findings, ...quarantineFindings],
  )
}

export function verifyRiskReport(report: SkillRiskReport): void {
  const expected = sha256CanonicalJson({
    scannerRulesVersion: report.scannerRulesVersion,
    artifactHash: report.artifactHash,
    findings: report.findings,
  })
  if (expected !== report.riskReportHash) throw new Error('risk report hash mismatch')
  const summary = summarize(report.findings)
  if (JSON.stringify(summary) !== JSON.stringify(report.summary)) throw new Error('risk report summary mismatch')
  if (report.blocked !== (summary.critical > 0)) throw new Error('risk report blocked flag mismatch')
}
