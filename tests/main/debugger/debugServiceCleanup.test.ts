import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

import { DebugServiceClass } from '@main/services/debugger/DebugService'

describe('debug service cleanup', () => {
  it('stops all active sessions and clears the registry', async () => {
    const service = new DebugServiceClass() as any
    const nodeAdapter = { disconnect: vi.fn().mockResolvedValue(undefined) }
    const dapClient = {
      disconnect: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    }

    service.sessions.set('node-session', {
      id: 'node-session',
      config: { type: 'node' },
      state: 'running',
      nodeAdapter,
      breakpoints: new Map(),
      capabilities: {},
    })
    service.sessions.set('dap-session', {
      id: 'dap-session',
      config: { type: 'python' },
      state: 'running',
      dapClient,
      breakpoints: new Map(),
      capabilities: {},
    })
    service.activeSessionId = 'dap-session'

    await service.cleanupAllSessions()

    expect(nodeAdapter.disconnect).toHaveBeenCalledTimes(1)
    expect(dapClient.disconnect).toHaveBeenCalledTimes(1)
    expect(dapClient.stop).toHaveBeenCalledTimes(1)
    expect(service.sessions.size).toBe(0)
    expect(service.activeSessionId).toBeNull()
  })
})
