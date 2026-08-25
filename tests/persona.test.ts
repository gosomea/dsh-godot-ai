import { describe, expect, it } from 'vitest'
import compatibility from '../compatibility.json'
import { renderGodotCreatorPersona } from '../src/agent/persona.js'
import { loadWorkflowCatalog } from '../src/agent/workflows.js'
import { parseCompatibilityManifest } from '../src/core/compatibility.js'

describe('Godot Creator persona', () => {
  it('defines the full game-creation and PTC verification contract', async () => {
    const persona = renderGodotCreatorPersona(
      parseCompatibilityManifest(compatibility),
      await loadWorkflowCatalog(),
    )

    for (const expected of [
      '多个 editor session',
      'godot-ai-orchestration',
      '只加载与任务匹配',
      '读－改－验',
      'read-back',
      '运行闭环',
      'errors、warnings',
      '部分失败',
      'run_code 是唯一可以直接调用的工具',
      '当前 TypeScript SDK',
      '通常不超过 20 条',
      'PTC 程序整体不是事务',
      '未连接 addon/editor',
      '创建 2D 游戏骨架',
      '创建 3D 可玩原型',
      '添加菜单、HUD 与暂停流程',
    ]) expect(persona).toContain(expected)
  })
})
