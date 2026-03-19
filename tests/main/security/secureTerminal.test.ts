import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, Function>()
const childSpawnMock = vi.fn()
const ptySpawnMock = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: class MockBrowserWindow {},
  ipcMain: {
    on: vi.fn(),
  },
}))

vi.mock('child_process', () => ({
  spawn: childSpawnMock,
  execSync: vi.fn(),
  execFile: vi.fn(),
}))

vi.mock('node-pty', () => ({
  spawn: ptySpawnMock,
}))

vi.mock('@shared/utils/Logger', () => ({
  logger: {
    security: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}))

vi.mock('@shared/utils/errorHandler', () => ({
  toAppError: (err: unknown) => err instanceof Error ? err : new Error(String(err)),
}))

vi.mock('@main/ipc/safeHandle', () => ({
  safeIpcHandle: vi.fn((channel: string, handler: Function) => {
    handlers.set(channel, handler)
  }),
}))

vi.mock('@main/security/securityModule', () => ({
  OperationType: {
    TERMINAL_INTERACTIVE: 'terminal:interactive',
    SHELL_EXECUTE: 'shell:execute',
    GIT_EXEC: 'git:execute',
  },
  securityManager: {
    validateWorkspacePath: vi.fn(() => true),
    logOperation: vi.fn(),
    checkPermission: vi.fn(async () => true),
  },
}))

describe('secureTerminal', () => {
  beforeEach(() => {
    handlers.clear()
    childSpawnMock.mockReset()
    ptySpawnMock.mockReset()
  })

  afterEach(async () => {
    const module = await import('@main/security/secureTerminal')
    module.cleanupTerminals()
    vi.restoreAllMocks()
  })

  it('falls back to pipe on macOS even when PTY backend is requested', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')

    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const stdin = { destroyed: false, write: vi.fn() }
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      stdin: typeof stdin
      killed: boolean
      pid?: number
      kill: ReturnType<typeof vi.fn>
    }
    child.stdout = stdout
    child.stderr = stderr
    child.stdin = stdin
    child.killed = false
    child.pid = 12345
    child.kill = vi.fn(() => {
      child.killed = true
      return true
    })

    childSpawnMock.mockReturnValue(child)

    const module = await import('@main/security/secureTerminal')
    module.registerSecureTerminalHandlers(
      () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any,
      () => ({ roots: ['/Users/tech/Documents/dev/NodeProj/Adnify'] }),
    )

    const handler = handlers.get('terminal:interactive')
    expect(handler).toBeTypeOf('function')

    const result = await handler?.({}, {
      id: 'agent-test',
      cwd: '/Users/tech/Documents/dev/NodeProj/Adnify',
      backend: 'pty',
    })

    expect(result).toEqual({ success: true })
    expect(childSpawnMock).toHaveBeenCalledTimes(1)
    expect(ptySpawnMock).not.toHaveBeenCalled()
  })
})
