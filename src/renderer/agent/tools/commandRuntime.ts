import { resolveInteractiveTerminalBackend, type InteractiveTerminalBackend } from '@shared/utils/terminalBackend'
import { platform as runtimePlatform } from '@shared/utils/pathUtils'

export const LONG_RUNNING_COMMAND_PATTERN = /^(npm|yarn|pnpm|bun)\s+(run\s+)?(dev|start|serve|watch)|python\s+-m\s+(http\.server|flask)|uvicorn|nodemon|webpack|vite/

const currentPlatform: NodeJS.Platform = runtimePlatform.isWindows ? 'win32' : runtimePlatform.isMac ? 'darwin' : 'linux'

export function isLongRunningCommand(command: string, isBackground = false): boolean {
  return Boolean(isBackground) || LONG_RUNNING_COMMAND_PATTERN.test(command.trim())
}

export function getInteractiveTerminalBackend(
  platform: NodeJS.Platform = currentPlatform,
): InteractiveTerminalBackend {
  return resolveInteractiveTerminalBackend(platform)
}
