import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * rc8's DeepSeek stream translator accepts the first non-empty tool name, but
 * then overwrites it when an OpenAI-compatible gateway repeats `name: ""` on
 * later argument deltas. Preserve the last non-empty name for that block.
 *
 * Missing names are deliberately not guessed: without a previously observed
 * non-empty name there is no safe recovery signal.
 */
export async function* preserveStreamedToolNames(
  stream: AsyncIterable<StreamChunk>,
): AsyncGenerator<StreamChunk> {
  const names = new Map<number, string>()
  for await (const chunk of stream) {
    if (chunk.type === 'tool-call-delta') {
      if (typeof chunk.name === 'string' && chunk.name.length > 0) {
        names.set(chunk.index, chunk.name)
        yield chunk
        continue
      }
      const remembered = names.get(chunk.index)
      if (chunk.name === '' && remembered !== undefined) {
        yield { ...chunk, name: remembered }
        continue
      }
    } else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
      const remembered = names.get(chunk.index)
      if (chunk.block.name === '' && remembered !== undefined) {
        yield { ...chunk, block: { ...chunk.block, name: remembered } }
        continue
      }
    }
    yield chunk
  }
}

/** Install the compatibility wrapper only for sessions owned by one managed preset. */
export function installToolNameCompatibility(ctx: Context, presetId: string): void {
  const agents = new Map<string, Agent>()

  ctx.on('agent/created', ({ agent }) => {
    if (resolveSessionPreset(agent.session) === presetId) agents.set(agent.id, agent)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    if (agents.get(agent.id) === agent) agents.delete(agent.id)
  })

  ctx.on('llm/stream', (options: GenerateOptions, next) => {
    const sessionId = options.sessionId === undefined ? undefined : String(options.sessionId)
    if (sessionId === undefined || !agents.has(sessionId)) return next()
    return preserveStreamedToolNames(next())
  })
}
