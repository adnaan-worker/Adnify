/**
 * 设置 IPC handlers
 */

import { logger } from '@shared/utils/Logger'
import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import Store from 'electron-store'
import { getUserConfigDir, setUserConfigDir } from '../services/configPath'
import { cleanConfigValue } from '@shared/config/configCleaner'
import { SECURITY_DEFAULTS } from '@shared/constants'

// 安全模块接口
interface SecurityModuleRef {
  securityManager: any
  updateWhitelist: (shell: string[], git: string[]) => void
  getWhitelist: () => { shell: string[]; git: string[] }
}

let securityRef: SecurityModuleRef | null = null

export function registerSettingsHandlers(
  resolveStore: (key: string) => Store,
  preferencesStore: Store,
  _bootstrapStore: Store,
  securityModule?: SecurityModuleRef
) {
  // 保存安全模块引用
  if (securityModule) {
    securityRef = securityModule
  }

  // 获取设置
  ipcMain.handle('settings:get', (_, key: string) => {
    try {
      const store = resolveStore(key)
      if (!store) {
        logger.ipc.error('[Settings] resolveStore returned null for key:', key)
        return undefined
      }
      return store.get(key)
    } catch (e) {
      logger.ipc.error('[Settings] settings:get failed', { key, error: e })
      throw e
    }
  })

  // 设置值（自动清理无效字段）
  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    try {
      const store = resolveStore(key)
      if (!store) {
        logger.ipc.error('[Settings] resolveStore returned null for key:', key)
        throw new Error(`Config store not ready for key: ${key}`)
      }
      // 清理配置值，移除不存在的字段
      const cleanedValue = cleanConfigValue(key, value)

      // electron-store 不允许设置 undefined，需要使用 delete
      if (cleanedValue === undefined) {
        store.delete(key as any)
      } else {
        store.set(key, cleanedValue)
      }

      // 广播给所有窗口
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('settings:changed', { key, value })
        }
      })

      // 如果是安全设置，同步更新到 SecurityManager 和白名单
      if (key === 'securitySettings' && securityRef) {
        const securitySettings = (cleanedValue ?? value) as any
        const defaults = {
          enablePermissionConfirm: true,
          enableAuditLog: true,
          strictWorkspaceMode: true,
          allowedShellCommands: SECURITY_DEFAULTS.SHELL_COMMANDS,
          allowedGitSubcommands: SECURITY_DEFAULTS.GIT_SUBCOMMANDS,
        }
        securityRef.securityManager.updateConfig(securitySettings ?? defaults)

        // 更新白名单（删除/undefined 时用默认值）
        const shellCommands = securitySettings?.allowedShellCommands?.length
          ? securitySettings.allowedShellCommands
          : SECURITY_DEFAULTS.SHELL_COMMANDS
        const gitCommands = securitySettings?.allowedGitSubcommands?.length
          ? securitySettings.allowedGitSubcommands
          : SECURITY_DEFAULTS.GIT_SUBCOMMANDS
        securityRef.updateWhitelist(shellCommands, gitCommands)
      }

      return true
    } catch (e) {
      logger.ipc.error('[Settings] settings:set failed', { key, error: e })
      throw e
    }
  })

  // 获取当前白名单
  ipcMain.handle('settings:getWhitelist', () => {
    if (!securityRef) {
      return { shell: [], git: [] }
    }
    return securityRef.getWhitelist()
  })

  // 重置白名单到默认值
  ipcMain.handle('settings:resetWhitelist', () => {
    const defaultShellCommands = [...SECURITY_DEFAULTS.SHELL_COMMANDS]
    const defaultGitCommands = [...SECURITY_DEFAULTS.GIT_SUBCOMMANDS]

    if (securityRef) {
      securityRef.updateWhitelist(defaultShellCommands, defaultGitCommands)
    }

    // 保存到配置（安全设置在 preferencesStore 中）
    const currentSecuritySettings = preferencesStore.get('securitySettings', {}) as any
    const newSecuritySettings = {
      ...currentSecuritySettings,
      allowedShellCommands: defaultShellCommands,
      allowedGitSubcommands: defaultGitCommands
    }
    preferencesStore.set('securitySettings', newSecuritySettings)

    return { shell: defaultShellCommands, git: defaultGitCommands }
  })

  // 获取配置路径
  ipcMain.handle('settings:getConfigPath', () => {
    return getUserConfigDir()
  })

  // 设置配置路径（不再支持迁移整个 store，只设置路径）
  ipcMain.handle('settings:setConfigPath', async (_, newPath: string) => {
    try {
      if (!fs.existsSync(newPath)) {
        fs.mkdirSync(newPath, { recursive: true })
      }
      setUserConfigDir(newPath)
      return true
    } catch (err) {
      logger.ipc.error('[Settings] Failed to set config path:', err)
      return false
    }
  })

  // 恢复工作区 (Legacy fallback)
  ipcMain.handle('workspace:restore:legacy', () => {
    return resolveStore('lastWorkspacePath').get('lastWorkspacePath')
  })

  // 获取用户数据路径
  ipcMain.handle('settings:getUserDataPath', () => {
    return getUserConfigDir()
  })

  // 获取最近的日志
  ipcMain.handle('settings:getRecentLogs', async () => {
    try {
      const path = require('path')
      const logPath = path.join(getUserConfigDir(), 'logs', 'main.log')

      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf-8')
        // 返回最后 10000 行或 1MB 的内容
        const lines = content.split('\n')
        const recentLines = lines.slice(-10000)
        return recentLines.join('\n')
      }
      return ''
    } catch (err) {
      logger.ipc.error('[Settings] Failed to read logs:', err)
      return ''
    }
  })
}
