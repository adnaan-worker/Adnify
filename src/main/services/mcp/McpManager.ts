/**
 * MCP 服务管理器
 * 统一管理所有 MCP 服务器的生命周期
 */

import { BrowserWindow, shell } from 'electron'
import { EventEmitter } from 'events'
import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { McpClient } from './McpClient'
import { McpConfigLoader } from './McpConfigLoader'
import { McpOAuthCallback } from './McpOAuthCallback'
import { McpAuthStore } from './McpAuthStore'
import {
  type McpServerConfig,
  type McpServerState,
  type McpTool,
  type McpResource,
  type McpToolCallResult,
  type McpResourceReadResult,
  type McpPromptGetResult,
} from '@shared/types/mcp'

export class McpManager extends EventEmitter {
  private clients = new Map<string, McpClient>()
  private configLoader: McpConfigLoader
  private initialized = false
  private autoConnectEnabled = true // 默认启用

  constructor() {
    super()
    this.configLoader = new McpConfigLoader()
    this.configLoader.setOnConfigChange(() => this.handleConfigChange())
  }

  /** 设置是否启用自动连接 */
  setAutoConnectEnabled(enabled: boolean): void {
    this.autoConnectEnabled = enabled
    logger.mcp?.info(`[McpManager] Auto-connect ${enabled ? 'enabled' : 'disabled'}`)
  }

  /** 初始化 MCP 管理器 */
  async initialize(workspaceRoots: string[] = []): Promise<void> {
    if (this.initialized) {
      this.configLoader.setWorkspaceRoots(workspaceRoots)
      this.notifyStateChange()
      // 重新初始化时也尝试自动连接
      this.autoConnectServers()
      return
    }

    logger.mcp?.info('[McpManager] Initializing...')
    this.configLoader.setWorkspaceRoots(workspaceRoots)
    this.notifyStateChange()
    this.initialized = true
    logger.mcp?.info('[McpManager] Initialized')

    // 异步后台自动连接所有未禁用的服务器
    this.autoConnectServers()
  }

  /** 异步后台自动连接所有未禁用的服务器 */
  private autoConnectServers(): void {
    // 检查是否启用自动连接
    if (!this.autoConnectEnabled) {
      logger.mcp?.info('[McpManager] Auto-connect is disabled, skipping')
      return
    }

    const configs = this.configLoader.loadConfig()
    const enabledConfigs = configs.filter((c) => !c.disabled)

    if (enabledConfigs.length === 0) {
      logger.mcp?.info('[McpManager] No enabled servers to auto-connect')
      return
    }

    logger.mcp?.info(`[McpManager] Auto-connecting ${enabledConfigs.length} server(s) in background...`)

    // 异步并行连接所有服务器，不阻塞主流程
    Promise.all(
      enabledConfigs.map(async (config) => {
        try {
          // 跳过已连接的服务器
          if (this.clients.has(config.id)) {
            return
          }
          await this.connectServer(config)
          logger.mcp?.info(`[McpManager] Auto-connected: ${config.id}`)
        } catch (err) {
          const error = toAppError(err)
          logger.mcp?.warn(`[McpManager] Auto-connect failed for ${config.id}: ${error.code}`, error)
        }
      })
    ).then(() => {
      logger.mcp?.info('[McpManager] Auto-connect completed')
    })
  }

