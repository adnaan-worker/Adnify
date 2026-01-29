/**
 * 静态资源 IPC 处理器
 * 通用的 resources 目录文件读取，支持懒加载和缓存
 */

import { ipcMain, app } from 'electron'
import { toAppError } from '@shared/utils/errorHandler'
import * as fs from 'fs/promises'
import * as path from 'path'

/** 获取 resources 目录路径 */
function getResourcesPath(): string {
  if (app.isPackaged) {
    return process.resourcesPath
  } else {
    return path.join(app.getAppPath(), 'resources')
  }
}

/** 数据缓存 */
const cache = new Map<string, unknown>()

export function registerResourcesHandlers() {
  /**
   * 读取 resources 目录下的 JSON 文件
   * @param relativePath - 相对于 resources 的路径，如 'uiux/data/styles.json'
   */
  ipcMain.handle('resources:readJson', async (_, relativePath: string) => {
    try {
      // 检查缓存
      if (cache.has(relativePath)) {
        return { success: true, data: cache.get(relativePath) }
      }

      // 安全检查：防止路径遍历
      const normalizedPath = path.normalize(relativePath)
      if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
        return { success: false, error: 'Invalid path' }
      }

      // 只允许读取 JSON 文件
      if (!normalizedPath.endsWith('.json')) {
        return { success: false, error: 'Only JSON files allowed' }
      }

      const fullPath = path.join(getResourcesPath(), normalizedPath)
      const content = await fs.readFile(fullPath, 'utf-8')
      const data = JSON.parse(content)

      // 缓存数据
      cache.set(relativePath, data)

      return { success: true, data }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  /**
   * 读取 resources 目录下的文本文件
   */
  ipcMain.handle('resources:readText', async (_, relativePath: string) => {
    try {
      const normalizedPath = path.normalize(relativePath)
      if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
        return { success: false, error: 'Invalid path' }
      }

      const fullPath = path.join(getResourcesPath(), normalizedPath)
      const content = await fs.readFile(fullPath, 'utf-8')

      return { success: true, data: content }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  /**
   * 检查 resources 文件是否存在
   */
  ipcMain.handle('resources:exists', async (_, relativePath: string) => {
    try {
      const normalizedPath = path.normalize(relativePath)
      if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
        return false
      }

      const fullPath = path.join(getResourcesPath(), normalizedPath)
      await fs.access(fullPath)
      return true
    } catch {
      return false
    }
  })

  /**
   * 清除缓存
   */
  ipcMain.handle('resources:clearCache', (_, prefix?: string) => {
    if (prefix) {
      for (const key of cache.keys()) {
        if (key.startsWith(prefix)) {
          cache.delete(key)
        }
      }
    } else {
      cache.clear()
    }
    return { success: true }
  })
}
