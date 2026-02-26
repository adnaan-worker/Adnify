/**
 * MCP OAuth 认证存储
 * 持久化存储 OAuth tokens 和客户端信息
 * 
 * 改进：
 * - 使用 fs.promises 异步 IO，不阻塞主进程
 * - 原子写入（写临时文件 + rename），防止写入中断导致数据损坏
 * - 读写锁防止并发 read-modify-write 竞态
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { logger } from '@shared/utils/Logger'

export interface McpAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
}

export interface McpAuthClientInfo {
  clientId: string
  clientSecret?: string
  clientIdIssuedAt?: number
  clientSecretExpiresAt?: number
}

export interface McpAuthEntry {
  tokens?: McpAuthTokens
  clientInfo?: McpAuthClientInfo
  codeVerifier?: string
  oauthState?: string
  serverUrl?: string
}

// ============ 原子写入 + 读写锁 ============

/**
 * 原子写入：先写临时文件再 rename，防止写入中途断电/崩溃导致数据损坏
 */
async function atomicWrite(filepath: string, data: string): Promise<void> {
  const tmpPath = `${filepath}.${process.pid}.tmp`
  await fs.promises.writeFile(tmpPath, data, { mode: 0o600 })
  await fs.promises.rename(tmpPath, filepath)
}

/**
 * 简单的 Promise 链锁，保证串行执行
 */
let writeLock: Promise<void> = Promise.resolve()

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock
  let resolve: () => void
  writeLock = new Promise(r => { resolve = r! })
  return prev.then(fn).finally(() => resolve())
}

// ============ McpAuthStore ============

export namespace McpAuthStore {
  const getFilePath = () => path.join(app.getPath('userData'), 'mcp-auth.json')

  export async function get(mcpName: string): Promise<McpAuthEntry | undefined> {
    const data = await all()
    return data[mcpName]
  }

  export async function getForUrl(mcpName: string, serverUrl: string): Promise<McpAuthEntry | undefined> {
    const entry = await get(mcpName)
    if (!entry) return undefined
    if (!entry.serverUrl) return undefined
    if (entry.serverUrl !== serverUrl) return undefined
    return entry
  }

  export async function all(): Promise<Record<string, McpAuthEntry>> {
    try {
      const filepath = getFilePath()
      try {
        await fs.promises.access(filepath, fs.constants.F_OK)
      } catch {
        return {}
      }
      const content = await fs.promises.readFile(filepath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return {}
    }
  }

  export async function set(mcpName: string, entry: McpAuthEntry, serverUrl?: string): Promise<void> {
    await withLock(async () => {
      try {
        const filepath = getFilePath()
        const data = await all()
        if (serverUrl) {
          entry.serverUrl = serverUrl
        }
        data[mcpName] = entry
        await atomicWrite(filepath, JSON.stringify(data, null, 2))
      } catch (err) {
        logger.mcp?.error('[McpAuthStore] Failed to save:', err)
      }
    })
  }

  export async function remove(mcpName: string): Promise<void> {
    await withLock(async () => {
      try {
        const filepath = getFilePath()
        const data = await all()
        delete data[mcpName]
        await atomicWrite(filepath, JSON.stringify(data, null, 2))
      } catch (err) {
        logger.mcp?.error('[McpAuthStore] Failed to remove:', err)
      }
    })
  }

  export async function updateTokens(
    mcpName: string,
    tokens: McpAuthTokens,
    serverUrl?: string
  ): Promise<void> {
    const entry = (await get(mcpName)) ?? {}
    entry.tokens = tokens
    await set(mcpName, entry, serverUrl)
  }

  export async function updateClientInfo(
    mcpName: string,
    clientInfo: McpAuthClientInfo,
    serverUrl?: string
  ): Promise<void> {
    const entry = (await get(mcpName)) ?? {}
    entry.clientInfo = clientInfo
    await set(mcpName, entry, serverUrl)
  }

  export async function updateCodeVerifier(mcpName: string, codeVerifier: string): Promise<void> {
    const entry = (await get(mcpName)) ?? {}
    entry.codeVerifier = codeVerifier
    await set(mcpName, entry)
  }

  export async function clearCodeVerifier(mcpName: string): Promise<void> {
    const entry = await get(mcpName)
    if (entry) {
      delete entry.codeVerifier
      await set(mcpName, entry)
    }
  }

  export async function updateOAuthState(mcpName: string, oauthState: string): Promise<void> {
    const entry = (await get(mcpName)) ?? {}
    entry.oauthState = oauthState
    await set(mcpName, entry)
  }

  export async function getOAuthState(mcpName: string): Promise<string | undefined> {
    const entry = await get(mcpName)
    return entry?.oauthState
  }

  export async function clearOAuthState(mcpName: string): Promise<void> {
    const entry = await get(mcpName)
    if (entry) {
      delete entry.oauthState
      await set(mcpName, entry)
    }
  }

  export async function isTokenExpired(mcpName: string): Promise<boolean | null> {
    const entry = await get(mcpName)
    if (!entry?.tokens) return null
    if (!entry.tokens.expiresAt) return false
    return entry.tokens.expiresAt < Date.now()
  }
}
