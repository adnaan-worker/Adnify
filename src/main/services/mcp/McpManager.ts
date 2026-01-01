/**
 * MCP 服务管理器
 * 统一管理所有 MCP 服务器的生命周期
 */

import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import { logger } from '@shared/utils/Logger'
import { McpClient } from './McpClient'
import { McpConfigLoader } from './McpConfigLoader'
import type {
  McpServerConfig,
  McpServerState,
  McpTool,
  McpResource,
  McpToolCallResult,
  McpResourceReadResult,
  McpPromptGetResult,
} from '@shared/types/mcp'

export class McpManager extends EventEmitter {
  private clients = new Map<string, McpClient>()
  private configLoader: McpConfigLoader
  private initialized = false

  constructor() {
    super()
    this.configLoader = new McpConfigLoader()
    this.configLoader.setOnConfigChange(() => this.handleConfigChange())
  }

  /** 初始化 MCP 管理器 */
  async initialize(workspaceRoots: string[] = []): Promise<void> {
    if (this.initialized) {
      // 更新工作区
      this.configLoader.setWorkspaceRoots(workspaceRoots)
      // 只重新加载配置，不自动连接
      this.notifyStateChange()
      return
    }

    logger.mcp?.info('[McpManager] Initializing...')
    this.configLoader.setWorkspaceRoots(workspaceRoots)
    
    // 只加载配置，不自动连接服务器
    // 用户需要手动连接或在使用工具时按需连接
    this.notifyStateChange()
    
    this.initialized = true
    logger.mcp?.info('[McpManager] Initialized')
  }

