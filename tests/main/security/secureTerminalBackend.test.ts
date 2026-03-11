import { describe, expect, it } from 'vitest'

import { __testing } from '@main/security/secureTerminal'

describe('secure terminal backend safety', () => {
  it('downgrades PTY requests to pipe on macOS before spawn', () => {
    expect(__testing.resolveInteractiveBackend('darwin', 'pty')).toBe('pipe')
  })

  it('preserves explicit pipe requests on other platforms', () => {
    expect(__testing.resolveInteractiveBackend('linux', 'pipe')).toBe('pipe')
    expect(__testing.resolveInteractiveBackend('win32', 'pipe')).toBe('pipe')
  })
})
