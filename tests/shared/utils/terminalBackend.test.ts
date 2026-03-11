import { describe, expect, it } from 'vitest'

import { resolveInteractiveTerminalBackend } from '@shared/utils/terminalBackend'

describe('terminal backend resolver', () => {
  it('forces macOS interactive sessions onto pipe even when PTY is requested', () => {
    expect(resolveInteractiveTerminalBackend('darwin', 'pty')).toBe('pipe')
    expect(resolveInteractiveTerminalBackend('darwin')).toBe('pipe')
  })

  it('preserves explicit pipe requests on non-macOS platforms', () => {
    expect(resolveInteractiveTerminalBackend('linux', 'pipe')).toBe('pipe')
    expect(resolveInteractiveTerminalBackend('win32', 'pipe')).toBe('pipe')
  })

  it('keeps PTY as the default on non-macOS platforms', () => {
    expect(resolveInteractiveTerminalBackend('linux')).toBe('pty')
    expect(resolveInteractiveTerminalBackend('win32')).toBe('pty')
  })
})
