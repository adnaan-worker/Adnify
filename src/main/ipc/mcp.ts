/**
 * MCP IPC 处理器
 * 处理渲染进程与 MCP 服务的通信
 * 支持本地和远程 MCP 服务器，包括 OAuth 认证
 */

import { BrowserWindow } from 'electron'
import { safeIpcHandle } from './safeHandle'
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
  safeIpcHandle('mcp:initialize', async (_, workspaceRoots: string[]) => {
    await mcpManager.initialize(workspaceRoots)
    return { success: true }
  })

  // 获取所有服务器状态
  safeIpcHandle('mcp:getServersState', async () => {
    return { success: true, servers: mcpManager.getServersState() }
  })

  // 获取所有可用工具
  safeIpcHandle('mcp:getAllTools', async () => {
    return { success: true, tools: mcpManager.getAllTools() }
  })

  // 连接服务器
  safeIpcHandle('mcp:connectServer', async (_, serverId: string) => {
    await mcpManager.connectServer(serverId)
    return { success: true }
  })

  // 断开服务器
  safeIpcHandle('mcp:disconnectServer', async (_, serverId: string) => {
    await mcpManager.disconnectServer(serverId)
    return { success: true }
  })

  // 重连服务器
  safeIpcHandle('mcp:reconnectServer', async (_, serverId: string) => {
    await mcpManager.reconnectServer(serverId)
    return { success: true }
  })

  // 调用工具
  safeIpcHandle('mcp:callTool', async (_, request: McpToolCallRequest) => {
    const result = await mcpManager.callTool(
      request.serverId,
      request.toolName,
      request.arguments
    )
    return result
  })

  // 读取资源
  safeIpcHandle('mcp:readResource', async (_, request: McpResourceReadRequest) => {
    const result = await mcpManager.readResource(request.serverId, request.uri)
    return result
  })

  // 获取提示
  safeIpcHandle('mcp:getPrompt', async (_, request: McpPromptGetRequest) => {
    const result = await mcpManager.getPrompt(
      request.serverId,
      request.promptName,
      request.arguments
    )
    return result
  })

  // 刷新服务器能力
  safeIpcHandle('mcp:refreshCapabilities', async (_, serverId: string) => {
    await mcpManager.refreshServerCapabilities(serverId)
    return { success: true }
  })

  // 获取配置路径
  safeIpcHandle('mcp:getConfigPaths', async () => {
    return { success: true, paths: mcpManager.getConfigPaths() }
  })

  // 重新加载配置
  safeIpcHandle('mcp:reloadConfig', async () => {
    await mcpManager.reloadConfig()
    return { success: true }
  })

  // 添加服务器（支持本地和远程）
  safeIpcHandle('mcp:addServer', async (_, config: McpServerConfig) => {
    await mcpManager.addServer(config)
    return { success: true }
  })

  // 删除服务器
  safeIpcHandle('mcp:removeServer', async (_, serverId: string) => {
    await mcpManager.removeServer(serverId)
    return { success: true }
  })

  // 切换服务器启用/禁用
  safeIpcHandle('mcp:toggleServer', async (_, serverId: string, disabled: boolean) => {
    await mcpManager.toggleServer(serverId, disabled)
    return { success: true }
  })

  // =================== OAuth 相关处理器 ===================

  // 开始 OAuth 认证流程
  safeIpcHandle('mcp:startOAuth', async (_, serverId: string) => {
    const result = await mcpManager.startOAuth(serverId)
    return result
  })

  // 完成 OAuth 认证
  safeIpcHandle('mcp:finishOAuth', async (_, serverId: string, authorizationCode: string) => {
    const result = await mcpManager.finishOAuth(serverId, authorizationCode)
    return result
  })

  // 刷新 OAuth token
  safeIpcHandle('mcp:refreshOAuthToken', async (_, serverId: string) => {
    const result = await mcpManager.refreshOAuthToken(serverId)
    return result
  })

  // 设置自动连接选项
  safeIpcHandle('mcp:setAutoConnect', async (_, enabled: boolean) => {
    mcpManager.setAutoConnectEnabled(enabled)
    return { success: true }
  })

  logger.mcp?.info('[MCP IPC] Handlers registered')
}

export function cleanupMcpHandlers(): void {
  mcpManager.cleanup().catch(err => {
    logger.mcp?.error('[MCP IPC] Cleanup failed:', err)
  })
}

export { mcpManager }
