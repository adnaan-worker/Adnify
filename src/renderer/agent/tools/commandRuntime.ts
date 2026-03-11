import { resolveInteractiveTerminalBackend, type InteractiveTerminalBackend } from '@shared/utils/terminalBackend'

export const LONG_RUNNING_COMMAND_PATTERN = /^(npm|yarn|pnpm|bun)\s+(run\s+)?(dev|start|serve|watch)|python\s+-m\s+(http\.server|flask)|uvicorn|nodemon|webpack|vite/


export function isLongRunningCommand(command: string, isBackground = false): boolean {
  return Boolean(isBackground) || LONG_RUNNING_COMMAND_PATTERN.test(command.trim())
}

export function getInteractiveTerminalBackend(
  platform: NodeJS.Platform = process.platform,
): InteractiveTerminalBackend {
  return resolveInteractiveTerminalBackend(platform)
}
