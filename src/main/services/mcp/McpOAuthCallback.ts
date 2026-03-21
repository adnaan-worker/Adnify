/**
 * MCP OAuth 回调服务器
 * 本地 HTTP 服务器接收 OAuth 授权回调
 * 支持动态端口分配，避免端口冲突
 */

import * as http from 'http'
import * as net from 'net'
import { logger } from '@shared/utils/Logger'
import { 
  OAUTH_CALLBACK_PORT_START, 
  OAUTH_CALLBACK_PORT_END, 
  OAUTH_CALLBACK_PATH,
  setOAuthCallbackPort,
} from './McpOAuthProvider'

const HTML_SUCCESS = `<!DOCTYPE html>
<html>
<head>
  <title>Adnify - Authorization Successful</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #4ade80; margin-bottom: 1rem; }
    p { color: #aaa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Successful</h1>
    <p>You can close this window and return to Adnify.</p>
  </div>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const HTML_ERROR = (error: string) => `<!DOCTYPE html>
<html>
<head>
  <title>Adnify - Authorization Failed</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #f87171; margin-bottom: 1rem; }
    p { color: #aaa; }
    .error { color: #fca5a5; font-family: monospace; margin-top: 1rem; padding: 1rem; background: rgba(248,113,113,0.1); border-radius: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Failed</h1>
    <p>An error occurred during authorization.</p>
    <div class="error">${escapeHtml(error)}</div>
  </div>
</body>
</html>`

interface PendingAuth {
  resolve: (code: string) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export namespace McpOAuthCallback {
  let server: http.Server | undefined
  let currentPort: number | undefined
  const pendingAuths = new Map<string, PendingAuth>()
  const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

  /** 检查端口是否可用 */
  function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = net.createServer()
        .once('error', () => resolve(false))
        .once('listening', () => {
          tester.close(() => resolve(true))
        })
        .listen(port, '127.0.0.1')
    })
  }

  /** 查找可用端口 */
  async function findAvailablePort(): Promise<number> {
    for (let port = OAUTH_CALLBACK_PORT_START; port <= OAUTH_CALLBACK_PORT_END; port++) {
      if (await isPortAvailable(port)) {
        return port
      }
    }
    throw new Error(`No available port in range ${OAUTH_CALLBACK_PORT_START}-${OAUTH_CALLBACK_PORT_END}`)
  }

  export async function ensureRunning(retryCount = 0): Promise<number> {
    if (server && currentPort) {
      return currentPort
    }

    if (retryCount >= 3) {
      throw new Error('Failed to start OAuth callback server after 3 retries')
    }

    const port = await findAvailablePort()

    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)

        if (url.pathname !== OAUTH_CALLBACK_PATH) {
          res.writeHead(404)
          res.end('Not found')
          return
        }

        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')
        const errorDescription = url.searchParams.get('error_description')

        logger.mcp?.info('[OAuth Callback] Received', { hasCode: !!code, state, error })

        // 必须有 state 参数
        if (!state) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(HTML_ERROR('Missing required state parameter'))
          return
        }

        if (error) {
          const errorMsg = errorDescription || error
          const pending = pendingAuths.get(state)
          if (pending) {
            clearTimeout(pending.timeout)
            pendingAuths.delete(state)
            pending.reject(new Error(errorMsg))
          }
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(HTML_ERROR(errorMsg))
          return
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(HTML_ERROR('No authorization code provided'))
          return
        }

        // 验证 state
        const pending = pendingAuths.get(state)
        if (!pending) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(HTML_ERROR('Invalid or expired state parameter'))
          return
        }

        clearTimeout(pending.timeout)
        pendingAuths.delete(state)
        pending.resolve(code)

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(HTML_SUCCESS)
      })

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          logger.mcp?.warn(`[OAuth Callback] Port ${port} in use, trying next...`)
          server = undefined
          // 递归尝试下一个端口（带重试限制）
          ensureRunning(retryCount + 1).then(resolve).catch(reject)
        } else {
          reject(err)
        }
      })

      server.listen(port, '127.0.0.1', () => {
        currentPort = port
        setOAuthCallbackPort(port)
        logger.mcp?.info(`[OAuth Callback] Server started on port ${port}`)
        resolve(port)
      })
    })
  }

  /** 获取当前运行的端口 */
  export function getPort(): number | undefined {
    return currentPort
  }

  export function waitForCallback(oauthState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (pendingAuths.has(oauthState)) {
          pendingAuths.delete(oauthState)
          reject(new Error('OAuth callback timeout'))
        }
      }, CALLBACK_TIMEOUT_MS)

      pendingAuths.set(oauthState, { resolve, reject, timeout })
    })
  }

  export function cancelPending(state: string): void {
    const pending = pendingAuths.get(state)
    if (pending) {
      clearTimeout(pending.timeout)
      pendingAuths.delete(state)
      pending.reject(new Error('Authorization cancelled'))
    }
  }

  export async function stop(): Promise<void> {
    if (server) {
      server.close()
      server = undefined
      currentPort = undefined
      setOAuthCallbackPort(OAUTH_CALLBACK_PORT_START) // 重置为默认端口
      logger.mcp?.info('[OAuth Callback] Server stopped')
    }

    for (const [, pending] of pendingAuths) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('OAuth callback server stopped'))
    }
    pendingAuths.clear()
  }

  export function isRunning(): boolean {
    return server !== undefined
  }
}
