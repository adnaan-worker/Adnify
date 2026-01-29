/**
 * MCP 客户端（使用官方 SDK）
 * 支持本地（stdio）和远程（HTTP/SSE）MCP 服务器
 */

import { EventEmitter } from 'events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import {
  CallToolResultSchema,
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { McpOAuthProvider } from './McpOAuthProvider'
import type {
  McpServerConfig,
  McpLocalServerConfig,
  McpRemoteServerConfig,
  McpTool,
  McpResource,
  McpPrompt,
  McpServerStatus,
  McpContent,
  McpOAuthTokens,
} from '@shared/types/mcp'
import { isRemoteConfig } from '@shared/types/mcp'

const DEFAULT_TIMEOUT = 30000

type Transport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport

interface ClientState {
  config: McpServerConfig
  client: Client | null
  transport: Transport | null
  status: McpServerStatus
  error?: string
  tools: McpTool[]
  resources: McpResource[]
  prompts: McpPrompt[]
  authUrl?: string
  oauthProvider?: McpOAuthProvider
}

export class McpClient extends EventEmitter {
  private state: ClientState

  constructor(config: McpServerConfig) {
    super()
    this.state = {
      config,
      client: null,
      transport: null,
      status: 'disconnected',
      tools: [],
      resources: [],
      prompts: [],
    }
  }

  get id(): string {
    return this.state.config.id
  }
  get status(): McpServerStatus {
    return this.state.status
  }
  get tools(): McpTool[] {
    return this.state.tools
  }
  get resources(): McpResource[] {
    return this.state.resources
  }
  get prompts(): McpPrompt[] {
    return this.state.prompts
  }
  get error(): string | undefined {
    return this.state.error
  }
  get authUrl(): string | undefined {
    return this.state.authUrl
  }

  /** 连接到 MCP 服务器 */
  async connect(): Promise<void> {
    if (this.state.status === 'connected' || this.state.status === 'connecting') {
      return
    }

    this.updateStatus('connecting')
    const { config } = this.state

    try {
      if (isRemoteConfig(config)) {
        await this.connectRemote(config)
      } else {
        await this.connectLocal(config)
      }
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.error(`[MCP:${config.id}] Connection failed: ${error.code}`, error)
      if (this.state.status !== 'needs_auth' && this.state.status !== 'needs_registration') {
        this.updateStatus('error', error.message)
      }
      throw error
    }
  }

