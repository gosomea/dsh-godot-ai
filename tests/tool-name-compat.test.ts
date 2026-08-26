import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { preserveStreamedToolNames } from '../src/agent/tool-name-compat.js'

async function collect(chunks: StreamChunk[]): Promise<StreamChunk[]> {
  async function* source(): AsyncGenerator<StreamChunk> {
    yield* chunks
  }
  const result: StreamChunk[] = []
  for await (const chunk of preserveStreamedToolNames(source())) result.push(chunk)
  return result
}

describe('preserveStreamedToolNames', () => {
  it('preserves the first non-empty name across gateway empty-name deltas', async () => {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'call-1' as never, name: 'run_code', argumentsDelta: '' },
      { type: 'tool-call-delta', index: 0, id: 'call-1' as never, name: '', argumentsDelta: '{"code":"return 1"}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-1' as never, name: '', arguments: '{"code":"return 1"}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]

    const normalized = await collect(chunks)
    expect(normalized[2]).toMatchObject({ name: 'run_code' })
    expect(normalized[3]).toMatchObject({ block: { name: 'run_code' } })
  })

  it('does not guess when no non-empty name was observed', async () => {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'call-1' as never, name: '', argumentsDelta: '{}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-1' as never, name: '', arguments: '{}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]

    expect(await collect(chunks)).toEqual(chunks)
  })
})
