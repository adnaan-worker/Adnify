/**
 * 安全文件操作模块
 * 整合文件操作、工作区管理和文件监听功能
 */

import { logger } from '@shared/utils/Logger'
import { toAppError, ErrorCode } from '@shared/utils/errorHandler'
import { ipcMain, dialog, shell } from 'electron'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { promises as fsPromises } from 'fs'
import Store from 'electron-store'
import { securityManager, OperationType } from './securityModule'

// 导入拆分的模块
import { readFileWithEncoding, readLargeFile } from './fileUtils'
import {
  setupFileWatcher,
  cleanupFileWatcher,
  FileWatcherEvent,
} from './fileWatcher'
import {
  registerWorkspaceHandlers,
  WindowManagerContext,
} from './workspaceHandlers'

/**
 * 向渲染进程发送错误通知
 */
function showSecurityError(mainWindow: any, title: string, message: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:error', { title, message, variant: 'danger' })
  } else {
    // 如果窗口不可用，回退到原生对话框
    dialog.showErrorBox(title, message)
  }
}

/**
 * 注册所有安全文件 IPC Handlers
 * 整合文件操作和工作区管理
 */
export function registerSecureFileHandlers(
  getMainWindowFn: () => any,
  store: any,
  getWorkspaceSessionFn: (event?: Electron.IpcMainInvokeEvent) => { roots: string[] } | null,
  windowManager?: WindowManagerContext
) {
  ;(global as any).mainWindow = getMainWindowFn()

  // 注册工作区相关处理器（从 workspaceHandlers.ts 导入）
  registerWorkspaceHandlers(getMainWindowFn, store, getWorkspaceSessionFn, windowManager)

  // ========== 文件操作处理器 ==========

  // 打开文件（带对话框）
  ipcMain.handle('file:open', async () => {
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    })

    if (!result.canceled && result.filePaths[0]) {
      const filePath = result.filePaths[0]
      if (securityManager.isSensitivePath(filePath)) {
        showSecurityError(mainWindow, '安全警告', '不允许访问系统敏感路径')
        return null
      }

      const content = await fsPromises.readFile(filePath, 'utf-8')
      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        userAction: true,
        size: content.length,
      })
      return { path: filePath, content }
    }
    return null
  })

  // 读取目录
  ipcMain.handle('file:readDir', async (_, dirPath: string) => {
    if (!dirPath) return []
    if (securityManager.isSensitivePath(dirPath)) return []

    try {
      const items = await fsPromises.readdir(dirPath, { withFileTypes: true })
      return items.map((item) => ({
        name: item.name,
        path: path.join(dirPath, item.name),
        isDirectory: item.isDirectory(),
      }))
    } catch {
      return []
    }
  })

  // 获取目录树
  ipcMain.handle('file:getTree', async (_, dirPath: string, maxDepth = 2) => {
    if (!dirPath || maxDepth < 0) return ''
    if (securityManager.isSensitivePath(dirPath)) return ''

    const buildTree = async (currentPath: string, currentDepth: number): Promise<string> => {
      if (currentDepth >= maxDepth) return ''
      try {
        const items = await fsPromises.readdir(currentPath, { withFileTypes: true })
        let result = ''
        for (const item of items) {
          const fullPath = path.join(currentPath, item.name)
          const indent = '  '.repeat(currentDepth)
          if (item.isDirectory()) {
            result += `${indent}📁 ${item.name}/\n`
            result += await buildTree(fullPath, currentDepth + 1)
          } else {
            result += `${indent}📄 ${item.name}\n`
          }
        }
        return result
      } catch {
        return ''
      }
    }
    return await buildTree(dirPath, 0)
  })

  // 读取文件（无弹窗，使用拆分的 fileUtils）
  ipcMain.handle('file:read', async (event, filePath: string) => {
    if (!filePath) return null
    const workspace = getWorkspaceSessionFn(event)

    // 强制工作区边界
    if (workspace && !securityManager.validateWorkspacePath(filePath, workspace.roots)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：超出工作区边界',
      })
      return null
    }

    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return null
    }

    try {
      const stats = await fsPromises.stat(filePath)
      // 使用拆分的 fileUtils 函数
      const content =
        stats.size > 5 * 1024 * 1024
          ? await readLargeFile(filePath, 0, 10000)
          : await readFileWithEncoding(filePath)

      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        size: stats.size,
        bypass: true,
      })
      return content
    } catch (err) {
      // 文件不存在是正常情况（如可选的规则文件），不记录为 ERROR
      if (toAppError(err).code === ErrorCode.FILE_NOT_FOUND || (err as any)?.code === 'ENOENT') {
        logger.security.debug('[File] not found:', filePath)
      } else {
        logger.security.error('[File] read failed:', filePath, toAppError(err).message)
      }
      return null
    }
  })

  // 读取二进制文件为 base64
  ipcMain.handle('file:readBinary', async (event, filePath: string) => {
    if (!filePath) return null
    const workspace = getWorkspaceSessionFn(event)

    if (workspace && !securityManager.validateWorkspacePath(filePath, workspace.roots)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：超出工作区边界',
      })
      return null
    }

    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return null
    }

    try {
      const stats = await fsPromises.stat(filePath)
      if (stats.size > 50 * 1024 * 1024) {
        return null
      }

      const buffer = await fsPromises.readFile(filePath)
      const base64 = buffer.toString('base64')

      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        size: stats.size,
        binary: true,
      })
      return base64
    } catch (err) {
      logger.security.error('[File] read binary failed:', filePath, toAppError(err).message)
      return null
    }
  })

  // 写入文件（无弹窗）
  ipcMain.handle('file:write', async (event, filePath: string, content: string) => {
    if (!filePath || typeof filePath !== 'string') return false
    if (content === undefined || content === null) return false

    const workspace = getWorkspaceSessionFn(event)

    if (workspace && !securityManager.validateWorkspacePath(filePath, workspace.roots)) {
      securityManager.logOperation(OperationType.FILE_WRITE, filePath, false, {
        reason: '安全底线：超出工作区边界',
      })
      return false
    }

    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_WRITE, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return false
    }

    // 禁止类型检查
    const forbiddenPatterns = [/\.exe$/i, /\.dll$/i, /\.sys$/i, /\.tmp$/i, /\.temp$/i]
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(filePath)) {
        securityManager.logOperation(OperationType.FILE_WRITE, filePath, false, {
          reason: '安全底线：禁止类型',
        })
        return false
      }
    }

    try {
      const dir = path.dirname(filePath)
      await fsPromises.mkdir(dir, { recursive: true })
      await fsPromises.writeFile(filePath, content, 'utf-8')
      securityManager.logOperation(OperationType.FILE_WRITE, filePath, true, {
        size: content.length,
        bypass: true,
      })
      return true
    } catch (err) {
      logger.security.error('[File] write failed:', filePath, toAppError(err).message)
      return false
    }
  })

  // 确保目录存在
  ipcMain.handle('file:ensureDir', async (_, dirPath: string) => {
    if (!dirPath) return false
    if (securityManager.isSensitivePath(dirPath)) return false
    try {
      await fsPromises.mkdir(dirPath, { recursive: true })
      return true
    } catch {
      return false
    }
  })

  // 保存文件（带对话框支持）
  ipcMain.handle('file:save', async (event, content: string, currentPath?: string) => {
    if (currentPath) {
      if (securityManager.isSensitivePath(currentPath)) return null
      try {
        const dir = path.dirname(currentPath)
        await fsPromises.mkdir(dir, { recursive: true })
        await fsPromises.writeFile(currentPath, content, 'utf-8')
        securityManager.logOperation(OperationType.FILE_WRITE, currentPath, true, {
          bypass: true,
        })
        return currentPath
      } catch {
        return null
      }
    }

    // 新建文件：需要选择路径
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const workspace = getWorkspaceSessionFn(event)
    const defaultPath =
      workspace && workspace.roots.length > 0 ? workspace.roots[0] : require('os').homedir()

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: [{ name: 'All Files', extensions: ['*'] }],
    })

    if (!result.canceled && result.filePath) {
      const savePath = result.filePath
      if (securityManager.isSensitivePath(savePath)) {
        showSecurityError(mainWindow, '安全警告', '不允许保存到系统敏感路径')
        return null
      }

      try {
        await fsPromises.writeFile(savePath, content, 'utf-8')
        securityManager.logOperation(OperationType.FILE_WRITE, savePath, true, {
          isNewFile: true,
          bypass: true,
        })
        return savePath
      } catch {
        return null
      }
    }
    return null
  })

  // 文件是否存在
  ipcMain.handle('file:exists', async (_, filePath: string) => {
    try {
      await fsPromises.access(filePath)
      return true
    } catch {
      return false
    }
  })

  // 创建目录（无弹窗）
  ipcMain.handle('file:mkdir', async (_, dirPath: string) => {
    if (!dirPath || typeof dirPath !== 'string') return false
    if (securityManager.isSensitivePath(dirPath)) return false

    try {
      await fsPromises.mkdir(dirPath, { recursive: true })
      securityManager.logOperation(OperationType.FILE_WRITE, dirPath, true, {
        isDirectory: true,
        bypass: true,
      })
      return true
    } catch (err) {
      logger.security.error('[File] mkdir failed:', dirPath, toAppError(err).message)
      return false
    }
  })

  // 删除文件/目录（无弹窗，仅底线检查）
  ipcMain.handle('file:delete', async (_, filePath: string) => {
    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_DELETE, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return false
    }

    // 关键配置文件保护
    const criticalFiles = [/\.env$/i, /package-lock\.json$/i, /yarn\.lock$/i, /pnpm-lock\.yaml$/i]
    for (const pattern of criticalFiles) {
      if (pattern.test(filePath)) {
        securityManager.logOperation(OperationType.FILE_DELETE, filePath, false, {
          reason: '安全底线：关键配置文件',
        })
        return false
      }
    }

    // 大目录保护
    try {
      const stat = await fsPromises.stat(filePath)
      if (stat.isDirectory() && stat.size > 100 * 1024 * 1024) {
        securityManager.logOperation(OperationType.FILE_DELETE, filePath, false, {
          reason: `安全底线：目录过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)`,
        })
        return false
      }
    } catch {
      return false
    }

    try {
      const stat = await fsPromises.stat(filePath)
      if (stat.isDirectory()) {
        await fsPromises.rm(filePath, { recursive: true, force: true })
      } else {
        await fsPromises.unlink(filePath)
      }
      securityManager.logOperation(OperationType.FILE_DELETE, filePath, true, {
        size: stat.size,
        bypass: true,
      })
      return true
    } catch (err) {
      logger.security.error('[File] delete failed:', filePath, toAppError(err).message)
      return false
    }
  })

  // 重命名文件（无弹窗）
  ipcMain.handle('file:rename', async (_, oldPath: string, newPath: string) => {
    if (!oldPath || !newPath) return false

    if (securityManager.isSensitivePath(oldPath) || securityManager.isSensitivePath(newPath)) {
      securityManager.logOperation(OperationType.FILE_RENAME, oldPath, false, {
        reason: '安全底线：敏感路径',
        newPath,
      })
      return false
    }

    try {
      await fsPromises.rename(oldPath, newPath)
      securityManager.logOperation(OperationType.FILE_RENAME, oldPath, true, {
        newPath,
        bypass: true,
      })
      return true
    } catch (err) {
      logger.security.error('[File] rename failed:', oldPath, toAppError(err).message)
      return false
    }
  })

  // 在文件管理器中显示
  ipcMain.handle('file:showInFolder', async (_, filePath: string) => {
    try {
      shell.showItemInFolder(filePath)
      return true
    } catch {
      return false
    }
  })

  // 在浏览器中打开文件
  ipcMain.handle('file:openInBrowser', async (_, filePath: string) => {
    try {
      // 验证文件存在
      await fsPromises.access(filePath)
      // 转换为 file:// URL
      const fileUrl = pathToFileURL(filePath).href
      await shell.openExternal(fileUrl)
      return true
    } catch {
      return false
    }
  })

  // 文件监听（使用拆分的 fileWatcher）
  ipcMain.handle('file:watch', (_, action: string) => {
    if (action === 'start') {
      setupFileWatcher(getWorkspaceSessionFn, (data: FileWatcherEvent) => {
        const win = getMainWindowFn()
        if (win) {
          win.webContents.send('file:changed', data)
        }
      })
    } else if (action === 'stop') {
      cleanupFileWatcher()
    }
  })

  // ========== 安全审计功能 ==========

  ipcMain.handle('security:getAuditLogs', (_, limit = 100) => {
    return securityManager.getAuditLogs(limit)
  })

  ipcMain.handle('security:clearAuditLogs', () => {
    securityManager.clearAuditLogs()
    return true
  })

  ipcMain.handle('security:getPermissions', () => {
    const securityStore = new Store({ name: 'security' })
    return securityStore.get('permissions', {})
  })

  ipcMain.handle('security:resetPermissions', () => {
    const securityStore = new Store({ name: 'security' })
    securityStore.delete('permissions')
    // 审计日志现在存储在工作区 .adnify/audit.log，不再使用 electron-store
    securityManager.clearAuditLogs()
    return true
  })
}

/**
 * 清理安全文件监听器
 * 导出以便外部调用
 */
export function cleanupSecureFileWatcher() {
  cleanupFileWatcher()
}

// 导出安全管理器
export { securityManager }

// 重新导出拆分模块的类型和函数，方便外部使用
export type { FileWatcherEvent, WindowManagerContext }
export { setupFileWatcher, cleanupFileWatcher } from './fileWatcher'
export { readFileWithEncoding, readLargeFile } from './fileUtils'
