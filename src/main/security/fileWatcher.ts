/**
 * 文件监听服务
 * 使用 @parcel/watcher 监听文件变化
 */

import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { FileChangeBuffer, createFileChangeHandler } from '../indexing/fileChangeBuffer'
import { getIndexService } from '../indexing/indexService'
import { lspManager } from '../lspManager'
import * as watcher from '@parcel/watcher'
import picomatch from 'picomatch'

export interface FileWatcherEvent {
  event: 'create' | 'update' | 'delete'
  path: string
}

export interface FileWatcherConfig {
  ignored: (string | RegExp)[]
  persistent: boolean
  ignoreInitial: boolean
  bufferTimeMs: number
  maxBufferSize: number
  maxWaitTimeMs: number
}

const DEFAULT_CONFIG: FileWatcherConfig = {
  ignored: [/node_modules/, /\.git/, /dist/, /build/, /\.adnify/, '**/*.tmp', '**/*.temp'],
  persistent: true,
  ignoreInitial: true,
  bufferTimeMs: 500,
  maxBufferSize: 50,
  maxWaitTimeMs: 5000,
}

let watcherSubscription: watcher.AsyncSubscription | null = null
let fileChangeBuffer: FileChangeBuffer | null = null

// LSP 文件变更类型映射
const LSP_FILE_CHANGE_TYPE = {
  create: 1,
  update: 2,
  delete: 3,
} as const

// 创建忽略匹配器
function createIgnoreMatcher(patterns: (string | RegExp)[]): (path: string) => boolean {
  const regexPatterns = patterns.filter((p): p is RegExp => p instanceof RegExp)
  const globPatterns = patterns.filter((p): p is string => typeof p === 'string')
  const globMatcher = globPatterns.length > 0 ? picomatch(globPatterns) : null

  return (filePath: string) => {
    // 检查正则
    for (const regex of regexPatterns) {
      if (regex.test(filePath)) return true
    }
    // 检查 glob
    if (globMatcher && globMatcher(filePath)) return true
    return false
  }
}

/**
 * 通知 LSP 服务器文件变化
 */
function notifyLspFileChanges(changes: Array<{ path: string; type: 'create' | 'update' | 'delete' }>): void {
  const runningServers = lspManager.getRunningServers()
  if (runningServers.length === 0) return

  const lspChanges = changes.map(c => ({
    uri: pathToLspUri(c.path),
    type: LSP_FILE_CHANGE_TYPE[c.type],
  }))

  for (const serverKey of runningServers) {
    lspManager.notifyDidChangeWatchedFiles(serverKey, lspChanges)
  }
}

/**
 * 将文件路径转换为 LSP URI
 */
function pathToLspUri(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/')
  if (/^[a-zA-Z]:/.test(normalizedPath)) {
    return `file:///${normalizedPath}`
  }
  return `file://${normalizedPath}`
}

/**
 * 设置文件监听器
 */
export async function setupFileWatcher(
  getWorkspaceSessionFn: () => { roots: string[] } | null,
  callback: (data: FileWatcherEvent) => void,
  config?: Partial<FileWatcherConfig>
): Promise<void> {
  const workspace = getWorkspaceSessionFn()
  if (!workspace || workspace.roots.length === 0) return

  const mergedConfig = { ...DEFAULT_CONFIG, ...config }
  const shouldIgnore = createIgnoreMatcher(mergedConfig.ignored)

  // 使用工厂函数创建文件变更缓冲器
  const indexService = getIndexService(workspace.roots[0])
  fileChangeBuffer = createFileChangeHandler(indexService, {
    bufferTimeMs: mergedConfig.bufferTimeMs,
    maxBufferSize: mergedConfig.maxBufferSize,
    maxWaitTimeMs: mergedConfig.maxWaitTimeMs,
  })

  // @parcel/watcher 配置
  // ignore: 要忽略的 glob 模式（只支持字符串）
  // backend: 根据平台选择最佳后端，避免尝试 watchman 导致的问题
  const getBackend = (): watcher.BackendType | undefined => {
    switch (process.platform) {
      case 'win32': return 'windows'
      case 'darwin': return 'fs-events'
      case 'linux': return 'inotify'
      default: return undefined
    }
  }
  
  const watcherOptions: watcher.Options = {
    ignore: mergedConfig.ignored.filter((p): p is string => typeof p === 'string'),
    backend: getBackend(),
  }
  
  watcherSubscription = await watcher.subscribe(workspace.roots[0], (err, events) => {
    if (err) {
      logger.security.error('[Watcher] Error:', err)
      return
    }

    // 收集 LSP 通知的变更
    const lspChanges: Array<{ path: string; type: 'create' | 'update' | 'delete' }> = []

    for (const event of events) {
      if (shouldIgnore(event.path)) continue

      const eventType = event.type === 'create' ? 'create' : event.type === 'delete' ? 'delete' : 'update'
      callback({ event: eventType, path: event.path })
      fileChangeBuffer?.add({ type: eventType, path: event.path, timestamp: Date.now() })
      
      // 收集用于 LSP 通知
      lspChanges.push({ path: event.path, type: eventType })
    }

    // 批量通知 LSP 服务器
    if (lspChanges.length > 0) {
      notifyLspFileChanges(lspChanges)
    }
  }, watcherOptions)

  logger.security.info('[Watcher] File watcher started for:', workspace.roots[0])
}

/**
 * 清理文件监听器
 */
export async function cleanupFileWatcher(): Promise<void> {
  // 清理文件变更缓冲器
  if (fileChangeBuffer) {
    fileChangeBuffer.destroy()
    fileChangeBuffer = null
  }

  if (watcherSubscription) {
    logger.security.info('[Watcher] Cleaning up file watcher...')
    const subscription = watcherSubscription
    watcherSubscription = null
    try {
      await subscription.unsubscribe()
    } catch (err) {
      logger.security.info('[Watcher] Cleanup completed (ignored error):', toAppError(err).message)
    }
  }
}

/**
 * 获取监听器状态
 */
export function getWatcherStatus(): {
  isActive: boolean
  hasBuffer: boolean
  bufferSize: number
} {
  return {
    isActive: watcherSubscription !== null,
    hasBuffer: fileChangeBuffer !== null,
    bufferSize: fileChangeBuffer?.size() ?? 0,
  }
}

/**
 * 强制刷新缓冲区
 */
export function flushBuffer(): void {
  fileChangeBuffer?.flush()
}
