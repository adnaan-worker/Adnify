/**
 * 工作区相关的 IPC 处理器
 * 从 secureFile.ts 拆分出来
 */

import { logger } from '@shared/utils/Logger'
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { promises as fsPromises } from 'fs'
import { setupFileWatcher, FileWatcherEvent } from './fileWatcher'
import { securityManager } from './securityModule'

// 窗口管理上下文类型
export interface WindowManagerContext {
  findWindowByWorkspace?: (roots: string[]) => BrowserWindow | null
  setWindowWorkspace?: (windowId: number, roots: string[]) => void
}

/**
 * 注册工作区相关的 IPC 处理器
 */
export function registerWorkspaceHandlers(
  getMainWindowFn: () => BrowserWindow | null,
  store: any,
  getWorkspaceSessionFn: () => { roots: string[] } | null,
  windowManager?: WindowManagerContext
): void {
  // 辅助函数：添加到最近工作区列表
  function addRecentWorkspace(path: string) {
    const recent = store.get('recentWorkspaces', []) as string[]
    const filtered = recent.filter((p: string) => p.toLowerCase() !== path.toLowerCase())
    const updated = [path, ...filtered].slice(0, 10)
    store.set('recentWorkspaces', updated)
    logger.security.info('[Workspace] Updated recent workspaces:', updated.length, 'items')
  }

  // 打开文件夹
  ipcMain.handle('file:openFolder', async (event) => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })

    if (!result.canceled && result.filePaths[0]) {
      const folderPath = result.filePaths[0]

      // 检查是否已有窗口打开了该项目
      if (windowManager?.findWindowByWorkspace) {
        const existingWindow = windowManager.findWindowByWorkspace([folderPath])
        if (existingWindow && existingWindow !== mainWindow) {
          if (existingWindow.isMinimized()) {
            existingWindow.restore()
          }
          existingWindow.focus()
          logger.security.info('[Workspace] Project already open in another window:', folderPath)
          return { redirected: true, path: folderPath }
        }
      }

      // 记录当前窗口的工作区
      const webContentsId = event.sender.id
      if (windowManager?.setWindowWorkspace) {
        windowManager.setWindowWorkspace(webContentsId, [folderPath])
      }

      // 更新安全模块的工作区路径
      securityManager.setWorkspacePath(folderPath)

      store.set('lastWorkspacePath', folderPath)
      store.set('lastWorkspaceSession', { configPath: null, roots: [folderPath] })
      addRecentWorkspace(folderPath)
      return folderPath
    }
    return null
  })

  // 打开工作区 (多根支持)
  ipcMain.handle('workspace:open', async (event) => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'openDirectory'],
      filters: [
        { name: 'Adnify Workspace', extensions: ['adnify-workspace'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (!result.canceled && result.filePaths[0]) {
      const targetPath = result.filePaths[0]
      let roots: string[] = []

      if (targetPath.endsWith('.adnify-workspace')) {
        try {
          const content = await fsPromises.readFile(targetPath, 'utf-8')
          const config = JSON.parse(content)
          roots = config.folders.map((f: any) => f.path)
        } catch (e) {
          logger.security.error('Failed to parse workspace file', e)
          return null
        }
      } else {
        roots = [targetPath]
      }

      // 检查是否已有窗口打开了该项目
      if (windowManager?.findWindowByWorkspace && roots.length > 0) {
        const existingWindow = windowManager.findWindowByWorkspace(roots)
        if (existingWindow && existingWindow !== mainWindow) {
          if (existingWindow.isMinimized()) {
            existingWindow.restore()
          }
          existingWindow.focus()
          logger.security.info('[Workspace] Workspace already open in another window:', roots)
          return { redirected: true, roots }
        }
      }

      const webContentsId = event.sender.id
      if (windowManager?.setWindowWorkspace) {
        windowManager.setWindowWorkspace(webContentsId, roots)
      }

      // 更新安全模块的工作区路径
      securityManager.setWorkspacePath(roots[0] || null)

      const session = { configPath: targetPath.endsWith('.adnify-workspace') ? targetPath : null, roots }
      store.set('lastWorkspaceSession', session)
      store.set('lastWorkspacePath', roots[0])
      roots.forEach(r => addRecentWorkspace(r))
      return session
    }
    return null
  })

  // 添加文件夹到工作区
  ipcMain.handle('workspace:addFolder', async () => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })

    if (!result.canceled && result.filePaths[0]) {
      return result.filePaths[0]
    }
    return null
  })

  // 保存工作区
  ipcMain.handle('workspace:save', async (_, configPath: string, roots: string[]) => {
    if (!configPath || !roots) return false

    let targetPath = configPath
    if (!targetPath) {
      const mainWindow = getMainWindowFn()
      const result = await dialog.showSaveDialog(mainWindow!, {
        filters: [{ name: 'Adnify Workspace', extensions: ['adnify-workspace'] }]
      })
      if (result.canceled || !result.filePath) return false
      targetPath = result.filePath
    }

    const content = JSON.stringify({
      folders: roots.map(path => ({ path }))
    }, null, 2)

    try {
      await fsPromises.writeFile(targetPath, content, 'utf-8')
      return true
    } catch (e) {
      logger.security.error('Failed to save workspace', e)
      return false
    }
  })

  // 恢复工作区
  ipcMain.handle('workspace:restore', async (event) => {
    const session = store.get('lastWorkspaceSession') as { configPath: string | null; roots: string[] } | null

    if (session) {
      const webContentsId = event.sender.id
      if (windowManager?.setWindowWorkspace && session.roots.length > 0) {
        windowManager.setWindowWorkspace(webContentsId, session.roots)
      }

      // 更新安全模块的工作区路径
      securityManager.setWorkspacePath(session.roots[0] || null)
      
      // 自动启动文件监听
      setupFileWatcher(getWorkspaceSessionFn, (data: FileWatcherEvent) => {
        const win = getMainWindowFn()
        if (win) {
          win.webContents.send('file:changed', data)
        }
      })
      return session
    }

    // Fallback to legacy
    const legacyPath = store.get('lastWorkspacePath') as string | null
    if (legacyPath) {
      const webContentsId = event.sender.id
      if (windowManager?.setWindowWorkspace) {
        windowManager.setWindowWorkspace(webContentsId, [legacyPath])
      }

      // 更新安全模块的工作区路径
      securityManager.setWorkspacePath(legacyPath)
      
      setupFileWatcher(getWorkspaceSessionFn, (data: FileWatcherEvent) => {
        const win = getMainWindowFn()
        if (win) {
          win.webContents.send('file:changed', data)
        }
      })
      return { configPath: null, roots: [legacyPath] }
    }

    return null
  })

  // 设置活动工作区
  ipcMain.handle('workspace:setActive', async (event, roots: string[]) => {
    if (!roots || roots.length === 0) return false

    // 检查是否已有窗口打开了该项目
    const mainWindow = getMainWindowFn()
    if (windowManager?.findWindowByWorkspace && roots.length > 0) {
      const existingWindow = windowManager.findWindowByWorkspace(roots)
      if (existingWindow && existingWindow !== mainWindow) {
        if (existingWindow.isMinimized()) {
          existingWindow.restore()
        }
        existingWindow.focus()
        logger.security.info('[Workspace] Workspace already open in another window:', roots)
        return { redirected: true, roots }
      }
    }

    const webContentsId = event.sender.id
    if (windowManager?.setWindowWorkspace) {
      windowManager.setWindowWorkspace(webContentsId, roots)
    }

    // 更新安全模块的工作区路径
    securityManager.setWorkspacePath(roots[0] || null)

    store.set('lastWorkspacePath', roots[0])
    store.set('lastWorkspaceSession', { configPath: null, roots })
    roots.forEach(r => addRecentWorkspace(r))

    logger.security.info('[Workspace] Active workspace set:', roots)
    return true
  })

  // 获取最近打开的工作区列表
  ipcMain.handle('workspace:getRecent', () => {
    return store.get('recentWorkspaces', []) as string[]
  })

  // 清除最近工作区
  ipcMain.handle('workspace:clearRecent', () => {
    store.set('recentWorkspaces', [])
    return true
  })

  // 从最近工作区列表中移除指定路径
  ipcMain.handle('workspace:removeFromRecent', (_, path: string) => {
    if (!path) return false
    const recent = store.get('recentWorkspaces', []) as string[]
    const filtered = recent.filter((p: string) => p.toLowerCase() !== path.toLowerCase())
    store.set('recentWorkspaces', filtered)
    logger.security.info('[Workspace] Removed from recent:', path)
    return true
  })

  // 选择目录（仅返回路径，不改变工作区状态）
  // 用于设置界面选择自定义路径等场景
  ipcMain.handle('dialog:selectFolder', async () => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })

    if (!result.canceled && result.filePaths[0]) {
      return result.filePaths[0]
    }
    return null
  })
}
