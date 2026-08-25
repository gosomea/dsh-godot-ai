import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import type { CompatibilityManifest } from '../core/compatibility.js'

export function createGodotMcpConfig(manifest: CompatibilityManifest): McpClientConfig {
  const config = manifest.godotAi
  const args = [
    '--link-mode', 'copy',
    '--from', `godot-ai==${config.defaultVersion}`,
    'godot-ai', 'attach',
    '--port', String(config.httpPort),
    '--ws-port', String(config.wsPort),
  ]
  if (config.excludeDomains.length > 0) args.push('--exclude-domains', config.excludeDomains.join(','))
  return Object.freeze({
    transport: 'stdio' as const,
    serverName: 'godot-ai',
    command: 'uvx',
    args: Object.freeze(args) as unknown as string[],
    env: {},
    cwd: '',
    toolCallTimeoutMs: config.toolCallTimeoutMs,
    failOnStartupError: false,
    reconnect: {
      enabled: true,
      initialDelayMs: config.reconnect.initialDelayMs,
      maxDelayMs: config.reconnect.maxDelayMs,
      maxAttempts: config.reconnect.maxAttempts,
    },
  })
}
