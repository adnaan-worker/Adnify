/**
 * MCP 渲染进程服务
 * 封装与主进程 MCP 服务的通信
 */

import { api } from '@/renderer/services/electronAPI'
import { useStore } from '@store'
import { logger } from '@utils/Logger'
import type {
  McpServerState,
  McpToolCallRequest,
  McpToolCallResult,
  McpResourceReadRequest,
  McpResourceReadResult,
  McpPromptGetRequest,
  McpPromptGetResult,
} from '@shared/types/mcp'

class McpService {
  private initialized = false
  private cleanupFns: Array<() => void> = []

  /** 初始化 MCP 服务 */
  async initialize(workspaceRoots: string[]): Promise<void> {
    if (this.initialized) {
      // 重新初始化（工作区变更）
      await this.reinitialize(workspaceRoots)
      return
    }

    const store = useStore.getState()
    store.setMcpLoading(true)
    store.setMcpError(null)

    try {
      // 注册事件监听
      this.setupEventListeners()

      // 调用主进程初始化
      const result = await api.mcp.initialize(workspaceRoots)
      
      if (!result.success) {
        throw new Error(result.error || 'MCP initialization failed')
      }

      // 获取初始状态
      await this.refreshServersState()

      store.setMcpInitialized(true)
      this.initialized = true
      logger.agent.info('[McpService] Initialized')
    } catch (err: any) {
      logger.agent.error('[McpService] Initialize failed:', err)
      store.setMcpError(err.message)
      throw err
    } finally {
      store.setMcpLoading(false)
    }
  }

  /** 重新初始化（工作区变更） */
  private async reinitialize(workspaceRoots: string[]): Promise<void> {
    const store = useStore.getState()
    store.setMcpLoading(true)

    try {
      const result = await api.mcp.initialize(workspaceRoots)
      if (!result.success) {
        throw new Error(result.error)
      }
      await this.refreshServersState()
    } catch (err: any) {
      logger.agent.error('[McpService] Reinitialize failed:', err)
      store.setMcpError(err.message)
    } finally {
      store.setMcpLoading(false)
    }
  }

  /** 刷新服务器状态 */
  async refreshServersState(): Promise<McpServerState[]> {
    try {
      const result = await api.mcp.getServersState()
      if (result.success && result.servers) {
        useStore.getState().setMcpServers(result.servers)
        return result.servers
      }
      return []
    } catch (err: any) {
      logger.agent.error('[McpService] Refresh servers state failed:', err)
      return []
    }
  }

  /** 连接服务器 */
  async connectServer(serverId: string): Promise<boolean> {
    try {
      const result = await api.mcp.connectServer(serverId)
      if (result.success) {
        await this.refreshServersState()
      }
      return result.success
    } catch (err: any) {
      logger.agent.error(`[McpService] Connect server ${serverId} failed:`, err)
      return false
    }
  }

  /** 断开服务器 */
  async disconnectServer(serverId: string): Promise<boolean> {
    try {
      const result = await api.mcp.disconnectServer(serverId)
      if (result.success) {
        await this.refreshServersState()
      }
      return result.success
    } catch (err: any) {
      logger.agent.error(`[McpService] Disconnect server ${serverId} failed:`, err)
      return false
    }
  }

  /** 重连服务器 */
  async reconnectServer(serverId: string): Promise<boolean> {
    try {
      const result = await api.mcp.reconnectServer(serverId)
      if (result.success) {
        await this.refreshServersState()
      }
      return result.success
    } catch (err: any) {
      logger.agent.error(`[McpService] Reconnect server ${serverId} failed:`, err)
      return false
    }
  }

  /** 调用 MCP 工具 */
  async callTool(request: McpToolCallRequest): Promise<McpToolCallResult> {
    try {
      const result = await api.mcp.callTool(request)
      return result
    } catch (err: any) {
      logger.agent.error('[McpService] Call tool failed:', err)
      return { success: false, error: err.message }
    }
  }

  /** 读取 MCP 资源 */
  async readResource(request: McpResourceReadRequest): Promise<McpResourceReadResult> {
    try {
      const result = await api.mcp.readResource(request)
      return result
    } catch (err: any) {
      logger.agent.error('[McpService] Read resource failed:', err)
      return { success: false, error: err.message }
    }
  }

  /** 获取 MCP 提示 */
  async getPrompt(request: McpPromptGetRequest): Promise<McpPromptGetResult> {
    try {
      const result = await api.mcp.getPrompt(request)
      return result
    } catch (err: any) {
      logger.agent.error('[McpService] Get prompt failed:', err)
      return { success: false, error: err.message }
    }
  }

  /** 刷新服务器能力 */
  async refreshCapabilities(serverId: string): Promise<boolean> {
    try {
      const result = await api.mcp.refreshCapabilities(serverId)
      if (result.success) {
        await this.refreshServersState()
      }
      return result.success
    } catch (err: any) {
      logger.agent.error(`[McpService] Refresh capabilities ${serverId} failed:`, err)
      return false
    }
  }