  /** 连接本地服务器 */
  private async connectLocal(config: McpLocalServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: { ...process.env, ...config.env } as Record<string, string>,
      cwd: config.cwd,
      stderr: 'ignore',
    })

    const client = new Client({
      name: 'adnify',
      version: process.env.npm_package_version || '1.0.0',
    })

    this.registerNotificationHandlers(client)

    const timeout = config.timeout || DEFAULT_TIMEOUT
    await this.withTimeout(client.connect(transport), timeout)

    this.state.client = client
    this.state.transport = transport

    await this.refreshCapabilities()
    this.updateStatus('connected')
    logger.mcp?.info(`[MCP:${config.id}] Connected (local)`)
  }

  /** 连接远程服务器 */
  private async connectRemote(config: McpRemoteServerConfig): Promise<void> {
    const oauthDisabled = config.oauth === false
    const oauthConfig = typeof config.oauth === 'object' ? config.oauth : undefined
    let authProvider: McpOAuthProvider | undefined
    let capturedAuthUrl: string | undefined

    if (!oauthDisabled) {
      authProvider = new McpOAuthProvider(config.id, config.url, {
        clientId: oauthConfig?.clientId,
        clientSecret: oauthConfig?.clientSecret,
        scope: oauthConfig?.scope,
        onRedirect: (url: URL) => {
          capturedAuthUrl = url.toString()
        },
      })
      this.state.oauthProvider = authProvider
    }

    // 尝试 StreamableHTTP 和 SSE 两种传输方式
    const transports: Array<{ name: string; create: () => Transport }> = [
      {
        name: 'StreamableHTTP',
        create: () =>
          new StreamableHTTPClientTransport(new URL(config.url), {
            authProvider,
            requestInit: config.headers ? { headers: config.headers } : undefined,
          }),
      },
      {
        name: 'SSE',
        create: () =>
          new SSEClientTransport(new URL(config.url), {
            authProvider,
            requestInit: config.headers ? { headers: config.headers } : undefined,
          }),
      },
    ]

    let lastError: Error | undefined
    const timeout = config.timeout || DEFAULT_TIMEOUT

    for (const { name, create } of transports) {
      try {
        const transport = create()
        const client = new Client({
          name: 'adnify',
          version: process.env.npm_package_version || '1.0.0',
        })

        this.registerNotificationHandlers(client)
        await this.withTimeout(client.connect(transport), timeout)

        this.state.client = client
        this.state.transport = transport

        await this.refreshCapabilities()
        this.updateStatus('connected')
        logger.mcp?.info(`[MCP:${config.id}] Connected (${name})`)
        return
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // 处理 OAuth 认证错误
        if (err instanceof UnauthorizedError) {
          logger.mcp?.info(`[MCP:${config.id}] Requires authentication`)

          if (lastError.message.includes('registration') || lastError.message.includes('client_id')) {
            this.updateStatus('needs_registration', 'Server requires pre-registered client ID')
          } else {
            this.state.authUrl = capturedAuthUrl
            this.updateStatus('needs_auth')
          }
          return
        }

        logger.mcp?.debug(`[MCP:${config.id}] ${name} transport failed:`, lastError.message)
      }
    }

    throw lastError || new Error('All transports failed')
  }

  /** 断开连接 */
  async disconnect(): Promise<void> {
    if (this.state.status === 'disconnected') {
      return
    }

    logger.mcp?.info(`[MCP:${this.id}] Disconnecting...`)

    if (this.state.client) {
      await this.state.client.close().catch((err) => {
        logger.mcp?.error(`[MCP:${this.id}] Close error:`, err)
      })
      this.state.client = null
    }

    this.state.transport = null
    this.state.tools = []
    this.state.resources = []
    this.state.prompts = []
    this.updateStatus('disconnected')
    this.emit('disconnected')
  }

  /** 调用工具 */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ content: McpContent[]; isError?: boolean }> {
    this.ensureConnected()

    const result = await this.state.client!.callTool(
      { name: toolName, arguments: args },
      CallToolResultSchema,
      { timeout: this.state.config.timeout || DEFAULT_TIMEOUT }
    )

    return {
      content: (result.content as any[]).map((c) => ({
        type: c.type as 'text' | 'image' | 'resource',
        text: c.text,
        data: c.data,
        mimeType: c.mimeType,
      })),
      isError: result.isError as boolean | undefined,
    }
  }

  /** 读取资源 */
  async readResource(
    uri: string
  ): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    this.ensureConnected()
    return this.state.client!.readResource({ uri })
  }

  /** 获取提示 */
  async getPrompt(
    name: string,
    args?: Record<string, string>
  ): Promise<{
    description?: string
    messages: Array<{ role: 'user' | 'assistant'; content: McpContent }>
  }> {
    this.ensureConnected()
    return this.state.client!.getPrompt({ name, arguments: args }) as any
  }

  /** 刷新能力列表 */
  async refreshCapabilities(): Promise<void> {
    if (!this.state.client) {
      throw new Error(`MCP server ${this.id} is not connected`)
    }

    const timeout = this.state.config.timeout || DEFAULT_TIMEOUT

    try {
      // 获取工具
      const toolsResult = await this.withTimeout(this.state.client.listTools(), timeout)
      this.state.tools = (toolsResult.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as McpTool['inputSchema'],
      }))
      this.emit('toolsUpdated', this.state.tools)

      // 获取资源
      try {
        const resourcesResult = await this.withTimeout(this.state.client.listResources(), timeout)
        this.state.resources = (resourcesResult.resources || []).map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        }))
        this.emit('resourcesUpdated', this.state.resources)
      } catch {
        this.state.resources = []
      }

      // 获取提示
      try {
        const promptsResult = await this.withTimeout(this.state.client.listPrompts(), timeout)
        this.state.prompts = (promptsResult.prompts || []).map((p) => ({
          name: p.name,
          description: p.description,
          arguments: p.arguments?.map((a) => ({
            name: a.name,
            description: a.description,
            required: a.required,
          })),
        }))
        this.emit('promptsUpdated', this.state.prompts)
      } catch {
        this.state.prompts = []
      }

      logger.mcp?.info(
        `[MCP:${this.id}] Capabilities: ${this.state.tools.length} tools, ${this.state.resources.length} resources, ${this.state.prompts.length} prompts`
      )
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.error(`[MCP:${this.id}] Failed to refresh capabilities: ${error.code}`, error)
      throw error
    }
  }

  /** 设置 OAuth tokens */
  setTokens(tokens: McpOAuthTokens): void {
    if (this.state.oauthProvider) {
      this.state.oauthProvider.setTokens(tokens)
    }
    this.state.authUrl = undefined
  }

  /** 获取 OAuth tokens */
  getTokens(): McpOAuthTokens | undefined {
    return this.state.oauthProvider?.getTokens()
  }

  /** 检查 token 是否过期 */
  isTokenExpired(): boolean {
    return this.state.oauthProvider?.isTokenExpired() ?? false
  }

  /** 完成 OAuth 认证 */
  async finishAuth(authorizationCode: string): Promise<void> {
    const transport = this.state.transport as StreamableHTTPClientTransport | SSEClientTransport
    if (transport && 'finishAuth' in transport) {
      await transport.finishAuth(authorizationCode)
    }
  }

  // =================== 私有方法 ===================

  private registerNotificationHandlers(client: Client): void {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      logger.mcp?.info(`[MCP:${this.id}] Tools list changed`)
      await this.refreshCapabilities().catch(() => {})
    })

    client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
      logger.mcp?.info(`[MCP:${this.id}] Resources list changed`)
      await this.refreshCapabilities().catch(() => {})
    })

    client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
      logger.mcp?.info(`[MCP:${this.id}] Prompts list changed`)
      await this.refreshCapabilities().catch(() => {})
    })
  }

  private updateStatus(status: McpServerStatus, error?: string): void {
    this.state.status = status
    this.state.error = error
    this.emit('statusChanged', { status, error, authUrl: this.state.authUrl })
  }

  private ensureConnected(): void {
    if (this.state.status !== 'connected' || !this.state.client) {
      throw new Error(`MCP server ${this.id} is not connected`)
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
    ])
  }
}
