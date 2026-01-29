/**
 * MCP IPC 处理器
 * 处理渲染进程与 MCP 服务的通信
 * 支持本地和远程 MCP 服务器，包括 OAuth 认证
 */

import { ipcMain, BrowserWindow } from 'electron'
import { toAppError } from '@shared/utils/errorHandler'
import { logger } from '@shared/utils/Logger'
import { mcpManager } from '../services/mcp'
import type {
  McpToolCallRequest,
  McpResourceReadRequest,
  McpPromptGetRequest,
  McpServerConfig,
} from '@shared/types/mcp'

export function registerMcpHandlers(_getMainWindow: () => BrowserWindow | null): void {
  // 初始化 MCP 管理器
  ipcMain.handle('mcp:initialize', async (_, workspaceRoots: string[]) => {
    try {
      await mcpManager.initialize(workspaceRoots)
      return { success: true }
    } catch (err) {
      logger.mcp?.error('[MCP IPC] Initialize failed:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取所有服务器状态
  ipcMain.handle('mcp:getServersState', async () => {
    try {
      return { success: true, servers: mcpManager.getServersState() }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取所有可用工具
  ipcMain.handle('mcp:getAllTools', async () => {
    try {
      return { success: true, tools: mcpManager.getAllTools() }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 连接服务器
  ipcMain.handle('mcp:connectServer', async (_, serverId: string) => {
    try {
      await mcpManager.connectServer(serverId)
      return { success: true }
    } catch (err) {
      logger.mcp?.error(`[MCP IPC] Connect server ${serverId} failed:`, err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 断开服务器
  ipcMain.handle('mcp:disconnectServer', async (_, serverId: string) => {
    try {
      await mcpManager.disconnectServer(serverId)
      return { success: true }
    } catch (err) {
      logger.mcp?.error(`[MCP IPC] Disconnect server ${serverId} failed:`, err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 重连服务器
  ipcMain.handle('mcp:reconnectServer', async (_, serverId: string) => {
    try {
      await mcpManager.reconnectServer(serverId)
      return { success: true }
    } catch (err) {
      logger.mcp?.error(`[MCP IPC] Reconnect server ${serverId} failed:`, err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 调用工具
  ipcMain.handle('mcp:callTool', async (_, request: McpToolCallRequest) => {
    try {
      const result = await mcpManager.callTool(
        request.serverId,
        request.toolName,
        request.arguments
      )
      return result
    } catch (err) {
      logger.mcp?.error('[MCP IPC] Call tool failed:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 读取资源
  ipcMain.handle('mcp:readResource', async (_, request: McpResourceReadRequest) => {
    try {
      const result = await mcpManager.readResource(request.serverId, request.uri)
      return result
    } catch (err) {
      logger.mcp?.error('[MCP IPC] Read resource failed:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取提示
  ipcMain.handle('mcp:getPrompt', async (_, request: McpPromptGetRequest) => {
    try {
      const result = await mcpManager.getPrompt(
        request.serverId,
        request.promptName,
        request.arguments
      )
      return result
    } catch (err) {
      logger.mcp?.error('[MCP IPC] Get prompt failed:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 刷新服务器能力
  ipcMain.handle('mcp:refreshCapabilities', async (_, serverId: string) => {
    try {
      await mcpManager.refreshServerCapabilities(serverId)
      return { success: true }
    } catch (err) {
      logger.mcp?.error(`[MCP IPC] Refresh capabilities ${serverId} failed:`, err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 获取配置路径
  ipcMain.handle('mcp:getConfigPaths', async () => {
    try {
      return { success: true, paths: mcpManager.getConfigPaths() }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  // 重新加载配置
  ipcMain.handle('mcp:reloadConfig', async () => {
    try {
      await mcpManager.reloadConfig()
      return { success: true }
    } catch (err) {
      logger.mcp?.error('[MCP IPC] Reload config failed:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 添加服务器（支持本地和远程）
  ipcMain.handle('mcp:addServer', async (_, config: McpServerConfig) => {
    try {
      await mcpManager.addServer(config)
      return { success: true }
    } catch (err) {
      logger.mcp?.error('[MCP IPC] Add server failed:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 删除服务器
  ipcMain.handle('mcp:removeServer', async (_, serverId: string) => {
    try {
      await mcpManager.removeServer(serverId)
      return { success: true }
    } catch (err) {
      logger.mcp?.error(`[MCP IPC] Remove server ${serverId} failed:`, err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 切换服务器启用/禁用
  ipcMain.handle('mcp:toggleServer', async (_, serverId: string, disabled: boolean) => {
    try {
      await mcpManager.toggleServer(serverId, disabled)
      return { success: true }
    } catch (err) {
      logger.mcp?.error(`[MCP IPC] Toggle server ${serverId} failed:`, err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // =================== OAuth 相关处理器 ===================

  // 开始 OAuth 认证流程
  ipcMain.handle('mcp:startOAuth', async (_, serverId: string) => {
    try {
      const result = await mcpManager.startOAuth(serverId)
      return result
    } catch (err) {
      logger.mcp?.error(`[MCP IPC] Start OAuth ${serverId} failed:`, err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 完成 OAuth 认证
  ipcMain.handle('mcp:finishOAuth', async (_, serverId: string, authorizationCode: string) => {
    try {
      const result = await mcpManager.finishOAuth(serverId, authorizationCode)
      return result
    } catch (err) {
      logger.mcp?.error(`[MCP IPC] Finish OAuth ${serverId} failed:`, err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 刷新 OAuth token
  ipcMain.handle('mcp:refreshOAuthToken', async (_, serverId: string) => {
    try {
      const result = await mcpManager.refreshOAuthToken(serverId)
      return result
    } catch (err) {
      logger.mcp?.error(`[MCP IPC] Refresh OAuth token ${serverId} failed:`, err)
      return { success: false, error: toAppError(err).message }
    }
  })

  // 设置自动连接选项
  ipcMain.handle('mcp:setAutoConnect', async (_, enabled: boolean) => {
    try {
      mcpManager.setAutoConnectEnabled(enabled)
      return { success: true }
    } catch (err) {
      logger.mcp?.error('[MCP IPC] Set auto-connect failed:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  logger.mcp?.info('[MCP IPC] Handlers registered')
}

export function cleanupMcpHandlers(): void {
  mcpManager.cleanup().catch(err => {
    logger.mcp?.error('[MCP IPC] Cleanup failed:', err)
  })
}

export { mcpManager }
