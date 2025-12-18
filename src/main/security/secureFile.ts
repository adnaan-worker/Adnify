import { ipcMain, dialog, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { promises as fsPromises } from 'fs'
import Store from 'electron-store'
import { securityManager, OperationType } from './securityModule'

const mainStore = new Store({ name: 'main' })
let watcherSubscription: any = null

interface FileWatcherEvent {
  event: 'create' | 'update' | 'delete'
  path: string
}

// 获取工作区路径
const getWorkspace = (): string | null => {
  return mainStore.get('lastWorkspacePath', null) as string | null
}

// 获取主窗口
const getMainWindow = () => {
  const win = (global as any).mainWindow
  return win || null
}

// 读取带编码检测的文件
async function readFileWithEncoding(filePath: string): Promise<string | null> {
  try {
    const buffer = await fsPromises.readFile(filePath)
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      return buffer.toString('utf-8').substring(3)
    }
    if (buffer.includes(0)) {
      return '[binary file]'
    }
    return buffer.toString('utf-8')
  } catch {
    return null
  }
}

// 读取大文件片段
async function readLargeFile(filePath: string, start: number, maxLength: number): Promise<string | null> {
  try {
    const fd = await fsPromises.open(filePath, 'r')
    const buffer = Buffer.alloc(maxLength)
    const { bytesRead } = await fd.read(buffer, 0, maxLength, start)
    await fd.close()
    return buffer.toString('utf-8', 0, bytesRead)
  } catch {
    return null
  }
}

// 计算目录大小
async function calculateDirectorySize(dirPath: string): Promise<number> {
  let total = 0
  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        total += await calculateDirectorySize(fullPath)
      } else {
        const stat = await fsPromises.stat(fullPath)
        total += stat.size
      }
    }
  } catch {
    // 忽略错误
  }
  return total
}

// 文件监听
function setupFileWatcher(callback: (data: FileWatcherEvent) => void) {
  const workspace = getWorkspace()
  if (!workspace) return

  const chokidar = require('chokidar')
  const watcher = chokidar.watch(workspace, {
    ignored: [/node_modules/, /\.git/, /dist/, /build/, /\.adnify/, '**/*.tmp', '**/*.temp'],
    persistent: true,
    ignoreInitial: true,
  })

  watcherSubscription = watcher
    .on('add', (path: string) => callback({ event: 'create', path }))
    .on('change', (path: string) => callback({ event: 'update', path }))
    .on('unlink', (path: string) => callback({ event: 'delete', path }))
    .on('error', (error: Error) => console.error('[Watcher] Error:', error))

  ;(global as any).fileWatcher = watcher
}

