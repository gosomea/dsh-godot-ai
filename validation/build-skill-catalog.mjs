import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GitHubImportClient,
  canonicalJson,
  parseSeedReviewManifest,
  parseSkillCatalog,
  prepareThirdPartyArtifact,
  scanPreparedThirdPartyArtifact,
} from '../lib/index.js'

const descriptions = {
  'higgsfield-game-generation': ['Higgsfield Game Generation（已迁移）', '历史 Higgsfield 浏览器游戏生成流程；上游已迁移，保留状态说明但不可安装。'],
  'game-engine': ['Game Engine', '面向 Canvas、WebGL 和常见 Web 游戏引擎的架构指南；不是 Godot 专用。'],
  'multiplayer-game': ['Multiplayer Game（许可证阻断）', '历史 Rivet 多人游戏流程；缺少可确认的再分发许可证，因此不可安装。'],
  'game-developer': ['Game Developer', '通用游戏开发与性能指南，具体示例主要面向 Unity 和 Unreal。'],
  'game-ui-design': ['Game UI Design', 'HUD、菜单、可访问性、手柄导航和响应式布局的引擎中立设计指南。'],
  'game-design-theory': ['Game Design Theory（许可证待审阅）', '引擎中立游戏设计理论；0.6.0 在自定义许可证全文审阅 UI 完成前不可安装。'],
  'game-feel': ['Game Feel', '操作手感、反馈、打击感与 juice 指南，包含具体 Godot 示例。'],
  'game-ui-ux': ['Game UI / UX', '游戏 UI/UX 指南，包含 Godot Control、锚点、安全区和焦点导航示例。'],
  'threejs-game-ui-designer': ['Three.js Game UI Designer', 'Three.js 专用的游戏界面设计流程；默认不安装，避免污染 Godot 运行时选择。'],
}

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index === -1 || process.argv[index + 1] === undefined) throw new Error(`missing ${name}`)
  return process.argv[index + 1]
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function writeJson(path, value, canonical = false) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, canonical ? `${canonicalJson(value)}\n` : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const manifestPath = resolve(repositoryRoot, argument('--manifest'))
const catalogPath = resolve(repositoryRoot, argument('--catalog'))
const auditPath = resolve(repositoryRoot, argument('--audit-report'))
const serial = Number(argument('--serial'))
const issuedAt = argument('--issued-at')
const expiresAt = argument('--expires-at')
if (!Number.isSafeInteger(serial) || serial < 1) throw new Error('--serial must be a positive integer')
if (Number.isNaN(Date.parse(issuedAt)) || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(issuedAt)) {
  throw new Error('catalog timestamps are invalid')
}

const manifest = parseSeedReviewManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
const client = new GitHubImportClient({ userAgent: 'dsh-godot-ai-catalog-builder/0.6' })
const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-godot-ai-catalog-'))
const auditEntries = []
const catalogEntries = []

try {
  for (const candidate of manifest.candidates) {
    if (candidate.source.kind !== 'github') {
      auditEntries.push({
        id: candidate.id,
        source: candidate.source,
        decision: candidate.decision,
        installable: false,
        audited: false,
        reason: '0.6.0 accepts only immutable GitHub commit sources for runtime installation.',
      })
      continue
    }
    const candidateRoot = join(temporaryRoot, candidate.id)
    await mkdir(candidateRoot, { recursive: false, mode: 0o700 })
    const rawDirectory = join(candidateRoot, 'raw')
    const resourceDirectory = join(candidateRoot, 'resource')
    const quarantineDirectory = join(candidateRoot, 'quarantine')
    const resolved = {
      owner: candidate.source.owner,
      repo: candidate.source.repo,
      ref: candidate.source.commit,
      commit: candidate.source.commit,
      subdir: candidate.source.subdir,
    }
    process.stderr.write(`Auditing ${candidate.id} from ${candidate.source.owner}/${candidate.source.repo}@${candidate.source.commit.slice(0, 12)}\n`)
    try {
      const downloaded = await client.downloadSkill(resolved, rawDirectory)
      const prepared = await prepareThirdPartyArtifact(rawDirectory, resourceDirectory, quarantineDirectory)
      const report = await scanPreparedThirdPartyArtifact(prepared)
      const manifestSha256 = sha256(await readFile(join(resourceDirectory, 'SKILL.md')))
      if (candidate.installable && report.blocked) throw new Error(`${candidate.id} is installable but has critical risk findings`)
      if (candidate.installable && !candidate.license.redistributable) throw new Error(`${candidate.id} is installable without redistribution rights`)
      const [title, description] = descriptions[candidate.id] ?? [candidate.id, candidate.notes.join(' ')]
      auditEntries.push({
        id: candidate.id,
        source: resolved,
        decision: candidate.decision,
        installable: candidate.installable,
        audited: true,
        downloadedBytes: downloaded.downloadedBytes,
        expandedBytes: downloaded.expandedBytes,
        sourceArtifactSha256: downloaded.artifactHash,
        preparedArtifactSha256: prepared.artifactHash,
        manifestSha256,
        resourceFiles: prepared.resourceFiles,
        quarantinedFiles: prepared.quarantinedFiles,
        risk: {
          scannerRulesVersion: report.scannerRulesVersion,
          riskReportHash: report.riskReportHash,
          summary: report.summary,
          blocked: report.blocked,
        },
      })
      catalogEntries.push({
        id: candidate.id,
        title,
        description,
        version: candidate.source.commit.slice(0, 12),
        source: {
          owner: candidate.source.owner,
          repo: candidate.source.repo,
          commit: candidate.source.commit,
          subdir: candidate.source.subdir,
        },
        artifactSha256: prepared.artifactHash,
        manifestSha256,
        license: { id: candidate.license.id, noticeRequired: candidate.license.noticeRequired },
        upstreamStatus: candidate.upstreamStatus,
        compatibility: candidate.compatibility,
        decision: candidate.decision,
        installable: candidate.installable,
        defaultSelected: candidate.defaultSelected,
        externalRequirements: candidate.externalRequirements,
      })
    } catch (error) {
      if (candidate.installable) throw error
      auditEntries.push({
        id: candidate.id,
        source: resolved,
        decision: candidate.decision,
        installable: false,
        audited: false,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const catalog = parseSkillCatalog({
    schemaVersion: 1,
    serial,
    issuedAt,
    expiresAt,
    skills: catalogEntries.sort((left, right) => left.id.localeCompare(right.id, 'en')),
  })
  await writeJson(catalogPath, catalog, true)
  await writeJson(auditPath, {
    schemaVersion: 1,
    catalogSerial: serial,
    reviewedAt: manifest.reviewedAt,
    scannerRulesVersion: auditEntries.find(entry => entry.risk)?.risk.scannerRulesVersion,
    entries: auditEntries,
  })
  process.stdout.write(`${JSON.stringify({ catalogPath, auditPath, catalogSha256: sha256(await readFile(catalogPath)), skills: catalog.skills.length })}\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
