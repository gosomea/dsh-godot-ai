import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it, vi } from 'vitest'
import { registerSkillMarketRoutes } from '../src/host/skill-market-routes.js'
import { SKILL_MARKET_API_PREFIX, type SkillMarketService } from '../src/skill-market/service.js'

function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as IncomingMessage
  Object.assign(stream, {
    method,
    url,
    headers: { host: 'localhost:3080', origin: 'http://localhost:3080', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
  })
  return stream
}

function response() {
  const output = { status: 0, headers: {} as Record<string, string>, body: '' }
  const res = {
    writeHead(status: number, headers: Record<string, string>) { output.status = status; output.headers = headers },
    end(body: string) { output.body = body },
  } as unknown as ServerResponse
  return { res, output }
}

describe('Skill Market host routes', () => {
  it('registers exactly the five documented routes and reuses the loopback trust boundary', async () => {
    const routes: WebRoute[] = []
    const webServer = { register: vi.fn((route: WebRoute) => { routes.push(route); return () => undefined }) } as unknown as WebServer
    const service = {
      snapshot: vi.fn(async () => ({ revision: 0 })),
      inspections: vi.fn(async () => []),
      diffSummary: vi.fn(async skillId => ({ skillId, changed: false })),
      inspect: vi.fn(),
      install: vi.fn(),
      action: vi.fn(),
    } as unknown as SkillMarketService
    registerSkillMarketRoutes(webServer, service)

    expect(routes.map(route => [route.kind, route.path])).toEqual([
      ['exact', SKILL_MARKET_API_PREFIX],
      ['prefix', `${SKILL_MARKET_API_PREFIX}/diff`],
      ['exact', `${SKILL_MARKET_API_PREFIX}/inspect`],
      ['exact', `${SKILL_MARKET_API_PREFIX}/install`],
      ['exact', `${SKILL_MARKET_API_PREFIX}/action`],
    ])

    const trusted = response()
    await routes[0]!.handler(request('GET', SKILL_MARKET_API_PREFIX), trusted.res)
    expect(trusted.output.status).toBe(200)
    expect(trusted.output.headers['x-content-type-options']).toBe('nosniff')
    expect(service.snapshot).toHaveBeenCalledTimes(1)

    const crossSite = response()
    await routes[0]!.handler(request('GET', SKILL_MARKET_API_PREFIX, undefined, { 'sec-fetch-site': 'cross-site' }), crossSite.res)
    expect(crossSite.output.status).toBe(400)
    expect(JSON.parse(crossSite.output.body)).toMatchObject({ error: expect.stringMatching(/cross-site/) })
  })

  it('requires JSON and validates action unions before calling the service', async () => {
    const routes: WebRoute[] = []
    const webServer = { register: (route: WebRoute) => { routes.push(route); return () => undefined } } as unknown as WebServer
    const service = {
      snapshot: vi.fn(), inspections: vi.fn(), diffSummary: vi.fn(), inspect: vi.fn(), install: vi.fn(), action: vi.fn(),
    } as unknown as SkillMarketService
    registerSkillMarketRoutes(webServer, service)
    const actionRoute = routes.find(route => route.path.endsWith('/action'))!

    const wrongType = response()
    await actionRoute.handler(request('POST', actionRoute.path, { action: 'gc' }, { 'content-type': 'text/plain' }), wrongType.res)
    expect(wrongType.output.status).toBe(400)
    expect(service.action).not.toHaveBeenCalled()

    const malformed = response()
    await actionRoute.handler(request('POST', actionRoute.path, { action: 'enable', skillId: '../x' }, { 'content-type': 'application/json' }), malformed.res)
    expect(malformed.output.status).toBe(400)
    expect(service.action).not.toHaveBeenCalled()
  })

  it('serves only one encoded Skill id from the bounded diff route', async () => {
    const routes: WebRoute[] = []
    const webServer = { register: (route: WebRoute) => { routes.push(route); return () => undefined } } as unknown as WebServer
    const service = {
      snapshot: vi.fn(), inspections: vi.fn(),
      diffSummary: vi.fn(async skillId => ({ skillId, changed: true, diff: { patch: '+safe' } })),
      inspect: vi.fn(), install: vi.fn(), action: vi.fn(),
    } as unknown as SkillMarketService
    registerSkillMarketRoutes(webServer, service)
    const diffRoute = routes.find(route => route.path.endsWith('/diff'))!

    const valid = response()
    await diffRoute.handler(request('GET', `${diffRoute.path}/game-feel`), valid.res)
    expect(valid.output.status).toBe(200)
    expect(service.diffSummary).toHaveBeenCalledWith('game-feel')
    expect(JSON.parse(valid.output.body)).toMatchObject({ diff: { skillId: 'game-feel', changed: true } })

    const nested = response()
    await diffRoute.handler(request('GET', `${diffRoute.path}/game-feel/escape`), nested.res)
    expect(nested.output.status).toBe(400)
    expect(service.diffSummary).toHaveBeenCalledTimes(1)
  })
})
