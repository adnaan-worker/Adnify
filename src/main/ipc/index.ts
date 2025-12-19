/**
 * 安全的 IPC handlers 统一导出
 * 所有高危操作都已经过安全重构
 */

import { BrowserWindow } from 'electron'
import Store from 'electron-store'

import { registerWindowHandlers } from './window'
import { registerSettingsHandlers } from './settings'
import { registerSearchHandlers } from './search'
import { registerLLMHandlers, updateLLMServiceWindow } from './llm'
import { registerIndexingHandlers } from './indexing'
import { registerLspHandlers } from './lsp'
import { registerHttpHandlers } from './http'

// 安全模块
import {
  securityManager,
  registerSecureTerminalHandlers,
  registerSecureFileHandlers,
  cleanupSecureFileWatcher,
  updateWhitelist,
  getWhitelist,
} from '../security'

export interface IPCContext {
  getMainWindow: () => BrowserWindow | null
  createWindow: () => BrowserWindow
  mainStore: Store
  bootstrapStore: Store
  setMainStore: (store: Store) => void
}

/**
 * 注册所有安全的 IPC handlers
 */
export function registerAllHandlers(context: IPCContext) {
  const { getMainWindow, createWindow, mainStore, bootstrapStore, setMainStore } = context

  // 初始化安全模块
  securityManager.setMainWindow(getMainWindow())

  // 窗口控制
  registerWindowHandlers(createWindow)

  // 文件操作（安全版）
  registerSecureFileHandlers(getMainWindow, mainStore, () => {
    return mainStore.get('lastWorkspaceSession') as { roots: string[] } | null
  })

  // 设置（传入安全模块引用）
  registerSettingsHandlers(mainStore, bootstrapStore, setMainStore, {
    securityManager,
    updateWhitelist,
    getWhitelist
  })

  // 终端（安全版）
  registerSecureTerminalHandlers(getMainWindow, () => {
    return mainStore.get('lastWorkspaceSession') as { roots: string[] } | null
  })

  // 搜索
  registerSearchHandlers()

  // LLM
  registerLLMHandlers(getMainWindow)

  // 索引
  registerIndexingHandlers(getMainWindow)

  // LSP 语言服务
  registerLspHandlers()

  // HTTP 请求（用于 web_search / read_url）
  registerHttpHandlers()

  console.log('[Security] 所有安全IPC处理器已注册')
}

/**
 * 清理所有资源
 */
export function cleanupAllHandlers() {
  console.log('[IPC] Cleaning up all handlers...')
  cleanupSecureFileWatcher()
  console.log('[IPC] All handlers cleaned up')
}

export { updateLLMServiceWindow }

