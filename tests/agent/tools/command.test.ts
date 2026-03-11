import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getInteractiveTerminalBackend,
  isLongRunningCommand,
} from '@renderer/agent/tools/commandRuntime'

describe('commandRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('routes macOS interactive agent sessions away from PTY', () => {
    expect(getInteractiveTerminalBackend('darwin')).toBe('pipe')
  })

  it('keeps PTY backend on non-macOS platforms', () => {
    expect(getInteractiveTerminalBackend('linux')).toBe('pty')
    expect(getInteractiveTerminalBackend('win32')).toBe('pty')
  })

  it('falls back to browser platform detection when process is unavailable', () => {
    vi.stubGlobal('process', undefined)
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })

    expect(getInteractiveTerminalBackend()).toBe('pipe')
  })

  it('detects long-running commands and explicit background requests', () => {
    expect(isLongRunningCommand('npm run dev', false)).toBe(true)
    expect(isLongRunningCommand('vite', false)).toBe(true)
    expect(isLongRunningCommand('npm test', true)).toBe(true)
    expect(isLongRunningCommand('npm test', false)).toBe(false)
  })
})
