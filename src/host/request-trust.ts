import type { IncomingMessage } from 'node:http'

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  if (address === '::1') return true
  const ipv4 = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  return isLoopbackHostname(ipv4)
}

function hostUrl(authority: string | undefined): URL | undefined {
  if (authority === undefined) return undefined
  try { return new URL(`http://${authority}`) }
  catch { return undefined }
}

export function assertTrustedRequest(req: IncomingMessage): void {
  if (!isLoopbackAddress(req.socket.remoteAddress)) throw new Error('only loopback clients are allowed')
  const parsedHost = hostUrl(req.headers.host)
  if (parsedHost === undefined || !isLoopbackHostname(parsedHost.hostname)) throw new Error('untrusted Host header')
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new Error('cross-site requests are not allowed')
  const origin = req.headers.origin
  if (origin === undefined) return
  try {
    const parsedOrigin = new URL(origin)
    if ((parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') || parsedOrigin.host !== parsedHost.host) {
      throw new Error('cross-origin requests are not allowed')
    }
  } catch {
    throw new Error('cross-origin requests are not allowed')
  }
}

export function assertJsonRequest(req: IncomingMessage): void {
  const mediaType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') throw new Error('content type must be application/json')
}
