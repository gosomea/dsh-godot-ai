import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = new URL('../', import.meta.url)
const reports = new URL('validation/rc2-release/', root)
await mkdir(reports, { recursive: true })
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

if (process.argv[2] === 'release-verify') {
  const registry = await fetch('https://registry.npmjs.org/dsh-godot-ai/' + manifest.version).then(r => {
    assert.equal(r.status, 200, 'npm version published'); return r.json()
  })
  const bytes = Buffer.from(await fetch(registry.dist.tarball).then(r => r.arrayBuffer()))
  const local = await readFile(new URL('validation/rc2-release/dsh-godot-ai-' + manifest.version + '.tgz', root))
  assert.equal(sha256(bytes), sha256(local), 'npm bytes match tested artifact')
  const release = JSON.parse(execFileSync('gh', ['release', 'view', 'v' + manifest.version,
    '--repo', 'gosomea/dsh-godot-ai', '--json', 'url,assets,isDraft'], { encoding: 'utf8' }))
  assert.equal(release.isDraft, false)
  const asset = release.assets.find(a => a.name === 'dsh-godot-ai-' + manifest.version + '.tgz')
  assert.ok(asset, 'release includes npm tarball')
  const ghBytes = execFileSync('gh', ['release', 'download', 'v' + manifest.version,
    '--repo', 'gosomea/dsh-godot-ai', '--pattern', asset.name, '--output', '-'])
  assert.equal(sha256(ghBytes), sha256(local), 'GitHub attachment bytes match npm artifact')
  const report = { version: registry.version, npm: registry.dist.tarball,
    github: release.url, tarballSha256: sha256(local), success: true }
  await writeFile(new URL('release-report.json', reports), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} else if (process.argv[2] === 'verify') {
  const base = process.env.DSH_GODOT_SMOKE_URL
  const logfile = process.env.DSH_GODOT_TEST_LOG
  assert.ok(base && logfile, 'set DSH_GODOT_SMOKE_URL and DSH_GODOT_TEST_LOG for an isolated Web host')
  const log = await readFile(logfile, 'utf8')
  const login = [...log.matchAll(/dsh web: (http:\/\/[^\s]+)/g)].at(-1)?.[1]
  assert.ok(login?.startsWith(base + '/?token='), 'current process login URL belongs to test host')
  const admitted = await fetch(login, { redirect: 'manual' })
  const cookie = admitted.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie, 'host issued authentication cookie')
  const headers = { cookie, origin: base, 'content-type': 'application/json' }
  const get = async path => {
    const response = await fetch(base + path, { headers })
    assert.equal(response.status, 200, path)
    return response.json()
  }
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'godot-rc2-workspace-')))
  const skill = join(workspace, '.dsh/skills/godot-audio')
  await mkdir(skill, { recursive: true })
  await writeFile(join(skill, 'SKILL.md'), '---\nname: godot-audio\ndescription: Project override contract\n---\nRC2_PROJECT_OVERRIDE\n')
  const preset = await get('/api/dsh-godot-ai/preset')
  assert.equal(preset.state.kind, 'current')
  assert.equal(preset.state.wrapperVersion, manifest.version)
  const market = await get('/api/dsh-godot-ai/skills')
  const integration = await get('/api/dsh-godot-ai/integration')
  assert.equal(integration.integration.wrapperVersion, manifest.version)
  const response = await fetch(base + '/__dga-smoke', {
    method: 'POST', headers, body: JSON.stringify({ workspace }),
  })
  const probe = await response.json()
  assert.equal(response.status, 200, JSON.stringify(probe))
  assert.equal(probe.roster.filter(row => row.id.startsWith('godot-')).length, 1)
  assert.equal(probe.agentPreset, 'godot-creator')
  assert.equal(probe.cwd, workspace)
  assert.deepEqual(probe.directTools, ['run_code'])
  assert.equal(probe.godotNames.length, 45)
  assert.equal(probe.godotSkills.length, 16)
  assert.equal(probe.creatorPersona, true)
  assert.equal(probe.projectSkillOverride, true)
  assert.equal(probe.standardUnaffected, true)
  assert.equal(probe.ptc.success, true, JSON.stringify(probe.ptc))
  assert.equal(probe.ptc.hasSessionList, true)
  const report = { version: manifest.version, dsh: '0.2.0-rc.2', host: base, workspace,
    probe, marketAvailable: Boolean(market.market), integrationAvailable: true,
    gameCreationE2E: 'not-tested', success: true }
  await writeFile(new URL('runtime-report.json', reports), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ success: true, sessionId: probe.sessionId,
    godotBindings: probe.godotNames.length, godotSkills: probe.godotSkills.length, workspace }))
} else {
  throw new Error('use verify or release-verify')
}