  /** 重新加载配置（配置文件变更时调用） */
  async reloadConfig(): Promise<void> {
    const configs = this.configLoader.loadConfig()
    const currentIds = new Set(this.clients.keys())
    const newIds = new Set(configs.map(c => c.id))

    // 断开已移除的服务器
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        await this.disconnectServer(id)
      }
    }

    // 对于已连接的服务器，如果配置变更或被禁用，断开连接
    for (const config of configs) {
      if (config.disabled && this.clients.has(config.id)) {
        await this.disconnectServer(config.id)
      }
    }

    // 不自动连接新服务器，只通知状态变更
    this.notifyStateChange()
  }

  /** 连接单个服务器 */
  async connectServer(configOrId: McpServerConfig | string): Promise<void> {
    // 支持传入 serverId 或完整 config
    let config: McpServerConfig
    if (typeof configOrId === 'string') {
      const configs = this.configLoader.loadConfig()
      const found = configs.find(c => c.id === configOrId)
      if (!found) {
        logger.mcp?.error(`[McpManager] Server config not found: ${configOrId}`)
        return
      }
      if (found.disabled) {
        logger.mcp?.warn(`[McpManager] Server ${configOrId} is disabled`)
        return
      }
      config = found
    } else {
      config = configOrId
    }

    if (this.clients.has(config.id)) {
      logger.mcp?.warn(`[McpManager] Server ${config.id} already connected`)
      return
    }

    const client = new McpClient(config)
    
    // 监听客户端事件
    client.on('statusChanged', ({ status, error }) => {
      this.sendToRenderer('mcp:serverStatus', {
        serverId: config.id,
        status,
        error,
      })
    })

    client.on('toolsUpdated', (tools: McpTool[]) => {
      this.sendToRenderer('mcp:toolsUpdated', {
        serverId: config.id,
        tools,
      })
    })

    client.on('resourcesUpdated', (resources: McpResource[]) => {
      this.sendToRenderer('mcp:resourcesUpdated', {
        serverId: config.id,
        resources,
      })
    })

    client.on('disconnected', () => {
      this.clients.delete(config.id)
      this.notifyStateChange()
    })

    this.clients.set(config.id, client)

    try {
      await client.connect()
    } catch (err: any) {
      logger.mcp?.error(`[McpManager] Failed to connect ${config.id}:`, err)
      // 保留客户端以显示错误状态
    }

    this.notifyStateChange()
  }

  /** 断开单个服务器 */
  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (!client) {
      return
    }

    await client.disconnect()
    this.clients.delete(serverId)
    this.notifyStateChange()
  }

  /** 重连服务器 */
  async reconnectServer(serverId: string): Promise<void> {
    // 先断开（如果已连接）
    if (this.clients.has(serverId)) {
      await this.disconnectServer(serverId)
    }
    // 重新连接
    await this.connectServer(serverId)
  }

  /** 获取所有服务器状态 */
  getServersState(): McpServerState[] {
    const configs = this.configLoader.loadConfig()
    const states: McpServerState[] = []

    for (const config of configs) {
      const client = this.clients.get(config.id)
      states.push({
        id: config.id,
        config,
        status: client?.status || (config.disabled ? 'disconnected' : 'disconnected'),
        error: client?.error,
        tools: client?.tools || [],
        resources: client?.resources || [],
        prompts: client?.prompts || [],
      })
    }

    return states
  }

  /** 获取所有可用工具 */
  getAllTools(): Array<McpTool & { serverId: string }> {
    const tools: Array<McpTool & { serverId: string }> = []
    
    for (const [serverId, client] of this.clients) {
      if (client.status === 'connected') {
        for (const tool of client.tools) {
          tools.push({ ...tool, serverId })
        }
      }
    }

    return tools
  }

  /** 调用工具 */
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const client = this.clients.get(serverId)
    if (!client) {
      return { success: false, error: `Server ${serverId} not found` }
    }

    if (client.status !== 'connected') {
      return { success: false, error: `Server ${serverId} is not connected` }
    }

    try {
      const result = await client.callTool(toolName, args)
      return {
        success: !result.isError,
        content: result.content,
        isError: result.isError,
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  /** 读取资源 */
  async readResource(serverId: string, uri: string): Promise<McpResourceReadResult> {
    const client = this.clients.get(serverId)
    if (!client) {
      return { success: false, error: `Server ${serverId} not found` }
    }

    if (client.status !== 'connected') {
      return { success: false, error: `Server ${serverId} is not connected` }
    }

    try {
      const result = await client.readResource(uri)
      return { success: true, contents: result.contents }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  /** 获取提示 */
  async getPrompt(serverId: string, promptName: string, args?: Record<string, string>): Promise<McpPromptGetResult> {
    const client = this.clients.get(serverId)
    if (!client) {
      return { success: false, error: `Server ${serverId} not found` }
    }

    if (client.status !== 'connected') {
      return { success: false, error: `Server ${serverId} is not connected` }
    }

    try {
      const result = await client.getPrompt(promptName, args)
      return {
        success: true,
        description: result.description,
        messages: result.messages,
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  /** 刷新服务器能力 */
  async refreshServerCapabilities(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (client && client.status === 'connected') {
      await client.refreshCapabilities()
      this.notifyStateChange()
    }
  }

  /** 添加服务器 */
  async addServer(config: {
    id: string
    name: string
    command: string
    args: string[]
    env: Record<string, string>
    autoApprove: string[]
    disabled: boolean
  }): Promise<void> {
    await this.configLoader.addServer({
      id: config.id,
      name: config.name,
      command: config.command,
      args: config.args,
      env: config.env,
      autoApprove: config.autoApprove,
      disabled: config.disabled,
    })
    logger.mcp?.info(`[McpManager] Added server: ${config.id}`)
  }

  /** 删除服务器 */
  async removeServer(serverId: string): Promise<void> {
    // 先断开连接
    if (this.clients.has(serverId)) {
      await this.disconnectServer(serverId)
    }
    // 从配置中删除
    await this.configLoader.removeServer(serverId)
    logger.mcp?.info(`[McpManager] Removed server: ${serverId}`)
  }

  /** 切换服务器启用/禁用状态 */
  async toggleServer(serverId: string, disabled: boolean): Promise<void> {
    await this.configLoader.toggleServer(serverId, disabled)
    if (disabled && this.clients.has(serverId)) {
      await this.disconnectServer(serverId)
    }
    logger.mcp?.info(`[McpManager] Toggled server ${serverId}: disabled=${disabled}`)
  }

  /** 获取配置路径 */
  getConfigPaths(): { user: string; workspace: string[] } {
    return {
      user: this.configLoader.getUserConfigPath(),
      workspace: this.configLoader['workspaceRoots'].map(root => 
        this.configLoader.getWorkspaceConfigPath(root)
      ),
    }
  }

  /** 清理资源 */
  async cleanup(): Promise<void> {
    logger.mcp?.info('[McpManager] Cleaning up...')
    
    for (const [, client] of this.clients) {
      await client.disconnect()
    }
    this.clients.clear()
    
    this.configLoader.cleanup()
    this.initialized = false
    
    logger.mcp?.info('[McpManager] Cleaned up')
  }

  // =================== 私有方法 ===================

  private handleConfigChange(): void {
    // 如果还没初始化完成，忽略配置变更
    if (!this.initialized) {
      logger.mcp?.debug('[McpManager] Ignoring config change during initialization')
      return
    }
    
    logger.mcp?.info('[McpManager] Config changed, reloading...')
    this.reloadConfig().catch(err => {
      logger.mcp?.error('[McpManager] Failed to reload config:', err)
    })
  }

  private notifyStateChange(): void {
    const state = this.getServersState()
    this.sendToRenderer('mcp:stateChanged', state)
  }

  private sendToRenderer(channel: string, data: unknown): void {
    // 广播到所有窗口（MCP 状态是全局的）
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        try {
          win.webContents.send(channel, data)
        } catch {
          // 忽略发送失败
        }
      }
    })
  }
}

// 导出单例
export const mcpManager = new McpManager()
