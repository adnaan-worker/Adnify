/**
 * MCP IPC 处理器
 * 处理渲染进程与 MCP 服务的通信
 */

import { ipcMain, BrowserWindow } from 'electron'
import { logger } from '@shared/utils/Logger'
import { mcpManager } from '../services/mcp'
import type {
  McpToolCallRequest,
  McpResourceReadRequest,
  McpPromptGetRequest,
} from '@shared/types/mcp'

export function registerMcpHandlers(_getMainWindow: () => BrowserWindow | null): void {
  // 初始化 MCP 管理器
  ipcMain.handle('mcp:initialize', async (_, workspaceRoots: string[]) => {
    try {
      await mcpManager.initialize(workspaceRoots)
      return { success: true }
    } catch (err: any) {
      logger.mcp?.error('[MCP IPC] Initialize failed:', err)
      return { success: false, error: err.message }
    }
  })

  // 获取所有服务器状态
  ipcMain.handle('mcp:getServersState', async () => {
    try {
      return { success: true, servers: mcpManager.getServersState() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // 获取所有可用工具
  ipcMain.handle('mcp:getAllTools', async () => {
    try {
      return { success: true, tools: mcpManager.getAllTools() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // 连接服务器
  ipcMain.handle('mcp:connectServer', async (_, serverId: string) => {
    try {
      await mcpManager.connectServer(serverId)
      return { success: true }
    } catch (err: any) {
      logger.mcp?.error(`[MCP IPC] Connect server ${serverId} failed:`, err)
      return { success: false, error: err.message }
    }
  })

  // 断开服务器
  ipcMain.handle('mcp:disconnectServer', async (_, serverId: string) => {
    try {
      await mcpManager.disconnectServer(serverId)
      return { success: true }
    } catch (err: any) {
      logger.mcp?.error(`[MCP IPC] Disconnect server ${serverId} failed:`, err)
      return { success: false, error: err.message }
    }
  })

  // 重连服务器
  ipcMain.handle('mcp:reconnectServer', async (_, serverId: string) => {
    try {
      await mcpManager.reconnectServer(serverId)
      return { success: true }
    } catch (err: any) {
      logger.mcp?.error(`[MCP IPC] Reconnect server ${serverId} failed:`, err)
      return { success: false, error: err.message }
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
    } catch (err: any) {
      logger.mcp?.error('[MCP IPC] Call tool failed:', err)
      return { success: false, error: err.message }
    }
  })

  // 读取资源
  ipcMain.handle('mcp:readResource', async (_, request: McpResourceReadRequest) => {
    try {
      const result = await mcpManager.readResource(request.serverId, request.uri)
      return result
    } catch (err: any) {
      logger.mcp?.error('[MCP IPC] Read resource failed:', err)
      return { success: false, error: err.message }
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
    } catch (err: any) {
      logger.mcp?.error('[MCP IPC] Get prompt failed:', err)
      return { success: false, error: err.message }
    }
  })

  // 刷新服务器能力
  ipcMain.handle('mcp:refreshCapabilities', async (_, serverId: string) => {
    try {
      await mcpManager.refreshServerCapabilities(serverId)
      return { success: true }
    } catch (err: any) {
      logger.mcp?.error(`[MCP IPC] Refresh capabilities ${serverId} failed:`, err)
      return { success: false, error: err.message }
    }
  })

  // 获取配置路径
  ipcMain.handle('mcp:getConfigPaths', async () => {
    try {
      return { success: true, paths: mcpManager.getConfigPaths() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // 重新加载配置
  ipcMain.handle('mcp:reloadConfig', async () => {
    try {
      await mcpManager.reloadConfig()
      return { success: true }
    } catch (err: any) {
      logger.mcp?.error('[MCP IPC] Reload config failed:', err)
      return { success: false, error: err.message }
    }
  })

  // 添加服务器
  ipcMain.handle('mcp:addServer', async (_, config: {
    id: string
    name: string
    command: string
    args: string[]
    env: Record<string, string>
    autoApprove: string[]
    disabled: boolean
  }) => {
    try {
      await mcpManager.addServer(config)
      return { success: true }
    } catch (err: any) {
      logger.mcp?.error('[MCP IPC] Add server failed:', err)
      return { success: false, error: err.message }
    }
  })

  // 删除服务器
  ipcMain.handle('mcp:removeServer', async (_, serverId: string) => {
    try {
      await mcpManager.removeServer(serverId)
      return { success: true }
    } catch (err: any) {
      logger.mcp?.error(`[MCP IPC] Remove server ${serverId} failed:`, err)
      return { success: false, error: err.message }
    }
  })

  // 切换服务器启用/禁用
  ipcMain.handle('mcp:toggleServer', async (_, serverId: string, disabled: boolean) => {
    try {
      await mcpManager.toggleServer(serverId, disabled)
      return { success: true }
    } catch (err: any) {
      logger.mcp?.error(`[MCP IPC] Toggle server ${serverId} failed:`, err)
      return { success: false, error: err.message }
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
