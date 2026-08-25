import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUNDLED_GODOT_SKILL_NAMES, loadBundledGodotSkills, parseBundledSkill } from '../src/agent/skills.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('bundled Godot skills', () => {
  it('loads the exact scoped catalog with complete on-demand bodies', async () => {
    const skills = await loadBundledGodotSkills(join(root, 'skills'))
    expect(skills.map(skill => skill.name)).toEqual([...BUNDLED_GODOT_SKILL_NAMES])
    expect(skills).toHaveLength(16)
    for (const skill of skills) {
      expect(skill.source).toBe('bundled')
      expect(skill.provider).toBe('dsh-godot-ai')
      expect(skill.description.length).toBeGreaterThan(20)
      expect(skill.content.length).toBeGreaterThan(300)
      expect(skill.content).not.toContain('godot-mcp')
    }
    const orchestration = skills.find(skill => skill.name === 'godot-ai-orchestration')
    expect(orchestration?.content).toContain('45 个工具')
    expect(orchestration?.content).toContain('script_create')
    expect(orchestration?.content).toContain('game_status.status')
    expect(orchestration?.content).toContain('input_sequence')
    expect(orchestration?.content).toContain('最多约 20 条')
    expect(orchestration?.content).toContain('进入 `break`')
    expect(orchestration?.content).toContain('专用视觉桥')
    const ui = skills.find(skill => skill.name === 'godot-ui-control')
    expect(ui?.content).toContain('full-rect 根 Control 使用零 offsets')
    expect(ui?.content).toContain('input_key')
    expect(ui?.content).toContain('input_gamepad')
  })

  it('rejects malformed embedded skill files before registration', () => {
    expect(() => parseBundledSkill('missing frontmatter', '/tmp/bad/SKILL.md')).toThrow(/frontmatter/)
    expect(() => parseBundledSkill('---\nname: Bad_Name\ndescription: bad\n---\nbody', '/tmp/bad/SKILL.md'))
      .toThrow(/invalid name/)
  })
})
