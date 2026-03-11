export type RuntimeCleanupReason = 'window-all-closed' | 'before-quit'

export interface RuntimeCleanupDeps {
  cleanupAllHandlers: () => unknown
  stopAllLspServers: () => unknown
  destroyAllIndexServices: () => unknown
  cleanupAllIsolatedWorkspaces: () => unknown
  cleanupAllDebugSessions: () => unknown
  pruneExitedTerminals: () => unknown
}

export type RuntimeCleanupTask = () => Promise<unknown>

export function buildRuntimeCleanupTasks(
  reason: RuntimeCleanupReason,
  deps: RuntimeCleanupDeps
): RuntimeCleanupTask[] {
  if (reason === 'window-all-closed') {
    return [
      () => Promise.resolve(deps.pruneExitedTerminals()),
      () => Promise.resolve(deps.stopAllLspServers()),
    ]
  }

  return [
    () => Promise.resolve(deps.cleanupAllHandlers()),
    () => Promise.resolve(deps.stopAllLspServers()),
    () => Promise.resolve(deps.destroyAllIndexServices()),
    () => Promise.resolve(deps.cleanupAllIsolatedWorkspaces()),
    () => Promise.resolve(deps.cleanupAllDebugSessions()),
  ]
}
