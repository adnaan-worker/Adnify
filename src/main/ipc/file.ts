/**
 * 文件操作 IPC handlers
 */

import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as jschardet from 'jschardet'
import * as iconv from 'iconv-lite'
import * as watcher from '@parcel/watcher'
import Store from 'electron-store'

let watcherSubscription: watcher.AsyncSubscription | null = null

// 智能读取文件（自动检测编码）
async function readFileWithEncoding(filePath: string): Promise<string> {
  try {
    const buffer = await fsPromises.readFile(filePath)
    const detected = jschardet.detect(buffer)
    const encoding = detected.encoding || 'utf-8'
    
    if (encoding.toLowerCase() === 'utf-8' || encoding.toLowerCase() === 'ascii') {
      return buffer.toString('utf-8')
    }
    
    if (iconv.encodingExists(encoding)) {
      return iconv.decode(buffer, encoding)
    }
    
    return buffer.toString('utf-8')
  } catch (e) {
    console.error('[File] Read error:', e)
    return ''
  }
}

// 流式读取大文件
async function readLargeFile(filePath: string, startLine = 0, maxLines = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const lines: string[] = []
    let lineCount = 0
    
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
    let buffer = ''
    
    stream.on('data', (chunk: string | Buffer) => {
      buffer += chunk.toString()
      const parts = buffer.split('\n')
      buffer = parts.pop() || ''
      
      for (const line of parts) {
        if (lineCount >= startLine && lines.length < maxLines) {
          lines.push(line)
        }
        lineCount++
        
        if (lines.length >= maxLines) {
          stream.destroy()
          break
        }
      }
    })
    
    stream.on('end', () => {
      if (buffer && lines.length < maxLines) {
        lines.push(buffer)
      }
      resolve(lines.join('\n'))
    })
    
    stream.on('error', reject)
  })
}

