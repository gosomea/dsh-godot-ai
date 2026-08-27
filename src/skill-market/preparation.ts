import { randomUUID } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import { hashArtifactDirectory, pathExists } from './files.js'

const SCRIPT_DIRECTORIES = new Set(['scripts', 'hooks', 'bin'])
const EXECUTABLE_EXTENSIONS = new Set(['.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.com', '.exe'])

export interface PreparedSkillArtifact {
  readonly artifactHash: string
  readonly resourceDirectory: string
  readonly quarantineDirectory: string
  readonly resourceFiles: readonly string[]
  readonly quarantinedFiles: readonly string[]
}

function normalizedRelative(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/')
}

function mustQuarantine(relativePath: string, mode: number): boolean {
  const components = relativePath.split('/').map(component => component.toLocaleLowerCase('en-US'))
  return components.some(component => SCRIPT_DIRECTORIES.has(component))
    || EXECUTABLE_EXTENSIONS.has(extname(relativePath).toLocaleLowerCase('en-US'))
    || (mode & 0o111) !== 0
}

/**
 * Copy inspected content into a Provider-safe resource tree and a separate,
 * never-executed quarantine tree. Source content is left untouched.
 */
export async function prepareThirdPartyArtifact(
  sourceDirectory: string,
  resourceDirectory: string,
  quarantineDirectory: string,
): Promise<PreparedSkillArtifact> {
  const sourceRoot = resolve(sourceDirectory)
  const resourceRoot = resolve(resourceDirectory)
  const quarantineRoot = resolve(quarantineDirectory)
  if (sourceRoot === resourceRoot || sourceRoot === quarantineRoot || resourceRoot === quarantineRoot) {
    throw new Error('source, resource, and quarantine directories must be distinct')
  }
  for (const destination of [resourceRoot, quarantineRoot]) {
    if (destination.startsWith(`${sourceRoot}${sep}`) || sourceRoot.startsWith(`${destination}${sep}`)) {
      throw new Error('preparation directories cannot contain one another')
    }
  }
  if (await pathExists(resourceRoot) || await pathExists(quarantineRoot)) throw new Error('preparation destination already exists')
  const token = randomUUID()
  const temporaryResourceRoot = `${resourceRoot}.tmp-${token}`
  const temporaryQuarantineRoot = `${quarantineRoot}.tmp-${token}`
  await mkdir(temporaryResourceRoot, { recursive: false, mode: 0o700 })
  await mkdir(temporaryQuarantineRoot, { recursive: false, mode: 0o700 })
  const resourceFiles: string[] = []
  const quarantinedFiles: string[] = []
  let resourceCommitted = false
  let quarantineCommitted = false

  async function visit(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      const absolute = join(directory, entry.name)
      const relativePath = normalizedRelative(sourceRoot, absolute)
      const details = await lstat(absolute)
      if (details.isSymbolicLink()) throw new Error(`third-party skill contains symbolic link ${relativePath}`)
      if (details.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (!details.isFile()) throw new Error(`third-party skill contains unsupported entry ${relativePath}`)
      const quarantined = mustQuarantine(relativePath, details.mode)
      const destinationRoot = quarantined ? temporaryQuarantineRoot : temporaryResourceRoot
      const destination = join(destinationRoot, ...relativePath.split('/'))
      await mkdir(resolve(destination, '..'), { recursive: true, mode: 0o700 })
      await copyFile(absolute, destination)
      await chmod(destination, 0o600)
      if (quarantined) quarantinedFiles.push(relativePath)
      else resourceFiles.push(relativePath)
    }
  }

  try {
    await visit(sourceRoot)
    if (!resourceFiles.includes('SKILL.md')) throw new Error('prepared third-party skill has no Provider-safe SKILL.md')
    const artifactHash = await hashArtifactDirectory(temporaryResourceRoot)
    await rename(temporaryQuarantineRoot, quarantineRoot)
    quarantineCommitted = true
    await rename(temporaryResourceRoot, resourceRoot)
    resourceCommitted = true
    return {
      artifactHash,
      resourceDirectory: resourceRoot,
      quarantineDirectory: quarantineRoot,
      resourceFiles: resourceFiles.sort(),
      quarantinedFiles: quarantinedFiles.sort(),
    }
  } catch (error) {
    await Promise.all([
      rm(temporaryResourceRoot, { recursive: true, force: true }),
      rm(temporaryQuarantineRoot, { recursive: true, force: true }),
      resourceCommitted ? rm(resourceRoot, { recursive: true, force: true }) : Promise.resolve(),
      quarantineCommitted ? rm(quarantineRoot, { recursive: true, force: true }) : Promise.resolve(),
    ])
    throw error
  }
}
