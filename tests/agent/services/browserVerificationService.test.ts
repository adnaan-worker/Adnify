import { describe, expect, it } from 'vitest'

import type { McpServerState } from '@shared/types/mcp'
import {
  buildBrowserVerificationPrompt,
  resolveBrowserVerificationCapability,
} from '@renderer/agent/services/browserVerificationService'

function createBrowserServerState(input: {
  id: string
  name: string
  presetId: 'playwright' | 'puppeteer'
  status?: McpServerState['status']
  toolNames?: string[]
}): McpServerState {
  return {
    id: input.id,
    config: {
      type: 'local',
      id: input.id,
      name: input.name,
      command: 'npx',
      args: [],
      presetId: input.presetId,
    },
    status: input.status ?? 'connected',
    tools: (input.toolNames ?? []).map((toolName) => ({
      name: toolName,
      inputSchema: { type: 'object' as const },
    })),
    resources: [],
    prompts: [],
  }
}

describe('browserVerificationService', () => {
  it('detects connected browser automation capability from preferred MCP presets', () => {
    const capability = resolveBrowserVerificationCapability([
      createBrowserServerState({
        id: 'playwright',
        name: 'Playwright',
        presetId: 'playwright',
        toolNames: ['browser_navigate', 'browser_screenshot', 'browser_click'],
      }),
    ])

    expect(capability).toMatchObject({
      available: true,
      provider: 'playwright',
      serverId: 'playwright',
      serverName: 'Playwright',
    })
    expect(capability.toolNames).toEqual(expect.arrayContaining(['browser_navigate', 'browser_screenshot']))
  })

  it('returns an explicit unavailable reason when a browser preset exists but is not connected', () => {
    const capability = resolveBrowserVerificationCapability([
      createBrowserServerState({
        id: 'playwright',
        name: 'Playwright',
        presetId: 'playwright',
        status: 'disconnected',
      }),
    ])

    expect(capability.available).toBe(false)
    expect(capability.reason).toContain('Playwright')
    expect(capability.reason).toContain('connected')
  })

  it('returns an explicit unavailable reason when browser tools are missing', () => {
    const capability = resolveBrowserVerificationCapability([
      createBrowserServerState({
        id: 'puppeteer',
        name: 'Puppeteer',
        presetId: 'puppeteer',
        toolNames: [],
      }),
    ])

    expect(capability.available).toBe(false)
    expect(capability.reason).toContain('Puppeteer')
    expect(capability.reason).toContain('browser tools')
  })

  it('builds a browser verification prompt with explicit blocked fallback guidance', () => {
    const prompt = buildBrowserVerificationPrompt({
      objective: 'Verify the settings navigation and copy readability',
      workPackageTitle: 'Validate settings page in browser mode',
      provider: 'playwright',
      serverName: 'Playwright',
      changedFiles: ['src/renderer/components/settings/tabs/AgentSettings.tsx'],
      baseUrl: 'http://127.0.0.1:3000/settings',
    })

    expect(prompt).toContain('Verify the settings navigation and copy readability')
    expect(prompt).toContain('Playwright')
    expect(prompt).toContain('http://127.0.0.1:3000/settings')
    expect(prompt).toContain('BLOCKED')
    expect(prompt).toContain('src/renderer/components/settings/tabs/AgentSettings.tsx')
  })
})
