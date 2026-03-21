/**
 * 安全的 IPC handlers 统一导出
 * 所有高危操作都已经过安全重构
 */

import { logger } from '@shared/utils/Logger'
import { BrowserWindow } from 'electron'
import Store from 'electron-store'

import { registerWindowHandlers } from './window' // 窗口控制
import { registerSettingsHandlers } from './settings' // 设置
import { registerSearchHandlers } from './search' // 搜索
import { registerLLMHandlers, cleanupLLMService, cleanupAllLLMServices } from './llm' // LLM
import { registerIndexingHandlers } from './indexing' // 索引
import { registerLspHandlers } from './lsp' // LSP
import { registerHttpHandlers } from './http' // HTTP
import { registerMcpHandlers, cleanupMcpHandlers } from './mcp' // MCP
import { registerResourcesHandlers } from './resources' // 资源
import { registerDebugHandlers } from './debug' // 调试
import { registerHealthCheckHandlers } from './healthCheck' // 健康检查
import { registerRemoteShellHandlers } from './remoteShell' // 远程 Shell / SFTP
import { registerSkillsHandlers } from './skills' // Skills

// 安全模块
import {
  securityManager,
  registerSecureTerminalHandlers,
  registerSecureFileHandlers,
  registerIsolatedWorkspaceHandlers,
  cleanupSecureFileWatcher,
  cleanupTerminals,
  updateWhitelist,
  getWhitelist,
} from '../security'
// 上下文类型
export interface IPCContext {
  // 获取窗口，如果没有指定窗口 ID，则返回最后一个活跃窗口
  getMainWindow: (windowId?: number) => BrowserWindow | null
  // isEmpty: 是否是空窗口，用于创建新窗口
  createWindow: (isEmpty?: boolean) => BrowserWindow
  /** 根据 key 路由到正确的 store */
  resolveStore: (key: string) => Store
  credentialsStore: Store
  preferencesStore: Store
  workspaceMetaStore: Store
  bootstrapStore: Store
  // 窗口-工作区管理（用于单项目单窗口模式）
  findWindowByWorkspace?: (roots: string[]) => BrowserWindow | null
  setWindowWorkspace?: (windowId: number, roots: string[]) => void
  getWindowWorkspace?: (windowId: number) => string[] | null
}

/**
 * 注册所有安全的 IPC handlers
 */
export function registerAllHandlers(context: IPCContext) {
  const { getMainWindow, createWindow, resolveStore, preferencesStore, workspaceMetaStore, bootstrapStore } = context

  // 窗口控制
  registerWindowHandlers(createWindow)

  // 文件操作（安全版）
  registerSecureFileHandlers(getMainWindow, workspaceMetaStore, (event) => {
    // 优先使用请求来源窗口的工作区（支持多窗口隔离）
    if (event && context.getWindowWorkspace) {
      const windowId = event.sender.id
      const windowRoots = context.getWindowWorkspace(windowId)
      if (windowRoots && windowRoots.length > 0) {
        return { roots: windowRoots }
      }
    }
    // 回退到全局存储
    return workspaceMetaStore.get('lastWorkspaceSession') as { roots: string[] } | null
  }, {
    findWindowByWorkspace: context.findWindowByWorkspace,
    setWindowWorkspace: context.setWindowWorkspace,
  })

  registerIsolatedWorkspaceHandlers()

  // 设置（传入 resolveStore 和各 store 引用）
  registerSettingsHandlers(resolveStore, preferencesStore, bootstrapStore, {
    securityManager,
    updateWhitelist,
    getWhitelist
  })

  // 终端（安全版）- 传入窗口工作区获取函数实现多窗口隔离
  registerSecureTerminalHandlers(getMainWindow, (event) => {
    // 优先使用请求来源窗口的工作区（支持多窗口隔离）
    if (event && context.getWindowWorkspace) {
      const windowId = event.sender.id
      const windowRoots = context.getWindowWorkspace(windowId)
      if (windowRoots && windowRoots.length > 0) {
        return { roots: windowRoots }
      }
    }
    // 回退到全局存储
    return workspaceMetaStore.get('lastWorkspaceSession') as { roots: string[] } | null
  }, context.getWindowWorkspace)

  // 搜索
  registerSearchHandlers()

  // LLM
  registerLLMHandlers(getMainWindow)

  // 索引 - 传入 workspaceMetaStore 以读取保存的 embedding 配置
  registerIndexingHandlers(getMainWindow, workspaceMetaStore)

  // LSP 语言服务
  registerLspHandlers(preferencesStore)

  // HTTP 请求（用于 web_search / read_url）
  registerHttpHandlers()

  // MCP 服务
  registerMcpHandlers(getMainWindow)

  // 静态资源
  registerResourcesHandlers()

  // 调试服务
  registerDebugHandlers()

  // 健康检查
  registerHealthCheckHandlers()

  // 远程 Shell / SFTP
  registerRemoteShellHandlers()

  // Skills
  registerSkillsHandlers()

  logger.ipc.info('[Security] 所有安全IPC处理器已注册')
}

/**
 * 清理所有资源
 */
export function cleanupAllHandlers() {
  logger.ipc.info('[IPC] Cleaning up all handlers...')
  cleanupTerminals()
  cleanupSecureFileWatcher()
  cleanupMcpHandlers()
  cleanupAllLLMServices()
  // DebugService 清理由 performGlobalCleanup 中异步处理（需要 await）
  logger.ipc.info('[IPC] All handlers cleaned up')
}

export { cleanupLLMService }

