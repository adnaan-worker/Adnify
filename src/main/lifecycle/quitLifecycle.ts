export interface QuitLifecycleState {
  cleanupDone: boolean
  cleanupRunning: boolean
}

export type BeforeQuitAction = 'run-cleanup' | 'wait' | 'allow'
export type WindowAllClosedAction = 'cleanup-only' | 'quit'

export function resolveBeforeQuitAction(state: QuitLifecycleState): BeforeQuitAction {
  if (state.cleanupDone) {
    return 'allow'
  }

  if (state.cleanupRunning) {
    return 'wait'
  }

  return 'run-cleanup'
}

export function resolveWindowAllClosedAction(
  platform: NodeJS.Platform,
  state: QuitLifecycleState,
): WindowAllClosedAction {
  if (platform === 'darwin' && !state.cleanupDone && !state.cleanupRunning) {
    return 'cleanup-only'
  }

  return 'quit'
}
