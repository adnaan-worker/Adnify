/**
 * 设置 IPC handlers
 */

import { ipcMain } from 'electron'
import * as fs from 'fs'
import Store from 'electron-store'

export function registerSettingsHandlers(
  mainStore: Store,
  bootstrapStore: Store,
  setMainStore: (store: Store) => void
) {
  // 获取设置
  ipcMain.handle('settings:get', (_, key: string) => mainStore.get(key))

  // 设置值
  ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    mainStore.set(key, value)

    // 如果是安全设置，同步更新到 SecurityManager
    if (key === 'securitySettings') {
      const { securityManager } = require('../security')
      securityManager.updateConfig(value)
    }

    return true
  })

  // 获取数据路径
  ipcMain.handle('settings:getDataPath', () => mainStore.path)

  // 设置数据路径
  ipcMain.handle('settings:setDataPath', async (_, newPath: string) => {
    try {
      if (!fs.existsSync(newPath)) {
        throw new Error('Directory does not exist')
      }

      const currentData = mainStore.store
      const newStore = new Store({ cwd: newPath })
      newStore.store = currentData
      bootstrapStore.set('customConfigPath', newPath)
      setMainStore(newStore)
      return true
    } catch {
      return false
    }
  })

  // 恢复工作区
  ipcMain.handle('workspace:restore', () => {
    return mainStore.get('lastWorkspacePath')
  })
}
