import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  __testing,
  cleanupTerminals,
  pruneExitedTerminals,
} from '@main/security/secureTerminal'

function createMockTerminal(initiallyAlive = true) {
  let alive = initiallyAlive
  let exitHandler: ((event: { exitCode: number; signal?: number }) => void) | null = null

  const terminal = {
    onData: vi.fn(() => terminal),
    on: vi.fn(() => terminal),
    onExit: vi.fn((handler: (event: { exitCode: number; signal?: number }) => void) => {
      exitHandler = handler
      return terminal
    }),
    kill: vi.fn(() => {
      alive = false
    }),
    removeAllListeners: vi.fn(),
    isAlive: vi.fn(() => alive),
    emitExit: (event = { exitCode: 0 }) => {
      alive = false
      exitHandler?.(event)
    },
  }

  return terminal
}

describe('secure terminal cleanup', () => {
  afterEach(() => {
    cleanupTerminals()
    __testing.clearTrackedTerminals()
  })

  it('removes a terminal from the registry when it exits', () => {
    const terminal = createMockTerminal(true)

    __testing.bindTrackedTerminal('term-1', terminal, null)
    expect(__testing.getTrackedTerminalCount()).toBe(1)

    terminal.emitExit({ exitCode: 0 })
    expect(__testing.getTrackedTerminalCount()).toBe(0)
  })

  it('prunes dead terminal records without killing active terminals', () => {
    const active = createMockTerminal(true)
    const dead = createMockTerminal(false)

    __testing.bindTrackedTerminal('active', active, null)
    __testing.bindTrackedTerminal('dead', dead, null)

    const removed = pruneExitedTerminals()
    expect(removed).toBe(1)
    expect(__testing.getTrackedTerminalCount()).toBe(1)
    expect(active.kill).not.toHaveBeenCalled()
  })

  it('cleanupTerminals kills all tracked terminals', () => {
    const first = createMockTerminal(true)
    const second = createMockTerminal(true)

    __testing.bindTrackedTerminal('term-1', first, null)
    __testing.bindTrackedTerminal('term-2', second, null)

    cleanupTerminals()

    expect(first.kill).toHaveBeenCalledTimes(1)
    expect(second.kill).toHaveBeenCalledTimes(1)
    expect(__testing.getTrackedTerminalCount()).toBe(0)
  })
})
