import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { assertJsonRequest, assertTrustedRequest } from '../src/host/request-trust.js'

function request(headers: Record<string, string> = {}, remoteAddress: string | null = '127.0.0.1'): IncomingMessage {
  return { headers, socket: { remoteAddress: remoteAddress ?? undefined } } as unknown as IncomingMessage
}

describe('managed preset HTTP trust boundary', () => {
  it('accepts same-origin loopback requests', () => {
    expect(() => { assertTrustedRequest(request({ host: 'localhost:3080', origin: 'http://localhost:3080' })) }).not.toThrow()
    expect(() => { assertTrustedRequest(request({ host: '127.20.30.40:3080' })) }).not.toThrow()
  })

  it('rejects cross-site, DNS-rebound, and non-loopback requests', () => {
    expect(() => { assertTrustedRequest(request({ host: 'evil.example:3080' })) }).toThrow(/Host/)
    expect(() => { assertTrustedRequest(request({ host: 'localhost:3080', 'sec-fetch-site': 'cross-site' })) }).toThrow(/cross-site/)
    expect(() => { assertTrustedRequest(request({ host: 'localhost:3080' }, '192.168.1.50')) }).toThrow(/loopback/)
  })

  it('requires JSON media type for mutations', () => {
    expect(() => { assertJsonRequest(request({ 'content-type': 'application/json; charset=utf-8' })) }).not.toThrow()
    expect(() => { assertJsonRequest(request({ 'content-type': 'text/plain' })) }).toThrow(/application\/json/)
  })
})