// 注册所有 IPC Handlers
export function registerSecureFileHandlers(
  getMainWindowFn: () => any,
  store: any,
  getWorkspaceFn: () => string | null
) {
  ;(global as any).mainWindow = getMainWindowFn()
  if (store) {
    const storeNew = new Store({ name: 'main' })
    storeNew.set('lastWorkspacePath', store.get('lastWorkspacePath'))
  }

  // ========== 文件操作处理器 ==========

  // 打开文件
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
        dialog.showErrorBox('安全警告', '不允许访问系统敏感路径')
        return null
      }

      const content = await fsPromises.readFile(filePath, 'utf-8')
      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        userAction: true,
        size: content.length
      })
      return { path: filePath, content }
    }
    return null
  })

  // 打开文件夹
  ipcMain.handle('file:openFolder', async () => {
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

  // 读取目录
  ipcMain.handle('file:readDir', async (_, dirPath: string) => {
    if (!dirPath) return []
    if (securityManager.isSensitivePath(dirPath)) return []

    try {
      const items = await fsPromises.readdir(dirPath, { withFileTypes: true })
      return items.map(item => ({
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

  // 读取文件 - 无弹窗
  ipcMain.handle('file:read', async (_, filePath: string) => {
    if (!filePath) return null
    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return null
    }

    try {
      const stats = await fsPromises.stat(filePath)
      const content = stats.size > 5 * 1024 * 1024
        ? await readLargeFile(filePath, 0, 10000)
        : await readFileWithEncoding(filePath)

      securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
        size: stats.size,
        bypass: true
      })
      return content
    } catch (e: any) {
      console.error('[File] read failed:', filePath, e.message)
      return null
    }
  })

  // 写入文件 - 无弹窗
  ipcMain.handle('file:write', async (_, filePath: string, content: string) => {
    if (!filePath || typeof filePath !== 'string') return false
    if (content === undefined || content === null) return false

    // 底线：敏感路径
    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_WRITE, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return false
    }

    // 底线：禁止类型
    const forbiddenPatterns = [
      /\.exe$/i, /\.dll$/i, /\.sys$/i,
      /\.tmp$/i, /\.temp$/i,
    ]
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
        bypass: true
      })
      return true
    } catch (e: any) {
      console.error('[File] write failed:', filePath, e.message)
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

  // 保存文件 - 无弹窗（已有路径）
  ipcMain.handle('file:save', async (_, content: string, currentPath?: string) => {
    if (currentPath) {
      if (securityManager.isSensitivePath(currentPath)) return null
      try {
        const dir = path.dirname(currentPath)
        await fsPromises.mkdir(dir, { recursive: true })
        await fsPromises.writeFile(currentPath, content, 'utf-8')
        securityManager.logOperation(OperationType.FILE_WRITE, currentPath, true, {
          bypass: true
        })
        return currentPath
      } catch {
        return null
      }
    }

    // 新建文件：需要选择路径（用户操作，允许弹窗）
    const mainWindow = getMainWindowFn()
    if (!mainWindow) return null

    const workspace = getWorkspace()
    const defaultPath = workspace || require('os').homedir()

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: [{ name: 'All Files', extensions: ['*'] }],
    })

    if (!result.canceled && result.filePath) {
      const savePath = result.filePath
      if (securityManager.isSensitivePath(savePath)) {
        dialog.showErrorBox('安全警告', '不允许保存到系统敏感路径')
        return null
      }

      try {
        await fsPromises.writeFile(savePath, content, 'utf-8')
        securityManager.logOperation(OperationType.FILE_WRITE, savePath, true, {
          isNewFile: true,
          bypass: true
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

  // 创建目录 - 无弹窗
  ipcMain.handle('file:mkdir', async (_, dirPath: string) => {
    if (!dirPath || typeof dirPath !== 'string') return false
    if (securityManager.isSensitivePath(dirPath)) return false

    try {
      await fsPromises.mkdir(dirPath, { recursive: true })
      securityManager.logOperation(OperationType.FILE_WRITE, dirPath, true, {
        isDirectory: true,
        bypass: true
      })
      return true
    } catch (e: any) {
      console.error('[File] mkdir failed:', dirPath, e.message)
      return false
    }
  })

  // 删除文件/目录 - 无弹窗，仅底线检查
  ipcMain.handle('file:delete', async (_, filePath: string) => {
    // 底线：敏感路径
    if (securityManager.isSensitivePath(filePath)) {
      securityManager.logOperation(OperationType.FILE_DELETE, filePath, false, {
        reason: '安全底线：敏感路径',
      })
      return false
    }

    // 底线：关键配置文件
    const criticalFiles = [
      /\.env$/i,
      /package-lock\.json$/i,
      /yarn\.lock$/i,
      /pnpm-lock\.yaml$/i,
    ]
    for (const pattern of criticalFiles) {
      if (pattern.test(filePath)) {
        securityManager.logOperation(OperationType.FILE_DELETE, filePath, false, {
          reason: '安全底线：关键配置文件',
        })
        return false
      }
    }

    // 底线：大目录保护
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

    // 执行删除（信任 Agent 层）
    try {
      const stat = await fsPromises.stat(filePath)
      if (stat.isDirectory()) {
        await fsPromises.rm(filePath, { recursive: true, force: true })
      } else {
        await fsPromises.unlink(filePath)
      }
      securityManager.logOperation(OperationType.FILE_DELETE, filePath, true, {
        size: stat.size,
        bypass: true
      })
      return true
    } catch (e: any) {
      console.error('[File] delete failed:', filePath, e.message)
      return false
    }
  })

  // 重命名文件 - 无弹窗
  ipcMain.handle('file:rename', async (_, oldPath: string, newPath: string) => {
    if (!oldPath || !newPath) return false

    // 敏感路径检查
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
        bypass: true
      })
      return true
    } catch (e: any) {
      console.error('[File] rename failed:', oldPath, e.message)
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

  // 文件监听
  ipcMain.handle('file:watch', (_, action: string) => {
    if (action === 'start') {
      setupFileWatcher((data) => {
        const win = getMainWindowFn()
        if (win) {
          win.webContents.send('file:changed', data)
        }
      })
    } else if (action === 'stop') {
      cleanupSecureFileWatcher()
    }
  })

  // 审计功能
  ipcMain.handle('security:getAuditLogs', (_, limit = 100) => {
    return securityManager.getAuditLogs(limit)
  })

  ipcMain.handle('security:getPermissions', () => {
    const store = new Store({ name: 'security' })
    return store.get('permissions', {})
  })

  ipcMain.handle('security:resetPermissions', () => {
    const store = new Store({ name: 'security' })
    store.delete('permissions')
    store.delete('audit')
    return true
  })
}

export function cleanupSecureFileWatcher() {
  if (watcherSubscription) {
    console.log('[Watcher] 清理文件监听器...')
    const subscription = watcherSubscription
    watcherSubscription = null
    subscription.unsubscribe().catch((e: any) => {
      console.log('[Watcher] 清理完成 (已忽略错误):', e.message)
    })
  }
}

export { securityManager }
