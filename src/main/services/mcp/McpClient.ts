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
import * as cp from 'child_process'
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
const NPX_TIMEOUT = 60000  // npx 首次需要下载包，给更长超时

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
  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 5
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

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
    // 清理已有的重连 timer，防止多个 timer 并行
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

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
        this.scheduleReconnect()
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
      stderr: 'pipe',
    })

    // 捕获子进程 stderr 输出，用于诊断启动失败原因
    let stderrOutput = ''
    transport.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) {
        stderrOutput += text + '\n'
        logger.mcp?.warn(`[MCP:${config.id}] stderr: ${text}`)
      }
    })

    const client = new Client({
      name: 'adnify',
      version: process.env.npm_package_version || '1.0.0',
    })

    this.registerNotificationHandlers(client)

    // 智能超时：npx/uvx 命令给更长超时（首次需要下载包）
    const isPackageRunner = ['npx', 'uvx', 'bunx'].includes(config.command)
    const timeout = config.timeout || (isPackageRunner ? NPX_TIMEOUT : DEFAULT_TIMEOUT)
    try {
      await this.withTimeout(client.connect(transport), timeout)
    } catch (err) {
      // 连接失败时，附带 stderr 信息以便诊断
      if (stderrOutput) {
        logger.mcp?.error(`[MCP:${config.id}] Process stderr output:\n${stderrOutput}`)
      }
      throw err
    }

    this.state.client = client
    this.state.transport = transport

    await this.refreshCapabilities()
    this.reconnectAttempts = 0
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
      // 提升到 try 块外，使 catch 块中也能访问（用于保存 OAuth 等待状态）
      let transport: Transport | undefined
      let client: Client | undefined
      try {
        transport = create()
        client = new Client({
          name: 'adnify',
          version: process.env.npm_package_version || '1.0.0',
        })

        this.registerNotificationHandlers(client)
        await this.withTimeout(client.connect(transport), timeout)

        this.state.client = client
        this.state.transport = transport

        await this.refreshCapabilities()
        this.reconnectAttempts = 0
        this.updateStatus('connected')
        logger.mcp?.info(`[MCP:${config.id}] Connected (${name})`)
        return
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // 处理 OAuth 认证错误
        // 注意：bundler 环境下 ESM/CJS 双路径导致 instanceof 跨模块失效，
        // 需同时兼容 constructor.name 判断
        const isUnauthorized = err instanceof UnauthorizedError ||
          (err instanceof Error && err.constructor.name === 'UnauthorizedError')

        if (isUnauthorized) {
          logger.mcp?.info(`[MCP:${config.id}] Requires authentication`)

          // 必须保存 transport/client，后续 finishAuth() 需要在这个实例上调用
          // 如果不保存，finishAuth 会拿到 null transport 导致无法完成 token 交换
          this.state.client = client ?? null
          this.state.transport = transport ?? null

          if (lastError.message.includes('registration') || lastError.message.includes('client_id')) {
            this.updateStatus('needs_registration', 'Server requires pre-registered client ID')
          } else {
            this.state.authUrl = capturedAuthUrl
            this.updateStatus('needs_auth')
          }
          return
        }

        logger.mcp?.warn(`[MCP:${config.id}] ${name} transport failed [${lastError.constructor.name}]: ${lastError.message}`)

        // 若 StreamableHTTP 触发了 OAuth 重定向 URL（说明服务器有响应且需要认证），
        // 不要继续 fallback 到 SSE，直接标记为 needs_auth
        if (name === 'StreamableHTTP' && capturedAuthUrl) {
          logger.mcp?.info(`[MCP:${config.id}] OAuth URL captured, marking as needs_auth`)
          this.state.client = client ?? null
          this.state.transport = transport ?? null
          this.state.authUrl = capturedAuthUrl
          this.updateStatus('needs_auth')
          return
        }

        // 若 StreamableHTTP 报的是 OAuth/认证相关的错误（但未到 redirect 阶段），
        // 也不应 fallback 到 SSE
        // 若 OAuth 已禁用（使用 header 认证），StreamableHTTP 失败即终止，不 fallback 到 SSE
        // StreamableHTTPError 表示服务器已响应（只是返回了 4xx），SSE 无法解决认证问题
        if (name === 'StreamableHTTP' && oauthDisabled) {
          const errMsg = lastError.message.toLowerCase()
          const isCredentialError = errMsg.includes('unauthorized') || errMsg.includes('forbidden') ||
            errMsg.includes('401') || errMsg.includes('403')
          const errorDetail = isCredentialError
            ? 'Access token invalid or missing — check your credentials'
            : lastError.message
          logger.mcp?.warn(`[MCP:${config.id}] OAuth disabled, stopping after StreamableHTTP failure`)
          this.updateStatus('error', errorDetail)
          return
        }

        const isOAuthSetupError = lastError.message.includes('client registration') ||
          lastError.message.includes('Protected Resource') ||
          lastError.message.includes('auth server') ||
          lastError.message.includes('OAuth') ||
          lastError.message.includes('registration_endpoint')
        if (name === 'StreamableHTTP' && isOAuthSetupError) {
          logger.mcp?.warn(`[MCP:${config.id}] OAuth setup error, skipping SSE fallback`)
          this.state.client = client ?? null
          this.state.transport = transport ?? null
          this.updateStatus('needs_registration', lastError.message)
          return
        }
      }
    }

    throw lastError || new Error('All transports failed')
  }

  /** 断开连接 */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempts = 0

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

    // 显式关闭 transport 确保子进程被终止
    if (this.state.transport) {
      if (this.state.transport instanceof StdioClientTransport) {
        try {
          // StdioClientTransport 的 _process 是私有的，但我们可以通过这种方式获取
          // @ts-ignore
          const subProcess = this.state.transport._process
          if (subProcess && subProcess.pid) {
            logger.mcp?.info(`[MCP:${this.id}] Force killing process tree for PID ${subProcess.pid}`)
            if (process.platform === 'win32') {
              // Windows: 使用 taskkill /F /T 杀死整个进程树
              cp.execSync(`taskkill /F /T /PID ${subProcess.pid}`, { stdio: 'ignore' })
            } else {
              subProcess.kill('SIGKILL')
            }
          }
        } catch (err) {
          logger.mcp?.warn(`[MCP:${this.id}] Force kill error:`, err)
        }
      }

      try {
        await this.state.transport.close()
      } catch {
        // ignore close errors
      }
      this.state.transport = null
    }

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

  /** 指数退避自动重连 */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.mcp?.warn(`[MCP:${this.id}] Max reconnect attempts reached (${this.maxReconnectAttempts})`)
      return
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000) // 1s, 2s, 4s, 8s, 16s, max 60s
    this.reconnectAttempts++

    logger.mcp?.info(`[MCP:${this.id}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect()
        this.reconnectAttempts = 0 // 成功后重置
      } catch (err) {
        logger.mcp?.error(`[MCP:${this.id}] Reconnect failed:`, err)
        this.scheduleReconnect() // 继续尝试
      }
    }, delay)
  }

  private registerNotificationHandlers(client: Client): void {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      logger.mcp?.info(`[MCP:${this.id}] Tools list changed`)
      await this.refreshCapabilities().catch(() => { })
    })

    client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
      logger.mcp?.info(`[MCP:${this.id}] Resources list changed`)
      await this.refreshCapabilities().catch(() => { })
    })

    client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
      logger.mcp?.info(`[MCP:${this.id}] Prompts list changed`)
      await this.refreshCapabilities().catch(() => { })
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
    let timer: ReturnType<typeof setTimeout>
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timeout')), ms)
      }),
    ]).finally(() => clearTimeout(timer!))
  }
}