  /** 获取配置路径 */
  async getConfigPaths(): Promise<{ user: string; workspace: string[] } | null> {
    try {
      const result = await api.mcp.getConfigPaths()
      return result.success ? result.paths! : null
    } catch (err: any) {
      logger.agent.error('[McpService] Get config paths failed:', err)
      return null
    }
  }

  /** 重新加载配置 */
  async reloadConfig(): Promise<boolean> {
    try {
      const result = await api.mcp.reloadConfig()
      if (result.success) {
        await this.refreshServersState()
      }
      return result.success
    } catch (err: any) {
      logger.agent.error('[McpService] Reload config failed:', err)
      return false
    }
  }

  /** 添加服务器（支持本地和远程） */
  async addServer(config: {
    type: 'local' | 'remote'
    id: string
    name: string
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
    oauth?: { clientId?: string; clientSecret?: string; scope?: string } | false
    autoApprove?: string[]
    disabled?: boolean
  }): Promise<boolean> {
    try {
      const result = await api.mcp.addServer(config)
      return result.success
    } catch (err: any) {
      logger.agent.error('[McpService] Add server failed:', err)
      return false
    }
  }

  /** 删除服务器 */
  async removeServer(serverId: string): Promise<boolean> {
    try {
      const result = await api.mcp.removeServer(serverId)
      return result.success
    } catch (err: any) {
      logger.agent.error(`[McpService] Remove server ${serverId} failed:`, err)
      return false
    }
  }

  /** 切换服务器启用/禁用状态 */
  async toggleServer(serverId: string, disabled: boolean): Promise<boolean> {
    try {
      const result = await api.mcp.toggleServer(serverId, disabled)
      return result.success
    } catch (err: any) {
      logger.agent.error(`[McpService] Toggle server ${serverId} failed:`, err)
      return false
    }
  }

  /** 开始 OAuth 认证流程 */
  async startOAuth(serverId: string): Promise<{ success: boolean; authorizationUrl?: string; error?: string }> {
    try {
      const result = await api.mcp.startOAuth(serverId)
      return result
    } catch (err: any) {
      logger.agent.error(`[McpService] Start OAuth ${serverId} failed:`, err)
      return { success: false, error: err.message }
    }
  }

  /** 完成 OAuth 认证 */
  async finishOAuth(serverId: string, authorizationCode: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await api.mcp.finishOAuth(serverId, authorizationCode)
      if (result.success) {
        await this.refreshServersState()
      }
      return result
    } catch (err: any) {
      logger.agent.error(`[McpService] Finish OAuth ${serverId} failed:`, err)
      return { success: false, error: err.message }
    }
  }

  /** 刷新 OAuth Token */
  async refreshOAuthToken(serverId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await api.mcp.refreshOAuthToken(serverId)
      if (result.success) {
        await this.refreshServersState()
      }
      return result
    } catch (err: any) {
      logger.agent.error(`[McpService] Refresh OAuth token ${serverId} failed:`, err)
      return { success: false, error: err.message }
    }
  }

  /** 获取所有可用工具 */
  getAllTools() {
    return useStore.getState().getAllMcpTools()
  }

  /** 获取所有可用资源 */
  getAllResources() {
    return useStore.getState().getAllMcpResources()
  }

  /** 清理资源 */
  cleanup(): void {
    for (const cleanup of this.cleanupFns) {
      cleanup()
    }
    this.cleanupFns = []
    this.initialized = false
  }

  // =================== 私有方法 ===================

  private setupEventListeners(): void {
    const store = useStore.getState()

    // 服务器状态变更
    const cleanupStatus = api.mcp.onServerStatus((event: { serverId: string; status: string; error?: string }) => {
      // 验证状态值是否有效
      const validStatuses: import('@shared/types/mcp').McpServerStatus[] = [
        'disconnected', 'connecting', 'connected', 'error', 'needs_auth', 'needs_registration'
      ]
      const status: import('@shared/types/mcp').McpServerStatus = validStatuses.includes(event.status as any) 
        ? event.status as import('@shared/types/mcp').McpServerStatus
        : 'error'
      store.updateMcpServerStatus(event.serverId, status, event.error)
    })
    this.cleanupFns.push(cleanupStatus)

    // 工具列表更新
    const cleanupTools = api.mcp.onToolsUpdated((event: { serverId: string; tools: any[] }) => {
      store.updateMcpServerTools(event.serverId, event.tools)
    })
    this.cleanupFns.push(cleanupTools)

    // 资源列表更新
    const cleanupResources = api.mcp.onResourcesUpdated((event: { serverId: string; resources: any[] }) => {
      store.updateMcpServerResources(event.serverId, event.resources)
    })
    this.cleanupFns.push(cleanupResources)

    // 完整状态更新
    const cleanupState = api.mcp.onStateChanged((servers: any[]) => {
      store.setMcpServers(servers)
    })
    this.cleanupFns.push(cleanupState)
  }
}

// 导出单例
export const mcpService = new McpService()