  /** 重新加载配置 */
  async reloadConfig(): Promise<void> {
    const configs = this.configLoader.loadConfig()
    const currentIds = new Set(this.clients.keys())
    const newIds = new Set(configs.map((c) => c.id))

    // 断开已移除的服务器
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        await this.disconnectServer(id)
      }
    }

    // 断开被禁用的服务器
    for (const config of configs) {
      if (config.disabled && this.clients.has(config.id)) {
        await this.disconnectServer(config.id)
      }
    }

    this.notifyStateChange()

    // 自动连接新添加或重新启用的服务器
    this.autoConnectServers()
  }

  /** 连接服务器 */
  async connectServer(configOrId: McpServerConfig | string): Promise<void> {
    let config: McpServerConfig
    if (typeof configOrId === 'string') {
      const configs = this.configLoader.loadConfig()
      const found = configs.find((c) => c.id === configOrId)
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

    // 监听事件
    client.on('statusChanged', ({ status, error, authUrl }) => {
      this.sendToRenderer('mcp:serverStatus', { serverId: config.id, status, error, authUrl })
    })

    client.on('toolsUpdated', (tools: McpTool[]) => {
      this.sendToRenderer('mcp:toolsUpdated', { serverId: config.id, tools })
    })

    client.on('resourcesUpdated', (resources: McpResource[]) => {
      this.sendToRenderer('mcp:resourcesUpdated', { serverId: config.id, resources })
    })

    client.on('disconnected', () => {
      this.clients.delete(config.id)
      this.notifyStateChange()
    })

    this.clients.set(config.id, client)

    try {
      await client.connect()
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.error(`[McpManager] Failed to connect ${config.id}: ${error.code}`, error)
    }

    this.notifyStateChange()
  }

  /** 断开服务器 */
  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (!client) return

    await client.disconnect()
    this.clients.delete(serverId)
    this.notifyStateChange()
  }

  /** 重连服务器 */
  async reconnectServer(serverId: string): Promise<void> {
    if (this.clients.has(serverId)) {
      await this.disconnectServer(serverId)
    }
    await this.connectServer(serverId)
  }

  /** 获取所有服务器状态 */
  getServersState(): McpServerState[] {
    const configs = this.configLoader.loadConfig()
    const states: McpServerState[] = []

    for (const config of configs) {
      const client = this.clients.get(config.id)
      const state: McpServerState = {
        id: config.id,
        config,
        status: client?.status || 'disconnected',
        error: client?.error,
        tools: client?.tools || [],
        resources: client?.resources || [],
        prompts: client?.prompts || [],
      }

      if (client) {
        state.authUrl = client.authUrl
        const tokens = client.getTokens()
        if (tokens) {
          state.authStatus = client.isTokenExpired() ? 'expired' : 'authenticated'
        } else if (client.status === 'needs_auth') {
          state.authStatus = 'not_authenticated'
        }
      }

      states.push(state)
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
      return { success: !result.isError, content: result.content, isError: result.isError }
    } catch (err) {
      const error = toAppError(err)
      return { success: false, error: error.message }
    }
  }

  /** 读取资源 */
  async readResource(serverId: string, uri: string): Promise<McpResourceReadResult> {
    const client = this.clients.get(serverId)
    if (!client || client.status !== 'connected') {
      return { success: false, error: `Server ${serverId} not available` }
    }

    try {
      const result = await client.readResource(uri)
      return { success: true, contents: result.contents }
    } catch (err) {
      const error = toAppError(err)
      return { success: false, error: error.message }
    }
  }

  /** 获取提示 */
  async getPrompt(serverId: string, promptName: string, args?: Record<string, string>): Promise<McpPromptGetResult> {
    const client = this.clients.get(serverId)
    if (!client || client.status !== 'connected') {
      return { success: false, error: `Server ${serverId} not available` }
    }

    try {
      const result = await client.getPrompt(promptName, args)
      return { success: true, description: result.description, messages: result.messages }
    } catch (err) {
      const error = toAppError(err)
      return { success: false, error: error.message }
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
  async addServer(config: McpServerConfig): Promise<void> {
    await this.configLoader.addServer(config)
    logger.mcp?.info(`[McpManager] Added server: ${config.id}`)
  }

  /** 删除服务器 */
  async removeServer(serverId: string): Promise<void> {
    if (this.clients.has(serverId)) {
      await this.disconnectServer(serverId)
    }
    await this.configLoader.removeServer(serverId)
    logger.mcp?.info(`[McpManager] Removed server: ${serverId}`)
  }

  /** 切换服务器启用/禁用 */
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
      workspace: this.configLoader['workspaceRoots'].map((root) => this.configLoader.getWorkspaceConfigPath(root)),
    }
  }

  // =================== OAuth 方法 ===================

  /** 开始 OAuth 认证 */
  async startOAuth(serverId: string): Promise<{ success: boolean; authorizationUrl?: string; error?: string }> {
    const client = this.clients.get(serverId)
    if (!client) {
      return { success: false, error: `Server ${serverId} not found` }
    }

    const authUrl = client.authUrl
    if (!authUrl) {
      return { success: false, error: 'No authorization URL available' }
    }

    // 启动回调服务器
    await McpOAuthCallback.ensureRunning()

    // 打开浏览器
    try {
      await shell.openExternal(authUrl)
      return { success: true, authorizationUrl: authUrl }
    } catch (err) {
      const error = toAppError(err)
      return { success: false, error: `Failed to open browser: ${error.message}` }
    }
  }

  /** 完成 OAuth 认证 */
  async finishOAuth(serverId: string, authorizationCode: string): Promise<{ success: boolean; error?: string }> {
    const client = this.clients.get(serverId)
    if (!client) {
      return { success: false, error: `Server ${serverId} not found` }
    }

    try {
      await client.finishAuth(authorizationCode)
      await McpAuthStore.clearCodeVerifier(serverId)

      // 重新连接
      await this.reconnectServer(serverId)
      return { success: true }
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.error(`[McpManager] OAuth finish failed for ${serverId}: ${error.code}`, error)
      return { success: false, error: error.message }
    }
  }

  /** 刷新 OAuth token */
  async refreshOAuthToken(serverId: string): Promise<{ success: boolean; error?: string }> {
    // SDK 会自动处理 token 刷新
    await this.reconnectServer(serverId)
    return { success: true }
  }

  /** 清理资源 */
  async cleanup(): Promise<void> {
    logger.mcp?.info('[McpManager] Cleaning up...')

    for (const [, client] of this.clients) {
      await client.disconnect()
    }
    this.clients.clear()

    await McpOAuthCallback.stop()
    this.configLoader.cleanup()
    this.initialized = false

    logger.mcp?.info('[McpManager] Cleaned up')
  }

  // =================== 私有方法 ===================

  private handleConfigChange(): void {
    if (!this.initialized) return
    logger.mcp?.info('[McpManager] Config changed, reloading...')
    this.reloadConfig().catch((err) => {
      logger.mcp?.error('[McpManager] Failed to reload config:', err)
    })
  }

  private notifyStateChange(): void {
    const state = this.getServersState()
    this.sendToRenderer('mcp:stateChanged', state)
  }

  private sendToRenderer(channel: string, data: unknown): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        try {
          win.webContents.send(channel, data)
        } catch {
          // ignore
        }
      }
    })
  }
}

export const mcpManager = new McpManager()
