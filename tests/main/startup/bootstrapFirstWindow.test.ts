import { describe, expect, it, vi } from 'vitest'

import { bootstrapFirstWindow } from '@main/startup/bootstrapFirstWindow'

describe('bootstrapFirstWindow', () => {
  it('prepares critical IPC before creating the first window', async () => {
    const order: string[] = []
    const firstWindow = { id: 1 }

    await bootstrapFirstWindow({
      initStores: async () => {
        order.push('init-stores')
      },
      registerWindowHandlers: async () => {
        order.push('register-window-handlers')
      },
      registerUpdaterHandlers: async () => {
        order.push('register-updater-handlers')
      },
      registerCriticalIpcHandlers: async () => {
        order.push('register-critical-ipc')
      },
      createWindow: () => {
        order.push('create-window')
        return firstWindow
      },
      initializeWindowServices: async (window) => {
        order.push(`initialize-window-services:${window.id}`)
      },
    })

    expect(order).toEqual([
      'init-stores',
      'register-window-handlers',
      'register-updater-handlers',
      'register-critical-ipc',
      'create-window',
      'initialize-window-services:1',
    ])
  })

  it('does not create a window when critical IPC registration fails', async () => {
    const createWindow = vi.fn()

    await expect(
      bootstrapFirstWindow({
        initStores: async () => undefined,
        registerWindowHandlers: async () => undefined,
        registerUpdaterHandlers: async () => undefined,
        registerCriticalIpcHandlers: async () => {
          throw new Error('ipc not ready')
        },
        createWindow,
        initializeWindowServices: async () => undefined,
      }),
    ).rejects.toThrow('ipc not ready')

    expect(createWindow).not.toHaveBeenCalled()
  })
})
