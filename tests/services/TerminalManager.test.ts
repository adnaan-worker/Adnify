import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const terminalMocks = vi.hoisted(() => ({
  create: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  onData: vi.fn(() => vi.fn()),
  onExit: vi.fn(() => vi.fn()),
  onError: vi.fn(() => vi.fn()),
}))

vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    terminal: terminalMocks,
  },
}))

vi.mock('@utils/Logger', () => ({
  logger: {
    system: {
      info: vi.fn(),
      error: vi.fn(),
    },
  },
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {},
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class MockFitAddon {},
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class MockWebLinksAddon {},
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class MockWebglAddon {
    onContextLoss() {
      return undefined
    }

    dispose() {
      return undefined
    }
  },
}))

import { terminalManager } from '@renderer/services/TerminalManager'

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

describe('TerminalManager macOS backend safety', () => {
  beforeEach(() => {
    terminalManager.cleanup()
    vi.clearAllMocks()
    setPlatform('darwin')
    terminalMocks.create.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    terminalManager.cleanup()
    setPlatform(originalPlatform)
  })

  it('uses pipe when no backend is provided on macOS', async () => {
    await terminalManager.createTerminal({
      cwd: '/tmp/adnify-project',
      name: 'Terminal',
    })

    expect(terminalMocks.create).toHaveBeenCalledTimes(1)
    expect(terminalMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/adnify-project',
        backend: 'pipe',
      }),
    )
  })

  it('downgrades explicit PTY requests to pipe on macOS', async () => {
    await terminalManager.createTerminal({
      cwd: '/tmp/adnify-project',
      name: 'Terminal',
      backend: 'pty',
    })

    expect(terminalMocks.create).toHaveBeenCalledTimes(1)
    expect(terminalMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/adnify-project',
        backend: 'pipe',
      }),
    )
  })
})
