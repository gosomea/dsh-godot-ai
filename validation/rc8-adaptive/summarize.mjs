#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const runsDir = join(here, 'formal-runs')

function toolDispatches(report) {
  return (report.events ?? [])
    .map(item => item.event)
    .filter(event => event?.type === 'tool/code-dispatch')
    .map(event => event.data ?? {})
}

function screenshotMetadata(dispatch) {
  for (const block of dispatch.content ?? []) {
    if (block.type !== 'text') continue
    try {
      const parsed = JSON.parse(block.text)
      if (parsed !== null && typeof parsed === 'object' && 'stale_frame' in parsed) return parsed
    } catch {}
  }
  return undefined
}

function strictResult(report) {
  const dispatches = toolDispatches(report)
  const targetPrefix = `res://${report.target}/`
  const successful = name => dispatches.some(item => item.name?.includes(name) && item.isError !== true)
  const targetRuns = dispatches.filter(item => {
    if (!item.name?.includes('project_run') || item.isError === true) return false
    return item.arguments?.mode === 'custom'
      && typeof item.arguments?.scene === 'string'
      && item.arguments.scene.startsWith(targetPrefix)
  })
  const freshScreenshots = dispatches.filter(item => {
    if (!item.name?.includes('editor_screenshot') || item.isError === true) return false
    return screenshotMetadata(item)?.stale_frame === false
  })
  const emptyToolNames = report.summary?.emptyToolNames ?? 0
  const scopeViolations = report.summary?.scopeViolations ?? []
  const turnEnds = report.summary?.turnEnds ?? []
  const pluginEvidence = report.summary?.pluginEvidence ?? {}
  const expectedPreset = report.mode === 'adaptive' ? 'godot-creator-adaptive' : 'godot-creator'
  const godotSkills = report.godotSkills ?? []
  const pluginEvidenceComplete = report.summary?.pluginEvidence !== undefined && report.godotSkills !== undefined
  const checks = {
    completedWithinBudget: report.timedOut !== true,
    targetExists: report.targetExists === true,
    noOutsideChanges: (report.outsideChanges ?? []).length === 0,
    noEmptyToolNames: emptyToolNames === 0,
    noScopeViolations: scopeViolations.length === 0,
    turnCompleted: turnEnds.length > 0 && turnEnds.every(reason => reason.kind === 'completed'),
    ranExactTarget: targetRuns.length > 0,
    readLogs: successful('logs_read'),
    capturedFreshScreenshot: freshScreenshots.length > 0,
    readScene: successful('scene_get_hierarchy') || successful('game_manage'),
    pluginPresetMatches: report.preset === expectedPreset,
    pluginGodotSkillCatalogComplete: godotSkills.length === 16
      && godotSkills.every(skill => skill.modelInvocable === true),
    pluginNamespaceMatches: pluginEvidence.namespaceMatches === true,
    pluginRouteLifecycle: pluginEvidence.routeLifecycle === true,
    pluginBootstrapReadOnlyOnly: pluginEvidence.bootstrapReadOnlyOnly === true,
    pluginRunCodeUsed: pluginEvidence.runCodeUsed === true,
  }
  return {
    strictPass: Object.values(checks).every(Boolean),
    pluginEvidenceComplete,
    checks,
    targetRuns: targetRuns.map(item => item.arguments),
    freshScreenshotCount: freshScreenshots.length,
  }
}

const files = (await readdir(runsDir))
  .filter(name => /^\d{2}-.+\.json$/.test(name))
  .sort()
const rows = []
for (const file of files) {
  const report = JSON.parse(await readFile(join(runsDir, file), 'utf8'))
  if (report.dryRun === true || report.schemaVersion !== 1) continue
  const strict = strictResult(report)
  rows.push({
    runId: report.runId,
    category: report.category.id,
    model: report.model,
    mode: report.mode,
    wallTimeMs: report.wallTimeMs,
    inputTokens: report.summary?.inputTokens ?? 0,
    outputTokens: report.summary?.outputTokens ?? 0,
    originalPass: report.pass,
    legacyEvidence: strict.pluginEvidenceComplete !== true,
    ...strict,
  })
}

const modes = Object.fromEntries(['classic', 'adaptive'].map(mode => {
  const selected = rows.filter(row => row.mode === mode)
  return [mode, {
    completed: selected.length,
    passed: selected.filter(row => row.strictPass).length,
    successRate: selected.length === 0 ? null : selected.filter(row => row.strictPass).length / selected.length,
  }]
}))
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  gate: 'strict-custom-target-fresh-screenshot-plugin-v2',
  completed: rows.length,
  passed: rows.filter(row => row.strictPass).length,
  modes,
  rows,
}

await writeFile(join(here, 'aggregate.json'), `${JSON.stringify(result, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
