import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import {
  SKILL_MARKET_API_PREFIX,
  SkillMarketService,
  parseSkillInspectRequest,
  parseSkillInstallRequest,
  parseSkillMarketAction,
} from '../skill-market/service.js'
import { SkillMarketRevisionConflictError } from '../skill-market/lockfile.js'
import { CatalogFetchRateLimitError } from '../skill-market/catalog-fetch.js'
import { GitHubRateLimitError } from '../skill-market/github-import.js'
import { assertJsonRequest, assertTrustedRequest } from './request-trust.js'

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

async function readJson(req: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    bytes += buffer.byteLength
    if (bytes > maxBytes) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function errorStatus(error: unknown): number {
  if (error instanceof SkillMarketRevisionConflictError) return 409
  if (error instanceof CatalogFetchRateLimitError || error instanceof GitHubRateLimitError) return 429
  return 400
}

function exact(
  method: 'GET' | 'POST',
  handler: (req: IncomingMessage) => Promise<unknown>,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      assertTrustedRequest(req)
      if (req.method !== method) { sendJson(res, 405, { error: 'method not allowed' }); return }
      if (method === 'POST') assertJsonRequest(req)
      sendJson(res, 200, await handler(req))
    } catch (error) {
      sendJson(res, errorStatus(error), { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** Register the deliberately small five-route Skill Market API. */
export function registerSkillMarketRoutes(webServer: WebServer, service: SkillMarketService): () => void {
  const disposers = [
    webServer.register({
      kind: 'exact',
      path: SKILL_MARKET_API_PREFIX,
      handler: exact('GET', async () => ({ market: await service.snapshot(), inspections: await service.inspections() })),
    }),
    webServer.register({
      kind: 'prefix',
      path: `${SKILL_MARKET_API_PREFIX}/diff`,
      handler: exact('GET', async req => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
        const prefix = `${SKILL_MARKET_API_PREFIX}/diff/`
        if (!pathname.startsWith(prefix)) throw new Error('diff route requires a Skill id')
        const encoded = pathname.slice(prefix.length)
        if (encoded === '' || encoded.includes('/')) throw new Error('diff route has an invalid Skill id')
        return { diff: await service.diffSummary(decodeURIComponent(encoded)) }
      }),
    }),
    webServer.register({
      kind: 'exact',
      path: `${SKILL_MARKET_API_PREFIX}/inspect`,
      handler: exact('POST', async req => ({ inspection: await service.inspect(parseSkillInspectRequest(await readJson(req))) })),
    }),
    webServer.register({
      kind: 'exact',
      path: `${SKILL_MARKET_API_PREFIX}/install`,
      handler: exact('POST', async req => ({ installed: await service.install(parseSkillInstallRequest(await readJson(req))) })),
    }),
    webServer.register({
      kind: 'exact',
      path: `${SKILL_MARKET_API_PREFIX}/action`,
      handler: exact('POST', async req => ({ result: await service.action(parseSkillMarketAction(await readJson(req))) })),
    }),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
