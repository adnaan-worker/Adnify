export type InteractiveTerminalBackend = 'pty' | 'pipe'

export function resolveInteractiveTerminalBackend(
  platform: NodeJS.Platform = process.platform,
  requestedBackend?: InteractiveTerminalBackend,
): InteractiveTerminalBackend {
  if (platform === 'darwin') {
    return 'pipe'
  }

  return requestedBackend ?? 'pty'
}