// 启动文件监听
async function startFileWatcher(
  folderPath: string,
  mainWindow: BrowserWindow | null
) {
  if (watcherSubscription) {
    await watcherSubscription.unsubscribe()
  }

  try {
    watcherSubscription = await watcher.subscribe(
      folderPath,
      (err, events) => {
        if (err) {
          console.error('[Watcher] Error:', err)
          return
        }
        
        for (const event of events) {
          mainWindow?.webContents.send('file:changed', {
            event: event.type,
            path: event.path,
          })
        }
      },
      {
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/*.log',
        ],
      }
    )
    
    console.log('[Watcher] Started watching:', folderPath)
  } catch (e) {
    console.error('[Watcher] Failed to start:', e)
  }
}

export function registerFileHandlers(
  getMainWindow: () => BrowserWindow | null,
  mainStore: Store
) {
  // 打开文件对话框
  ipcMain.handle('file:open', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    })
    
    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0]
      const content = await readFileWithEncoding(filePath)
      return { path: filePath, content }
    }
    return null
  })

  // 打开文件夹对话框
  ipcMain.handle('file:openFolder', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })
    
    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0]
      mainStore.set('lastWorkspacePath', folderPath)
      await startFileWatcher(folderPath, mainWindow)
      return folderPath
    }
    return null
  })

  // 通用打开对话框
  ipcMain.handle('dialog:showOpen', async (_, options: {
    properties?: string[]
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[]
  }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: (options.properties || ['openFile']) as any,
      defaultPath: options.defaultPath,
      filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
    })
    
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths
    }
    return null
  })

  // 恢复工作区
  ipcMain.handle('workspace:restore', async () => {
    const lastPath = mainStore.get('lastWorkspacePath') as string | undefined
    if (lastPath && fs.existsSync(lastPath)) {
      await startFileWatcher(lastPath, getMainWindow())
    }
    return lastPath || null
  })

  // 读取目录
  ipcMain.handle('file:readDir', async (_, dirPath: string) => {
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
    if (!dirPath) return ''
    
    try {
      await fsPromises.access(dirPath)
    } catch {
      return ''
    }
    
    const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.vscode', '.idea', 'coverage', 'tmp', '.adnify'])
    const IGNORED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.exe', '.dll', '.bin', '.lock'])

    async function buildTree(currentPath: string, depth: number, prefix = ''): Promise<string> {
      if (depth > maxDepth) return ''
      
      try {
        const items = (await fsPromises.readdir(currentPath, { withFileTypes: true }))
          .sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1
            if (!a.isDirectory() && b.isDirectory()) return 1
            return a.name.localeCompare(b.name)
          })
        
        let result = ''
        const filteredItems = items.filter(item => {
          if (item.isDirectory() && IGNORED_DIRS.has(item.name)) return false
          if (item.isFile()) {
            const ext = path.extname(item.name).toLowerCase()
            if (IGNORED_EXTS.has(ext)) return false
          }
          return true
        })
        
        for (let i = 0; i < filteredItems.length; i++) {
          const item = filteredItems[i]
          const isLast = i === filteredItems.length - 1
          const pointer = isLast ? '└── ' : '├── '
          result += `${prefix}${pointer}${item.name}${item.isDirectory() ? '/' : ''}\n`
          
          if (item.isDirectory()) {
            const nextPrefix = prefix + (isLast ? '    ' : '│   ')
            result += await buildTree(path.join(currentPath, item.name), depth + 1, nextPrefix)
          }
        }
        return result
      } catch {
        return ''
      }
    }
    
    return buildTree(dirPath, 0)
  })

  // 读取文件
  ipcMain.handle('file:read', async (_, filePath: string) => {
    try {
      const stats = await fsPromises.stat(filePath)
      
      if (stats.size > 5 * 1024 * 1024) {
        return await readLargeFile(filePath, 0, 10000)
      }
      
      return await readFileWithEncoding(filePath)
    } catch (e: any) {
      console.error('[File] read failed:', filePath, e.message)
      return null
    }
  })

  // 写入文件
  ipcMain.handle('file:write', async (_, filePath: string, content: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') return false
      if (content === undefined || content === null) return false
      
      const dir = path.dirname(filePath)
      try {
        await fsPromises.access(dir)
      } catch {
        await fsPromises.mkdir(dir, { recursive: true })
      }
      
      await fsPromises.writeFile(filePath, content, 'utf-8')
      return true
    } catch (e: any) {
      console.error('[File] write failed:', filePath, e.message)
      return false
    }
  })

  // 确保目录存在
  ipcMain.handle('file:ensureDir', async (_, dirPath: string) => {
    try {
      await fsPromises.mkdir(dirPath, { recursive: true })
      return true
    } catch {
      return false
    }
  })

  // 保存文件对话框
  ipcMain.handle('file:save', async (_, content: string, currentPath?: string) => {
    const mainWindow = getMainWindow()
    
    if (currentPath) {
      await fsPromises.writeFile(currentPath, content, 'utf-8')
      return currentPath
    }
    
    if (!mainWindow) return null
    
    const result = await dialog.showSaveDialog(mainWindow, {
      filters: [{ name: 'All Files', extensions: ['*'] }],
    })
    
    if (!result.canceled && result.filePath) {
      await fsPromises.writeFile(result.filePath, content, 'utf-8')
      return result.filePath
    }
    return null
  })

  // 检查文件是否存在
  ipcMain.handle('file:exists', async (_, filePath: string) => {
    try {
      await fsPromises.access(filePath)
      return true
    } catch {
      return false
    }
  })

  // 创建目录
  ipcMain.handle('file:mkdir', async (_, dirPath: string) => {
    try {
      await fsPromises.mkdir(dirPath, { recursive: true })
      return true
    } catch {
      return false
    }
  })

  // 删除文件或目录
  ipcMain.handle('file:delete', async (_, filePath: string) => {
    try {
      const stat = await fsPromises.stat(filePath)
      if (stat.isDirectory()) {
        await fsPromises.rm(filePath, { recursive: true, force: true })
      } else {
        await fsPromises.unlink(filePath)
      }
      return true
    } catch {
      return false
    }
  })

  // 重命名文件
  ipcMain.handle('file:rename', async (_, oldPath: string, newPath: string) => {
    try {
      await fsPromises.rename(oldPath, newPath)
      return true
    } catch {
      return false
    }
  })

  // 在文件管理器中显示
  ipcMain.handle('file:showInFolder', async (_, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}

// 清理资源
export async function cleanupFileWatcher() {
  if (watcherSubscription) {
    try {
      await watcherSubscription.unsubscribe()
    } catch (e) {
      // 忽略 "Object has been destroyed" 错误
      // 这在 Electron 退出时是正常的，因为 native 对象可能已被销毁
      console.log('[Watcher] Cleanup skipped (already destroyed)')
    }
    watcherSubscription = null
  }
}
