import fs from 'fs'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'events'
import Module from 'module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, Function>()
const childSpawnMock = vi.fn()
const ptySpawnMock = vi.fn()
const tempPathsToCleanup = new Set<string>()

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempPathsToCleanup.add(dir)
  return dir
}

function matchesWorkspaceRoots(candidatePath: string, workspaceRoots: string | string[]): boolean {
  const roots = Array.isArray(workspaceRoots) ? workspaceRoots : [workspaceRoots]
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root)
    const resolvedCandidate = path.resolve(candidatePath)
    return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  })
}

class MockSshClient extends EventEmitter {
  shell(_options: unknown, callback: (error: Error | undefined, stream: EventEmitter & {
    write: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
    setWindow: ReturnType<typeof vi.fn>
  }) => void) {
    const stream = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof vi.fn>
      end: ReturnType<typeof vi.fn>
      setWindow: ReturnType<typeof vi.fn>
    }
    stream.write = vi.fn()
    stream.end = vi.fn()
    stream.setWindow = vi.fn()
    callback(undefined, stream)
  }

  connect() {
    queueMicrotask(() => this.emit('ready'))
    return this
  }

  end() {
    this.emit('close')
    return this
  }
}

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
    vi.resetModules()
  })

  afterEach(async () => {
    const isolatedWorkspaceModule = await import('@main/security/isolatedWorkspace')
    const module = await import('@main/security/secureTerminal')
    await isolatedWorkspaceModule.cleanupAllIsolatedWorkspaces()
    isolatedWorkspaceModule.__testing.clearRegistry()
    for (const targetPath of tempPathsToCleanup) {
      fs.rmSync(targetPath, { recursive: true, force: true })
    }
    tempPathsToCleanup.clear()
    module.cleanupTerminals()
    vi.restoreAllMocks()
  })

  it('falls back to pipe on macOS even when PTY backend is requested', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const workspaceRoot = makeTempDir('adnify-workspace-')

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
      () => ({ roots: [workspaceRoot] }),
    )

    const handler = handlers.get('terminal:interactive')
    expect(handler).toBeTypeOf('function')

    const result = await handler?.({}, {
      id: 'agent-test',
      cwd: workspaceRoot,
      backend: 'pty',
    })

    expect(result).toEqual({ success: true })
    expect(childSpawnMock).toHaveBeenCalledTimes(1)
    expect(ptySpawnMock).not.toHaveBeenCalled()
  })

  it('allows interactive terminals inside registered isolated workspaces', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')

    const workspaceRoot = makeTempDir('adnify-workspace-')
    const isolatedWorkspace = makeTempDir('adnify-isolated-')
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
    child.pid = 12346
    child.kill = vi.fn(() => {
      child.killed = true
      return true
    })

    childSpawnMock.mockReturnValue(child)

    const isolatedWorkspaceModule = await import('@main/security/isolatedWorkspace')
    const { securityManager } = await import('@main/security/securityModule')
    vi.mocked(securityManager.validateWorkspacePath).mockImplementation(matchesWorkspaceRoots)

    isolatedWorkspaceModule.__testing.registerRecord({
      ownerId: 'task-terminal:pkg-1',
      taskId: 'task-terminal',
      sourcePath: workspaceRoot,
      workspacePath: isolatedWorkspace,
      mode: 'copy',
    })

    const module = await import('@main/security/secureTerminal')
    module.registerSecureTerminalHandlers(
      () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any,
      () => ({ roots: [workspaceRoot] }),
    )

    const handler = handlers.get('terminal:interactive')
    expect(handler).toBeTypeOf('function')

    const result = await handler?.({}, {
      id: 'isolated-test',
      cwd: isolatedWorkspace,
      backend: 'pty',
    })

    expect(result).toEqual({ success: true })
    expect(securityManager.validateWorkspacePath).toHaveBeenCalledWith(
      isolatedWorkspace,
      expect.arrayContaining([workspaceRoot, isolatedWorkspace]),
    )
  })

  it('skips local workspace validation for remote interactive terminals', async () => {
    const workspaceRoot = makeTempDir('adnify-workspace-')
    const originalRequire = Module.prototype.require

    const { securityManager } = await import('@main/security/securityModule')
    vi.mocked(securityManager.validateWorkspacePath).mockReset()
    vi.mocked(securityManager.validateWorkspacePath).mockReturnValue(false)
    vi.spyOn(Module.prototype, 'require').mockImplementation(function(this: NodeJS.Module, id: string) {
      if (id === 'ssh2') {
        return { Client: MockSshClient }
      }
      return originalRequire.apply(this, [id])
    })

    const module = await import('@main/security/secureTerminal')
    module.registerSecureTerminalHandlers(
      () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any,
      () => ({ roots: [workspaceRoot] }),
    )

    const handler = handlers.get('terminal:interactive')
    expect(handler).toBeTypeOf('function')

    const result = await handler?.({}, {
      id: 'remote-test',
      cwd: workspaceRoot,
      remote: {
        host: 'example.com',
        username: 'root',
      },
    })

    expect(result).toEqual({ success: true })
    expect(securityManager.validateWorkspacePath).not.toHaveBeenCalled()
  })
})
