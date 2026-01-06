/**
 * 安全的 IPC handlers 统一导出
 * 所有高危操作都已经过安全重构
 */

import { logger } from '@shared/utils/Logger'
import { BrowserWindow } from 'electron'
import Store from 'electron-store'

import { registerWindowHandlers } from './window'
import { registerSettingsHandlers } from './settings'
import { registerSearchHandlers } from './search'
import { registerLLMHandlers, updateLLMServiceWindow, cleanupLLMService } from './llm'
import { registerIndexingHandlers } from './indexing'
import { registerLspHandlers } from './lsp'
import { registerHttpHandlers } from './http'
import { registerMcpHandlers, cleanupMcpHandlers } from './mcp'
import { registerResourcesHandlers } from './resources'
import { registerDebugHandlers } from './debug'

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
  // 窗口-工作区管理（用于单项目单窗口模式）
  findWindowByWorkspace?: (roots: string[]) => BrowserWindow | null
  setWindowWorkspace?: (windowId: number, roots: string[]) => void
  getWindowWorkspace?: (windowId: number) => string[] | null
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
  }, {
    findWindowByWorkspace: context.findWindowByWorkspace,
    setWindowWorkspace: context.setWindowWorkspace,
  })

  // 设置（传入安全模块引用）
  registerSettingsHandlers(mainStore, bootstrapStore, setMainStore, {
    securityManager,
    updateWhitelist,
    getWhitelist
  })

  // 终端（安全版）- 传入窗口工作区获取函数实现多窗口隔离
  registerSecureTerminalHandlers(getMainWindow, () => {
    return mainStore.get('lastWorkspaceSession') as { roots: string[] } | null
  }, context.getWindowWorkspace)

  // 搜索
  registerSearchHandlers()

  // LLM
  registerLLMHandlers(getMainWindow)

  // 索引 - 传入 mainStore 以读取保存的 embedding 配置
  registerIndexingHandlers(getMainWindow, mainStore)

  // LSP 语言服务
  registerLspHandlers(mainStore)

  // HTTP 请求（用于 web_search / read_url）
  registerHttpHandlers()

  // MCP 服务
  registerMcpHandlers(getMainWindow)

  // 静态资源
  registerResourcesHandlers()

  // 调试服务
  registerDebugHandlers()

  logger.ipc.info('[Security] 所有安全IPC处理器已注册')
}

/**
 * 清理所有资源
 */
export function cleanupAllHandlers() {
  logger.ipc.info('[IPC] Cleaning up all handlers...')
  cleanupSecureFileWatcher()
  cleanupMcpHandlers()
  logger.ipc.info('[IPC] All handlers cleaned up')
}

export { updateLLMServiceWindow, cleanupLLMService }

