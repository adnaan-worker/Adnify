import { describe, expect, it } from 'vitest'

import {
  resolveBeforeQuitAction,
  resolveWindowAllClosedAction,
} from '@main/lifecycle/quitLifecycle'

describe('quit lifecycle', () => {
  it('keeps macOS app alive after closing the last window when quit is not in progress', () => {
    expect(resolveWindowAllClosedAction('darwin', {
      cleanupDone: false,
      cleanupRunning: false,
    })).toBe('cleanup-only')
  })

  it('continues quitting on macOS once quit cleanup has completed', () => {
    expect(resolveWindowAllClosedAction('darwin', {
      cleanupDone: true,
      cleanupRunning: false,
    })).toBe('quit')
  })

  it('continues quitting on macOS while quit cleanup is already in progress', () => {
    expect(resolveWindowAllClosedAction('darwin', {
      cleanupDone: false,
      cleanupRunning: true,
    })).toBe('quit')
  })

  it('runs cleanup on the first before-quit event', () => {
    expect(resolveBeforeQuitAction({
      cleanupDone: false,
      cleanupRunning: false,
    })).toBe('run-cleanup')
  })

  it('waits for the existing quit cleanup instead of starting it twice', () => {
    expect(resolveBeforeQuitAction({
      cleanupDone: false,
      cleanupRunning: true,
    })).toBe('wait')
  })

  it('allows quit to proceed after cleanup is done', () => {
    expect(resolveBeforeQuitAction({
      cleanupDone: true,
      cleanupRunning: false,
    })).toBe('allow')
  })
})
