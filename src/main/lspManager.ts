/**
 * 内置 LSP 管理器
 * 
 * 支持的语言（全部内置，无需用户安装）:
 * - TypeScript/JavaScript: typescript-language-server (内置)
 * - HTML/CSS/JSON: vscode-langservers-extracted (内置)
 */

import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { BrowserWindow, app } from 'electron'

// ============ 类型定义 ============

export type LanguageId =
  | 'typescript' | 'typescriptreact' | 'javascript' | 'javascriptreact'
  | 'html' | 'css' | 'scss' | 'less' | 'json' | 'jsonc'

interface LspServerConfig {
  name: string
  languages: LanguageId[]
  getCommand: () => { command: string; args: string[] } | null
}

interface LspServerInstance {
  config: LspServerConfig
  process: ChildProcess | null
  requestId: number
  pendingRequests: Map<number, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }>
  buffer: Buffer
  contentLength: number
  initialized: boolean
  workspacePath: string | null
}

// ============ 辅助函数 ============

/**
 * 查找模块路径（支持开发和生产环境）
 */
function findModulePath(moduleName: string, subPath: string): string | null {
  const possiblePaths = [
    // 开发环境 - 项目 node_modules
    path.join(process.cwd(), 'node_modules', moduleName, subPath),
    // 开发环境 - 相对于 __dirname
    path.join(__dirname, '..', '..', 'node_modules', moduleName, subPath),
    // 生产环境 - app.asar
    path.join(app.getAppPath(), 'node_modules', moduleName, subPath),
    // 生产环境 - resources
    path.join(process.resourcesPath || '', 'app.asar', 'node_modules', moduleName, subPath),
    path.join(process.resourcesPath || '', 'app', 'node_modules', moduleName, subPath),
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p
    }
  }
  return null
}

/**
 * 获取 TypeScript 语言服务器命令
 */
function getTypeScriptServerCommand(): { command: string; args: string[] } | null {
  // 尝试找到 typescript-language-server
  const serverPath = findModulePath('typescript-language-server', 'lib/cli.mjs')
    || findModulePath('typescript-language-server', 'lib/cli.js')

  if (serverPath) {
    return { command: process.execPath, args: [serverPath, '--stdio'] }
  }

  console.error('[LSP] typescript-language-server not found')
  return null
}

/**
 * 获取 HTML 语言服务器命令
 */
function getHtmlServerCommand(): { command: string; args: string[] } | null {
  // 优先查找 .js 文件（跨平台兼容）
  const jsPath = findModulePath('vscode-langservers-extracted', 'bin/vscode-html-language-server.js')
  if (jsPath) {
    return { command: process.execPath, args: [jsPath, '--stdio'] }
  }

  const serverPath = findModulePath('vscode-langservers-extracted', 'bin/vscode-html-language-server')
  if (serverPath) {
    // Windows 上使用 node 执行
    if (process.platform === 'win32') {
      return { command: process.execPath, args: [serverPath, '--stdio'] }
    }
    return { command: serverPath, args: ['--stdio'] }
  }

  console.error('[LSP] vscode-html-language-server not found')
  return null
}

/**
 * 获取 CSS 语言服务器命令
 */
function getCssServerCommand(): { command: string; args: string[] } | null {
  const jsPath = findModulePath('vscode-langservers-extracted', 'bin/vscode-css-language-server.js')
  if (jsPath) {
    return { command: process.execPath, args: [jsPath, '--stdio'] }
  }

  const serverPath = findModulePath('vscode-langservers-extracted', 'bin/vscode-css-language-server')
  if (serverPath) {
    if (process.platform === 'win32') {
      return { command: process.execPath, args: [serverPath, '--stdio'] }
    }
    return { command: serverPath, args: ['--stdio'] }
  }

  console.error('[LSP] vscode-css-language-server not found')
  return null
}

/**
 * 获取 JSON 语言服务器命令
 */
