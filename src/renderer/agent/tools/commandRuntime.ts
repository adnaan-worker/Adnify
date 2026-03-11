import { resolveInteractiveTerminalBackend, type InteractiveTerminalBackend } from '@shared/utils/terminalBackend'

export const LONG_RUNNING_COMMAND_PATTERN = /^(npm|yarn|pnpm|bun)\s+(run\s+)?(dev|start|serve|watch)|python\s+-m\s+(http\.server|flask)|uvicorn|nodemon|webpack|vite/

function resolveRuntimePlatform(): NodeJS.Platform {
  if (typeof process !== 'undefined' && process?.platform) {
    return process.platform
  }

  if (typeof navigator !== 'undefined') {
    const browserPlatform = `${navigator.platform || navigator.userAgent || ''}`.toLowerCase()

    if (browserPlatform.includes('mac')) {
      return 'darwin'
    }

    if (browserPlatform.includes('win')) {
      return 'win32'
    }

    if (browserPlatform.includes('linux') || browserPlatform.includes('x11')) {
      return 'linux'
    }
  }

  return 'linux'
}

export function isLongRunningCommand(command: string, isBackground = false): boolean {
  return Boolean(isBackground) || LONG_RUNNING_COMMAND_PATTERN.test(command.trim())
}

export function getInteractiveTerminalBackend(
  platform: NodeJS.Platform = resolveRuntimePlatform(),
): InteractiveTerminalBackend {
  return resolveInteractiveTerminalBackend(platform)
}
