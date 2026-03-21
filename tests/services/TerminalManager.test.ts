import { beforeEach, describe, expect, it, vi } from 'vitest'

const createMock = vi.fn()
const onDataCleanup = vi.fn()
const onExitCleanup = vi.fn()
const onErrorCleanup = vi.fn()

vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    terminal: {
      create: createMock,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => onDataCleanup),
      onExit: vi.fn(() => onExitCleanup),
      onError: vi.fn(() => onErrorCleanup),
    },
  },
}))

vi.mock('@renderer/settings', () => ({
  getEditorConfig: () => ({
    performance: {
      terminalBufferSize: 1000,
    },
  }),
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {
    options: Record<string, unknown> = {}
    write = vi.fn()
    focus = vi.fn()
    loadAddon = vi.fn()
    open = vi.fn()
    dispose = vi.fn()
    onData = vi.fn()
    onResize = vi.fn()
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class MockFitAddon {
    fit = vi.fn()
    dispose = vi.fn()
  },
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class MockWebLinksAddon {},
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class MockWebglAddon {
    dispose = vi.fn()
    onContextLoss = vi.fn()
  },
}))

vi.mock('@utils/Logger', () => ({
  logger: {
    system: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  },
}))

vi.mock('@services/keybindingService', () => ({
  isMac: true,
}))

vi.mock('@renderer/agent/tools/commandRuntime', () => ({
  getInteractiveTerminalBackend: vi.fn(() => 'pipe'),
}))

describe('TerminalManager', () => {
  beforeEach(() => {
    createMock.mockReset()
    createMock.mockResolvedValue({ success: true })
  })

  it('uses pipe backend for agent terminals on macOS', async () => {
    const { terminalManager } = await import('@renderer/services/TerminalManager')

    try {
      await terminalManager.getOrCreateAgentTerminal('/tmp/adnify-agent')

      expect(createMock).toHaveBeenCalledTimes(1)
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/tmp/adnify-agent',
          backend: 'pipe',
        }),
      )
    } finally {
      terminalManager.cleanup()
    }
  })
})
