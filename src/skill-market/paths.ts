import { join, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

export interface SkillMarketPaths {
  readonly root: string
  readonly catalog: string
  readonly artifacts: string
  readonly store: string
  readonly quarantine: string
  readonly staging: string
  readonly trash: string
  readonly diffCache: string
  readonly lockfile: string
  readonly mutationLock: string
}

export function resolveSkillMarketPaths(configuredDshHome?: string): SkillMarketPaths {
  const root = resolve(resolveDshHome(configuredDshHome), 'dsh-godot-ai/skill-market/v1')
  return {
    root,
    catalog: join(root, 'catalog'),
    artifacts: join(root, 'artifacts'),
    store: join(root, 'store'),
    quarantine: join(root, 'quarantine'),
    staging: join(root, 'staging'),
    trash: join(root, 'trash'),
    diffCache: join(root, 'cache/diffs'),
    lockfile: join(root, 'lockfile.json'),
    mutationLock: join(root, '.lockfile.lock'),
  }
}
