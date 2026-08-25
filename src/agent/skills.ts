import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

export const BUNDLED_GODOT_SKILL_NAMES = [
  'godot-2d-movement',
  'godot-3d-essentials',
  'godot-ai-orchestration',
  'godot-animation',
  'godot-audio',
  'godot-csharp',
  'godot-export',
  'godot-gdscript',
  'godot-multiplayer',
  'godot-nodes-scenes',
  'godot-physics',
  'godot-resources',
  'godot-shaders',
  'godot-signals-groups',
  'godot-tilemap',
  'godot-ui-control',
] as const

function packageRoot(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  return basename(moduleDirectory) === 'agent' ? resolve(moduleDirectory, '../..') : resolve(moduleDirectory, '..')
}

function parseScalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) return JSON.parse(trimmed) as string
  return trimmed
}

export function parseBundledSkill(markdown: string, path: string): SkillRegistration {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown)
  if (match === null) throw new Error(`bundled Godot skill ${path} requires YAML frontmatter`)
  const metadata = Object.fromEntries(match[1]!.split(/\r?\n/).filter(Boolean).map(line => {
    const separator = line.indexOf(':')
    if (separator < 1) throw new Error(`invalid bundled Godot skill frontmatter in ${path}`)
    return [line.slice(0, separator).trim(), parseScalar(line.slice(separator + 1))]
  }))
  const name = metadata.name
  const description = metadata.description
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`bundled Godot skill ${path} has an invalid name`)
  }
  if (typeof description !== 'string' || description.length === 0) {
    throw new Error(`bundled Godot skill ${path} requires a description`)
  }
  const content = match[2]!.trim()
  if (content.length === 0) throw new Error(`bundled Godot skill ${path} has no content`)
  return {
    name,
    description,
    source: 'bundled',
    provider: 'dsh-godot-ai',
    path,
    content,
  }
}

export async function loadBundledGodotSkills(directory = join(packageRoot(), 'skills')): Promise<SkillRegistration[]> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  const expected = [...BUNDLED_GODOT_SKILL_NAMES]
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    throw new Error(`bundled Godot skill catalog mismatch: expected ${expected.join(', ')}, got ${entries.join(', ')}`)
  }
  return Promise.all(entries.map(async name => {
    const path = join(directory, name, 'SKILL.md')
    return parseBundledSkill(await readFile(path, 'utf8'), path)
  }))
}
