import { describe, expect, it, vi } from 'vitest'

import { buildRuntimeCleanupTasks } from '@main/lifecycle/runtimeCleanup'

function createDeps() {
  return {
    cleanupAllHandlers: vi.fn(),
    stopAllLspServers: vi.fn(),
    destroyAllIndexServices: vi.fn(),
    cleanupAllIsolatedWorkspaces: vi.fn(),
    cleanupAllDebugSessions: vi.fn(),
    pruneExitedTerminals: vi.fn(() => 0),
  }
}

describe('runtime cleanup plan', () => {
  it('uses only conservative cleanup when all windows are closed on macOS', async () => {
    const deps = createDeps()

    const tasks = buildRuntimeCleanupTasks('window-all-closed', deps)
    await Promise.all(tasks.map((task) => task()))

    expect(deps.pruneExitedTerminals).toHaveBeenCalledTimes(1)
    expect(deps.stopAllLspServers).toHaveBeenCalledTimes(1)
    expect(deps.cleanupAllHandlers).not.toHaveBeenCalled()
    expect(deps.destroyAllIndexServices).not.toHaveBeenCalled()
    expect(deps.cleanupAllIsolatedWorkspaces).not.toHaveBeenCalled()
    expect(deps.cleanupAllDebugSessions).not.toHaveBeenCalled()
  })

  it('uses full cleanup before application quit', async () => {
    const deps = createDeps()

    const tasks = buildRuntimeCleanupTasks('before-quit', deps)
    await Promise.all(tasks.map((task) => task()))

    expect(deps.cleanupAllHandlers).toHaveBeenCalledTimes(1)
    expect(deps.stopAllLspServers).toHaveBeenCalledTimes(1)
    expect(deps.destroyAllIndexServices).toHaveBeenCalledTimes(1)
    expect(deps.cleanupAllIsolatedWorkspaces).toHaveBeenCalledTimes(1)
    expect(deps.cleanupAllDebugSessions).toHaveBeenCalledTimes(1)
    expect(deps.pruneExitedTerminals).not.toHaveBeenCalled()
  })
})
