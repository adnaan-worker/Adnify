/**
 * MCP OAuth Provider
 * 实现官方 SDK 的 OAuthClientProvider 接口
 */

import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformation,
  OAuthClientInformationFull,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { logger } from '@shared/utils/Logger'
import { McpAuthStore } from './McpAuthStore'
import type { McpOAuthTokens } from '@shared/types/mcp'

/** OAuth 回调端口范围 */
export const OAUTH_CALLBACK_PORT_START = 19876
export const OAUTH_CALLBACK_PORT_END = 19886
export const OAUTH_CALLBACK_PATH = '/mcp/oauth/callback'

/** 当前使用的端口（动态分配） */
let currentCallbackPort: number | null = null

/** 获取当前回调端口 */
export function getOAuthCallbackPort(): number {
  return currentCallbackPort || OAUTH_CALLBACK_PORT_START
}

/** 设置当前回调端口 */
export function setOAuthCallbackPort(port: number): void {
  currentCallbackPort = port
}

export interface McpOAuthConfig {
  clientId?: string
  clientSecret?: string
  scope?: string
  onRedirect?: (url: URL) => void
}

export class McpOAuthProvider implements OAuthClientProvider {
  private _tokens?: McpOAuthTokens

  constructor(
    private mcpName: string,
    private serverUrl: string,
    private config: McpOAuthConfig
  ) {}

  get redirectUrl(): string {
    return `http://127.0.0.1:${getOAuthCallbackPort()}${OAUTH_CALLBACK_PATH}`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: 'Adnify',
      client_uri: 'https://github.com/adnaan-worker/adnify',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.config.clientSecret ? 'client_secret_post' : 'none',
    }
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    // 优先使用配置中的 clientId
    if (this.config.clientId) {
      return {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }
    }

    // 检查存储的客户端信息（动态注册）
    const entry = await McpAuthStore.getForUrl(this.mcpName, this.serverUrl)
    if (entry?.clientInfo) {
      // 检查 client secret 是否过期
      if (entry.clientInfo.clientSecretExpiresAt && entry.clientInfo.clientSecretExpiresAt < Date.now() / 1000) {
        logger.mcp?.info(`[OAuth:${this.mcpName}] Client secret expired, need re-registration`)
        return undefined
      }
      return {
        client_id: entry.clientInfo.clientId,
        client_secret: entry.clientInfo.clientSecret,
      }
    }

    return undefined
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await McpAuthStore.updateClientInfo(
      this.mcpName,
      {
        clientId: info.client_id,
        clientSecret: info.client_secret,
        clientIdIssuedAt: info.client_id_issued_at,
        clientSecretExpiresAt: info.client_secret_expires_at,
      },
      this.serverUrl
    )
    logger.mcp?.info(`[OAuth:${this.mcpName}] Saved dynamically registered client`)
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    // 优先使用内存中的 tokens
    if (this._tokens) {
      return {
        access_token: this._tokens.accessToken,
        token_type: this._tokens.tokenType || 'Bearer',
        refresh_token: this._tokens.refreshToken,
        expires_in: this._tokens.expiresAt
          ? Math.max(0, Math.floor(this._tokens.expiresAt / 1000 - Date.now() / 1000))
          : undefined,
        scope: this._tokens.scope,
      }
    }

    // 从存储加载
    const entry = await McpAuthStore.getForUrl(this.mcpName, this.serverUrl)
    if (!entry?.tokens) return undefined

    return {
      access_token: entry.tokens.accessToken,
      token_type: 'Bearer',
      refresh_token: entry.tokens.refreshToken,
      expires_in: entry.tokens.expiresAt
        ? Math.max(0, Math.floor(entry.tokens.expiresAt / 1000 - Date.now() / 1000))
        : undefined,
      scope: entry.tokens.scope,
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const mcpTokens: McpOAuthTokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      tokenType: tokens.token_type || 'Bearer',
      scope: tokens.scope,
    }

    this._tokens = mcpTokens
    await McpAuthStore.updateTokens(this.mcpName, mcpTokens, this.serverUrl)
    logger.mcp?.info(`[OAuth:${this.mcpName}] Saved tokens`)
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    logger.mcp?.info(`[OAuth:${this.mcpName}] Redirect to authorization: ${authorizationUrl}`)
    this.config.onRedirect?.(authorizationUrl)
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await McpAuthStore.updateCodeVerifier(this.mcpName, codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    const entry = await McpAuthStore.get(this.mcpName)
    if (!entry?.codeVerifier) {
      throw new Error(`No code verifier saved for MCP server: ${this.mcpName}`)
    }
    return entry.codeVerifier
  }

  async saveState(state: string): Promise<void> {
    await McpAuthStore.updateOAuthState(this.mcpName, state)
  }

  async state(): Promise<string> {
    const entry = await McpAuthStore.get(this.mcpName)
    if (!entry?.oauthState) {
      throw new Error(`No OAuth state saved for MCP server: ${this.mcpName}`)
    }
    return entry.oauthState
  }

  // =================== 额外方法 ===================

  setTokens(tokens: McpOAuthTokens): void {
    this._tokens = tokens
  }

  getTokens(): McpOAuthTokens | undefined {
    return this._tokens
  }

  isTokenExpired(): boolean {
    if (!this._tokens?.expiresAt) return false
    return Date.now() >= this._tokens.expiresAt
  }
}
