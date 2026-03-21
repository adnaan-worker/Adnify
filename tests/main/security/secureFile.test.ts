import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, Function>()
const tempPathsToCleanup = new Set<string>()
const readFileWithEncodingMock = vi.fn()
const readLargeFileMock = vi.fn()

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

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler)
    }),
  },
  dialog: {
    showErrorBox: vi.fn(),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}))

vi.mock('electron-store', () => ({
  default: class MockStore {
    get = vi.fn(() => ({}))
    delete = vi.fn()
  },
}))

vi.mock('@shared/utils/Logger', () => ({
  logger: {
    security: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  },
}))

vi.mock('@shared/utils/errorHandler', () => ({
  ErrorCode: {
    FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  },
  toAppError: (err: unknown) => {
    if (err && typeof err === 'object' && 'code' in err) {
      return err
    }
    return err instanceof Error ? err : new Error(String(err))
  },
}))

vi.mock('@main/security/fileUtils', () => ({
  readFileWithEncoding: readFileWithEncodingMock,
  readLargeFile: readLargeFileMock,
}))

vi.mock('@main/security/fileWatcher', () => ({
  cleanupFileWatcher: vi.fn(),
  setupFileWatcher: vi.fn(),
}))

vi.mock('@main/security/workspaceHandlers', () => ({
  registerWorkspaceHandlers: vi.fn(),
}))

vi.mock('@main/security/securityModule', () => ({
  OperationType: {
    FILE_DELETE: 'file:delete',
    FILE_READ: 'file:read',
    FILE_RENAME: 'file:rename',
    FILE_WRITE: 'file:write',
  },
  securityManager: {
    isSensitivePath: vi.fn(() => false),
    logOperation: vi.fn(),
    validateWorkspacePath: vi.fn(() => true),
  },
}))

describe('secureFile workspace protections', () => {
  beforeEach(() => {
    handlers.clear()
    readFileWithEncodingMock.mockReset()
    readLargeFileMock.mockReset()
    vi.resetModules()
  })

  afterEach(async () => {
    const isolatedWorkspaceModule = await import('@main/security/isolatedWorkspace')
    await isolatedWorkspaceModule.cleanupAllIsolatedWorkspaces()
    isolatedWorkspaceModule.__testing.clearRegistry()

    for (const targetPath of tempPathsToCleanup) {
      fs.rmSync(targetPath, { recursive: true, force: true })
    }
    tempPathsToCleanup.clear()
    vi.restoreAllMocks()
  })

  it('ignores virtual protocol reads before touching the filesystem or workspace validation', async () => {
    const statSpy = vi.spyOn(fs.promises, 'stat')
    const { registerSecureFileHandlers } = await import('@main/security/secureFile')
    const { securityManager } = await import('@main/security/securityModule')

    registerSecureFileHandlers(
      () => null,
      {},
      () => ({ roots: [makeTempDir('adnify-workspace-')] }),
    )

    const handler = handlers.get('file:read')
    expect(handler).toBeTypeOf('function')

    const result = await handler?.({}, 'git-diff://repo/src/main.ts')

    expect(result).toBeNull()
    expect(statSpy).not.toHaveBeenCalled()
    expect(securityManager.validateWorkspacePath).not.toHaveBeenCalled()
    expect(readFileWithEncodingMock).not.toHaveBeenCalled()
    expect(readLargeFileMock).not.toHaveBeenCalled()
  })

  it('allows mkdir inside a registered isolated workspace root', async () => {
    const workspaceRoot = makeTempDir('adnify-workspace-')
    const isolatedWorkspace = makeTempDir('adnify-isolated-')
    const targetDir = path.join(isolatedWorkspace, 'nested', 'dir')

    const isolatedWorkspaceModule = await import('@main/security/isolatedWorkspace')
    const { securityManager } = await import('@main/security/securityModule')
    vi.mocked(securityManager.validateWorkspacePath).mockImplementation(matchesWorkspaceRoots)

    isolatedWorkspaceModule.__testing.registerRecord({
      ownerId: 'task-a:pkg-1',
      taskId: 'task-a',
      sourcePath: workspaceRoot,
      workspacePath: isolatedWorkspace,
      mode: 'copy',
    })

    const { registerSecureFileHandlers } = await import('@main/security/secureFile')
    registerSecureFileHandlers(
      () => null,
      {},
      () => ({ roots: [workspaceRoot] }),
    )

    const handler = handlers.get('file:mkdir')
    expect(handler).toBeTypeOf('function')

    const result = await handler?.({}, targetDir)

    expect(result).toBe(true)
    expect(fs.existsSync(targetDir)).toBe(true)
    expect(securityManager.validateWorkspacePath).toHaveBeenCalledWith(
      targetDir,
      expect.arrayContaining([workspaceRoot, isolatedWorkspace]),
    )
  })

  it('blocks file writes outside accessible roots even when task-driven isolated workspaces exist', async () => {
    const workspaceRoot = makeTempDir('adnify-workspace-')
    const isolatedWorkspace = makeTempDir('adnify-isolated-')
    const outsideRoot = makeTempDir('adnify-outside-')
    const targetFile = path.join(outsideRoot, 'escape.ts')

    const isolatedWorkspaceModule = await import('@main/security/isolatedWorkspace')
    const { securityManager } = await import('@main/security/securityModule')
    vi.mocked(securityManager.validateWorkspacePath).mockImplementation(matchesWorkspaceRoots)

    isolatedWorkspaceModule.__testing.registerRecord({
      taskId: 'task-write',
      sourcePath: workspaceRoot,
      workspacePath: isolatedWorkspace,
      mode: 'copy',
    })

    const { registerSecureFileHandlers } = await import('@main/security/secureFile')
    registerSecureFileHandlers(
      () => null,
      {},
      () => ({ roots: [workspaceRoot] }),
    )

    const handler = handlers.get('file:write')
    expect(handler).toBeTypeOf('function')

    const result = await handler?.({}, targetFile, 'export const escaped = true\n')

    expect(result).toBe(false)
    expect(fs.existsSync(targetFile)).toBe(false)
    expect(securityManager.validateWorkspacePath).toHaveBeenCalledWith(
      targetFile,
      expect.arrayContaining([workspaceRoot, isolatedWorkspace]),
    )
  })

  it('blocks renames that escape the accessible workspace roots', async () => {
    const workspaceRoot = makeTempDir('adnify-workspace-')
    const outsideRoot = makeTempDir('adnify-outside-')
    const sourcePath = path.join(workspaceRoot, 'source.txt')
    const targetPath = path.join(outsideRoot, 'renamed.txt')

    fs.writeFileSync(sourcePath, 'hello', 'utf-8')

    const { securityManager } = await import('@main/security/securityModule')
    vi.mocked(securityManager.validateWorkspacePath).mockImplementation(matchesWorkspaceRoots)

    const { registerSecureFileHandlers } = await import('@main/security/secureFile')
    registerSecureFileHandlers(
      () => null,
      {},
      () => ({ roots: [workspaceRoot] }),
    )

    const handler = handlers.get('file:rename')
    expect(handler).toBeTypeOf('function')

    const result = await handler?.({}, sourcePath, targetPath)

    expect(result).toBe(false)
    expect(fs.existsSync(sourcePath)).toBe(true)
    expect(fs.existsSync(targetPath)).toBe(false)
  })
})