function getJsonServerCommand(): { command: string; args: string[] } | null {
  const jsPath = findModulePath('vscode-langservers-extracted', 'bin/vscode-json-language-server.js')
  if (jsPath) {
    return { command: process.execPath, args: [jsPath, '--stdio'] }
  }

  const serverPath = findModulePath('vscode-langservers-extracted', 'bin/vscode-json-language-server')
  if (serverPath) {
    if (process.platform === 'win32') {
      return { command: process.execPath, args: [serverPath, '--stdio'] }
    }
    return { command: serverPath, args: ['--stdio'] }
  }

  console.error('[LSP] vscode-json-language-server not found')
  return null
}

// ============ 服务器配置 ============

const LSP_SERVERS: LspServerConfig[] = [
  {
    name: 'typescript',
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    getCommand: getTypeScriptServerCommand,
  },
  {
    name: 'html',
    languages: ['html'],
    getCommand: getHtmlServerCommand,
  },
  {
    name: 'css',
    languages: ['css', 'scss', 'less'],
    getCommand: getCssServerCommand,
  },
  {
    name: 'json',
    languages: ['json', 'jsonc'],
    getCommand: getJsonServerCommand,
  },
]

// ============ LSP 管理器 ============

class LspManager {
  private servers: Map<string, LspServerInstance> = new Map()
  private languageToServer: Map<LanguageId, string> = new Map()
  private documentVersions: Map<string, number> = new Map()
  private diagnosticsCache: Map<string, any[]> = new Map()
  private startingServers: Set<string> = new Set()
  private currentWorkspacePath: string | null = null

  constructor() {
    for (const config of LSP_SERVERS) {
      for (const lang of config.languages) {
        this.languageToServer.set(lang, config.name)
      }
    }
  }

  /**
   * 获取语言对应的服务器名称
   */
  getServerForLanguage(languageId: LanguageId): string | undefined {
    return this.languageToServer.get(languageId)
  }

  /**
   * 启动服务器
   */
  async startServer(serverName: string, workspacePath: string): Promise<boolean> {
    const existing = this.servers.get(serverName)
    if (existing?.process && existing.initialized && existing.workspacePath === workspacePath) {
      return true
    }

    if (this.startingServers.has(serverName)) {
      await new Promise(resolve => setTimeout(resolve, 200))
      return this.servers.get(serverName)?.initialized || false
    }

    if (existing?.process) {
      await this.stopServer(serverName)
    }

    const config = LSP_SERVERS.find(c => c.name === serverName)
    if (!config) {
      console.error(`[LSP] Unknown server: ${serverName}`)
      return false
    }

    this.startingServers.add(serverName)
    try {
      return await this.spawnServer(config, workspacePath)
    } finally {
      this.startingServers.delete(serverName)
    }
  }

  /**
   * 启动服务器进程
   */
  private async spawnServer(config: LspServerConfig, workspacePath: string): Promise<boolean> {
    const cmdInfo = config.getCommand()
    if (!cmdInfo) {
      console.error(`[LSP] Cannot get command for ${config.name}`)
      return false
    }

    const { command, args } = cmdInfo
    console.log(`[LSP] Starting ${config.name}: ${command} ${args.join(' ')}`)

    const proc = spawn(command, args, {
      cwd: workspacePath,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (!proc.stdout || !proc.stdin) {
      console.error(`[LSP] Failed to create pipes for ${config.name}`)
      return false
    }

    const instance: LspServerInstance = {
      config,
      process: proc,
      requestId: 0,
      pendingRequests: new Map(),
      buffer: Buffer.alloc(0),
      contentLength: -1,
      initialized: false,
      workspacePath,
    }

    this.servers.set(config.name, instance)

    proc.stdout.on('data', (data: Buffer) => {
      this.handleServerOutput(config.name, data)
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg && !msg.includes('Unexpected resource')) {
        console.warn(`[LSP ${config.name}]`, msg)
      }
    })

    proc.on('close', (code) => {
      console.log(`[LSP ${config.name}] Closed with code: ${code}`)
      const inst = this.servers.get(config.name)
      if (inst) {
        inst.process = null
        inst.initialized = false
      }
    })

    proc.on('error', (err) => {
      console.error(`[LSP ${config.name}] Error:`, err.message)
      this.servers.delete(config.name)
    })

    // 等待进程 stdout 可用
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Process stdout not ready')), 5000)
      if (proc.stdout?.readable) {
        clearTimeout(timeout)
        resolve()
      } else {
        proc.stdout?.once('readable', () => {
          clearTimeout(timeout)
          resolve()
        })
      }
    }).catch(() => {
      // 即使 stdout 检查失败也继续尝试初始化
      console.warn(`[LSP ${config.name}] stdout ready check skipped`)
    })

