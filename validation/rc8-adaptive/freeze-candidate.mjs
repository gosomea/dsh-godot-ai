#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const projectPath = resolve(process.env.DSH_EVAL_PROJECT
  ?? '/Users/yuqixian/forever-skills/projects/godot-test-project')
const dshPath = resolve(process.env.DSH_EVAL_DSH
  ?? '/Users/yuqixian/forever-skills/projects/deepseek-harness-rc8-official')
const tarballArgument = process.argv[2]
if (tarballArgument === undefined) throw new Error('usage: node freeze-candidate.mjs <candidate.tgz>')
const tarballPath = resolve(tarballArgument)

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function hashTree(root) {
  const entries = []
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile()) entries.push(`${relative(root, child)}\0${await sha256File(child)}`)
    }
  }
  await visit(root)
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

const packageManifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
const { stdout: dshCommitOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dshPath })
const { stdout: dshStatus } = await execFileAsync('git', ['status', '--porcelain'], { cwd: dshPath })
if (dshStatus.trim() !== '') throw new Error('official DSH rc8 worktree is not clean')

const artifacts = {
  tarball: {
    path: relative(repoRoot, tarballPath),
    sha256: await sha256File(tarballPath),
  },
  runner: {
    path: 'validation/rc8-adaptive/run-matrix.mjs',
    sha256: await sha256File(join(here, 'run-matrix.mjs')),
  },
  orchestrationSkill: {
    path: 'skills/godot-ai-orchestration/SKILL.md',
    sha256: await sha256File(join(repoRoot, 'skills/godot-ai-orchestration/SKILL.md')),
  },
  projectGodot: {
    path: join(projectPath, 'project.godot'),
    sha256: await sha256File(join(projectPath, 'project.godot')),
  },
  neutralScene: {
    path: join(projectPath, 'main.tscn'),
    sha256: await sha256File(join(projectPath, 'main.tscn')),
  },
  neonDashSeed: {
    path: join(projectPath, 'validation_games/neon_dash'),
    sha256: await hashTree(join(projectPath, 'validation_games/neon_dash')),
  },
}

const manifest = {
  schemaVersion: 1,
  frozenAt: new Date().toISOString(),
  candidateVersion: packageManifest.version,
  matrixOrderSeed: 'rc8-formal-v1',
  environment: {
    dshVersion: '0.1.0-rc.8',
    dshCommit: dshCommitOutput.trim(),
    dshWorktreeClean: true,
    node: process.version,
    godot: '4.6',
    godotAi: '3.1.5',
    models: ['deepseek-v4-pro-ioa', 'deepseek-v4-flash-ioa'],
    reasoningEffort: 'max',
    runBudgetMs: 720000,
  },
  artifacts,
}

await writeFile(join(here, 'freeze-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
