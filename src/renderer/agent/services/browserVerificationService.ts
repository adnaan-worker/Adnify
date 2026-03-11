import { mcpService } from '@renderer/services/mcpService'
import type { McpServerState } from '@shared/types/mcp'

export type BrowserAutomationProvider = 'playwright' | 'puppeteer'

export interface BrowserVerificationCapability {
  available: boolean
  provider: BrowserAutomationProvider | null
  serverId: string | null
  serverName: string | null
  toolNames: string[]
  reason: string | null
}

export interface BrowserVerificationPromptInput {
  objective: string
  workPackageTitle: string
  provider: BrowserAutomationProvider
  serverName: string
  changedFiles?: string[]
  baseUrl?: string
}

const PROVIDER_PREFERENCE: BrowserAutomationProvider[] = ['playwright', 'puppeteer']
const PROVIDER_TOOL_PREFIX: Record<BrowserAutomationProvider, string> = {
  playwright: 'browser_',
  puppeteer: 'puppeteer_',
}

function matchesProvider(server: McpServerState, provider: BrowserAutomationProvider): boolean {
  return server.id === provider || server.config.id === provider || server.config.presetId === provider
}

function getBrowserToolNames(server: McpServerState, provider: BrowserAutomationProvider): string[] {
  const prefix = PROVIDER_TOOL_PREFIX[provider]
  return server.tools
    .map((tool) => tool.name)
    .filter((toolName) => toolName.startsWith(prefix))
}

function buildDisconnectedReason(server: McpServerState): string {
  return `${server.config.name} MCP server is not connected. Connect it before running browser verification.`
}

function buildMissingToolsReason(server: McpServerState): string {
  return `${server.config.name} MCP server is connected but browser tools are unavailable. Refresh capabilities or reconnect the server.`
}

export function resolveBrowserVerificationCapability(servers: McpServerState[]): BrowserVerificationCapability {
  const allCandidates = PROVIDER_PREFERENCE.flatMap((provider) =>
    servers
      .filter((server) => matchesProvider(server, provider))
      .map((server) => ({ provider, server, toolNames: getBrowserToolNames(server, provider) })),
  )

  const available = allCandidates.find(({ server, toolNames }) => server.status === 'connected' && toolNames.length > 0)
  if (available) {
    return {
      available: true,
      provider: available.provider,
      serverId: available.server.id,
      serverName: available.server.config.name,
      toolNames: available.toolNames,
      reason: null,
    }
  }

  const disconnected = allCandidates.find(({ server }) => server.status !== 'connected')
  if (disconnected) {
    return {
      available: false,
      provider: null,
      serverId: disconnected.server.id,
      serverName: disconnected.server.config.name,
      toolNames: [],
      reason: buildDisconnectedReason(disconnected.server),
    }
  }

  const missingTools = allCandidates.find(({ server, toolNames }) => server.status === 'connected' && toolNames.length === 0)
  if (missingTools) {
    return {
      available: false,
      provider: null,
      serverId: missingTools.server.id,
      serverName: missingTools.server.config.name,
      toolNames: [],
      reason: buildMissingToolsReason(missingTools.server),
    }
  }

  return {
    available: false,
    provider: null,
    serverId: null,
    serverName: null,
    toolNames: [],
    reason: 'No Playwright or Puppeteer MCP server is configured for browser verification.',
  }
}

export function getBrowserVerificationCapability(): BrowserVerificationCapability {
  return resolveBrowserVerificationCapability(mcpService.getServersStateSnapshot())
}

export function buildBrowserVerificationPrompt(input: BrowserVerificationPromptInput): string {
  const lines: string[] = []

  lines.push('# Browser Verification Request')
  lines.push('')
  lines.push(`## Objective: ${input.objective}`)
  lines.push(`## Work Package: ${input.workPackageTitle}`)
  lines.push('')
  lines.push('### Browser Automation')
  lines.push(`- Use the connected ${input.serverName} MCP server (${input.provider}) to validate the rendered experience.`)
  lines.push('- Do not claim success unless you actually exercised the flow in the browser and captured the result.')
  lines.push('- If browser automation cannot run, respond with BLOCKED and include the exact failure reason.')
  lines.push('')

  if (input.baseUrl) {
    lines.push('### Target URL')
    lines.push(input.baseUrl)
    lines.push('')
  }

  if ((input.changedFiles || []).length > 0) {
    lines.push('### Changed Files to Focus On')
    lines.push((input.changedFiles || []).map((file) => `- ${file}`).join('\n'))
    lines.push('')
  }

  lines.push('### Expected Output')
  lines.push('- List the browser steps you executed')
  lines.push('- Report pass/fail for each key interaction')
  lines.push('- If blocked, return BLOCKED instead of inventing a pass result')

  return lines.join('\n')
}