    try {
      await this.initializeServer(config.name, workspacePath)
      instance.initialized = true
      this.currentWorkspacePath = workspacePath
      console.log(`[LSP ${config.name}] Initialized`)
      return true
    } catch (error: any) {
      console.error(`[LSP ${config.name}] Init failed:`, error.message)
      this.stopServer(config.name)
      return false
    }
  }

  /**
   * 处理服务器输出（使用 Buffer 正确处理字节）
   */
  private handleServerOutput(serverName: string, data: Buffer): void {
    const instance = this.servers.get(serverName)
    if (!instance) return

    instance.buffer = Buffer.concat([instance.buffer, data])

    while (true) {
      if (instance.contentLength === -1) {
        const headerEnd = instance.buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return

        const header = instance.buffer.slice(0, headerEnd).toString('utf8')
        const match = header.match(/Content-Length:\s*(\d+)/i)
        if (match) {
          instance.contentLength = parseInt(match[1], 10)
          instance.buffer = instance.buffer.slice(headerEnd + 4)
        } else {
          instance.buffer = instance.buffer.slice(headerEnd + 4)
          continue
        }
      }

      if (instance.contentLength === -1) return
      if (instance.buffer.length < instance.contentLength) return

      const message = instance.buffer.slice(0, instance.contentLength).toString('utf8')
      instance.buffer = instance.buffer.slice(instance.contentLength)
      instance.contentLength = -1

      try {
        this.handleServerMessage(serverName, JSON.parse(message))
      } catch {
        // 忽略解析错误
      }
    }
  }

  /**
   * 处理服务器消息
   */
  private handleServerMessage(serverName: string, message: any): void {
    const instance = this.servers.get(serverName)
    if (!instance) return

    if (message.id !== undefined && instance.pendingRequests.has(message.id)) {
      const { resolve, reject, timeout } = instance.pendingRequests.get(message.id)!
      instance.pendingRequests.delete(message.id)
      clearTimeout(timeout)

      if (message.error) {
        reject(message.error)
      } else {
        resolve(message.result)
      }
    } else if (message.method) {
      this.handleNotification(serverName, message)
    }
  }

  /**
   * 处理通知
   */
  private handleNotification(serverName: string, message: any): void {
    if (message.method === 'textDocument/publishDiagnostics') {
      const { uri, diagnostics } = message.params
      this.diagnosticsCache.set(uri, diagnostics)

      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('lsp:diagnostics', { ...message.params, serverName })
      })
    }
  }

  /**
   * 发送请求
   */
  sendRequest(serverName: string, method: string, params: any, timeoutMs = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const instance = this.servers.get(serverName)
      if (!instance?.process?.stdin) {
        reject(new Error(`Server ${serverName} not running`))
        return
      }

      const id = ++instance.requestId
      const timeout = setTimeout(() => {
        instance.pendingRequests.delete(id)
        reject(new Error(`Request ${method} timed out`))
      }, timeoutMs)

      instance.pendingRequests.set(id, { resolve, reject, timeout })

      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
      instance.process.stdin.write(message)
    })
  }

  /**
   * 发送通知
   */
  sendNotification(serverName: string, method: string, params: any): void {
    const instance = this.servers.get(serverName)
    if (!instance?.process?.stdin) return

    const body = JSON.stringify({ jsonrpc: '2.0', method, params })
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
    instance.process.stdin.write(message)
  }

  /**
   * 初始化服务器
   */
  private async initializeServer(serverName: string, workspacePath: string): Promise<void> {
    const normalizedPath = workspacePath.replace(/\\/g, '/')
    const rootUri = /^[a-zA-Z]:/.test(normalizedPath)
      ? `file:///${normalizedPath}`
      : `file://${normalizedPath}`

    // 等待进程就绪（给进程一点启动时间）
    await new Promise(resolve => setTimeout(resolve, 100))

    // 使用更长的超时时间进行初始化（TypeScript 服务器可能需要较长时间）
    const initTimeout = serverName === 'typescript' ? 60000 : 45000
    
    await this.sendRequest(serverName, 'initialize', {
      processId: process.pid,
      rootUri,
      capabilities: this.getClientCapabilities(),
      workspaceFolders: [{ uri: rootUri, name: path.basename(workspacePath) }],
    }, initTimeout)

    this.sendNotification(serverName, 'initialized', {})
  }

  /**
   * 客户端能力
   */
  private getClientCapabilities(): any {
    return {
      textDocument: {
        synchronization: { openClose: true, change: 2, save: { includeText: true } },
        completion: {
          completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] },
          contextSupport: true,
        },
        hover: { contentFormat: ['markdown', 'plaintext'] },
        signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
        definition: { linkSupport: true },
        typeDefinition: { linkSupport: true },
        implementation: { linkSupport: true },
        references: {},
        documentHighlight: {},
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] } } },
        formatting: {},
        rangeFormatting: {},
        rename: { prepareSupport: true },
        foldingRange: {},
        publishDiagnostics: { relatedInformation: true },
      },
      workspace: {
        workspaceFolders: true,
        applyEdit: true,
        configuration: true,
      },
    }
  }

  /**
   * 停止服务器
   */
  async stopServer(serverName: string): Promise<void> {
    const instance = this.servers.get(serverName)
    if (!instance?.process) return

    try {
      await this.sendRequest(serverName, 'shutdown', null, 3000)
      this.sendNotification(serverName, 'exit', null)
    } catch {}

    instance.process.kill()
    this.servers.delete(serverName)
    console.log(`[LSP ${serverName}] Stopped`)
  }

  /**
   * 停止所有服务器
   */
  async stopAllServers(): Promise<void> {
    await Promise.all(Array.from(this.servers.keys()).map(name => this.stopServer(name)))
  }

  /**
   * 确保语言对应的服务器运行
   */
  async ensureServerForLanguage(languageId: LanguageId, workspacePath: string): Promise<string | null> {
    const serverName = this.getServerForLanguage(languageId)
    if (!serverName) return null

    const success = await this.startServer(serverName, workspacePath)
    return success ? serverName : null
  }

  /**
   * 获取运行中的服务器
   */
  getRunningServers(): string[] {
    return Array.from(this.servers.entries())
      .filter(([_, inst]) => inst.initialized)
      .map(([name]) => name)
  }

  /**
   * 获取诊断信息
   */
  getDiagnostics(uri: string): any[] {
    return this.diagnosticsCache.get(uri) || []
  }

  /**
   * 获取文档版本
   */
  getDocumentVersion(uri: string): number {
    return this.documentVersions.get(uri) || 0
  }

  /**
   * 增加文档版本
   */
  incrementDocumentVersion(uri: string): number {
    const version = (this.documentVersions.get(uri) || 0) + 1
    this.documentVersions.set(uri, version)
    return version
  }
}

export const lspManager = new LspManager()
