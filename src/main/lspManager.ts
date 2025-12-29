/**
 * 内置 LSP 管理器
 * 支持多根目录工作区（为每个根目录启动独立的服务器实例）
 */

import { logger } from '@shared/utils/Logger'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { BrowserWindow, app } from 'electron'

// ============ 类型定义 ============

export type LanguageId =
  | 'typescript' | 'typescriptreact' | 'javascript' | 'javascriptreact'
  | 'html' | 'css' | 'scss' | 'less' | 'json' | 'jsonc'
  | 'python'  // 添加 Python 支持

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
  workspacePath: string
  // 自动重启相关
  crashCount: number
  lastCrashTime: number
}

// ============ 辅助函数 ============

function findModulePath(moduleName: string, subPath: string): string | null {
  const possiblePaths = [
    path.join(process.cwd(), 'node_modules', moduleName, subPath),
    path.join(__dirname, '..', '..', 'node_modules', moduleName, subPath),
    path.join(app.getAppPath(), 'node_modules', moduleName, subPath),
    path.join(process.resourcesPath || '', 'app.asar', 'node_modules', moduleName, subPath),
    path.join(process.resourcesPath || '', 'app', 'node_modules', moduleName, subPath),
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function getTypeScriptServerCommand(): { command: string; args: string[] } | null {
  const serverPath = findModulePath('typescript-language-server', 'lib/cli.mjs')
    || findModulePath('typescript-language-server', 'lib/cli.js')
  logger.lsp.debug('[LSP Manager] TypeScript server path:', serverPath)
  // 使用 process.execPath 配合 ELECTRON_RUN_AS_NODE=1 环境变量
  if (serverPath) return { command: process.execPath, args: [serverPath, '--stdio'] }
  return null
}

function getHtmlServerCommand(): { command: string; args: string[] } | null {
  const jsPath = findModulePath('vscode-langservers-extracted', 'bin/vscode-html-language-server.js')
  if (jsPath) return { command: process.execPath, args: [jsPath, '--stdio'] }
  return null
}

function getCssServerCommand(): { command: string; args: string[] } | null {
  const jsPath = findModulePath('vscode-langservers-extracted', 'bin/vscode-css-language-server.js')
  if (jsPath) return { command: process.execPath, args: [jsPath, '--stdio'] }
  return null
}

function getJsonServerCommand(): { command: string; args: string[] } | null {
  const jsPath = findModulePath('vscode-langservers-extracted', 'bin/vscode-json-language-server.js')
  if (jsPath) return { command: process.execPath, args: [jsPath, '--stdio'] }
  return null
}

// Python LSP (pylsp)
function getPythonServerCommand(): { command: string; args: string[] } | null {
  // pylsp 通常通过 pip install python-lsp-server 安装
  // 尝试多个可能的路径
  const isWindows = process.platform === 'win32'
  const pylspNames = isWindows ? ['pylsp.exe', 'pylsp'] : ['pylsp']

  // 检查 PATH 中是否存在 pylsp
  for (const name of pylspNames) {
    try {
      // 尝试运行 pylsp --version 检查是否可用
      return { command: name, args: [] }
    } catch {
      continue
    }
  }
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
  {
    name: 'python',
    languages: ['python'],
    getCommand: getPythonServerCommand,
  },
]

// ============ LSP 管理器 ============

class LspManager {
  private servers: Map<string, LspServerInstance> = new Map() // key: serverName:workspacePath
  private languageToServer: Map<LanguageId, string> = new Map()
  private documentVersions: Map<string, number> = new Map() // 启用文档版本管理
  private diagnosticsCache: Map<string, any[]> = new Map()
  private startingServers: Set<string> = new Set()
  
  // 跟踪每个服务器打开的文档
  private serverOpenedDocuments: Map<string, Map<string, { languageId: string; version: number; text: string }>> = new Map()
  
  // 空闲关闭配置
  private serverLastActivity: Map<string, number> = new Map()
  private idleCheckInterval: NodeJS.Timeout | null = null
  private static readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 分钟无活动则关闭

  // 自动重启配置
  private static readonly MAX_CRASH_COUNT = 3
  private static readonly CRASH_COOLDOWN_MS = 5000

  constructor() {
    for (const config of LSP_SERVERS) {
      for (const lang of config.languages) {
        this.languageToServer.set(lang, config.name)
      }
    }
    
    // 启动空闲检查定时器
    this.startIdleCheck()
  }

  private startIdleCheck() {
    if (this.idleCheckInterval) return
    
    this.idleCheckInterval = setInterval(() => {
      const now = Date.now()
      for (const [key, lastActivity] of this.serverLastActivity) {
        if (now - lastActivity > LspManager.IDLE_TIMEOUT_MS) {
          const instance = this.servers.get(key)
          if (instance && instance.initialized) {
            logger.lsp.info(`[LSP ${key}] Stopping idle server (inactive for ${Math.round((now - lastActivity) / 1000)}s)`)
            this.stopServerByKey(key)
          }
        }
      }
    }, 60000) // 每分钟检查一次
  }

  private updateActivity(key: string) {
    this.serverLastActivity.set(key, Date.now())
  }

  private getInstanceKey(serverName: string, workspacePath: string): string {
    return `${serverName}:${workspacePath.replace(/\\/g, '/')}`
  }

  getServerForLanguage(languageId: LanguageId): string | undefined {
    return this.languageToServer.get(languageId)
  }

  async startServer(serverName: string, workspacePath: string): Promise<boolean> {
    const key = this.getInstanceKey(serverName, workspacePath)
    const existing = this.servers.get(key)

    if (existing?.process && existing.initialized) return true

    if (this.startingServers.has(key)) {
      await new Promise(resolve => setTimeout(resolve, 200))
      return this.servers.get(key)?.initialized || false
    }

    const config = LSP_SERVERS.find(c => c.name === serverName)
    if (!config) return false

    this.startingServers.add(key)
    try {
      return await this.spawnServer(config, workspacePath)
    } finally {
      this.startingServers.delete(key)
    }
  }

  private async spawnServer(config: LspServerConfig, workspacePath: string): Promise<boolean> {
    const cmdInfo = config.getCommand()
    if (!cmdInfo) return false

    const { command, args } = cmdInfo
    const key = this.getInstanceKey(config.name, workspacePath)

    // 使用 ELECTRON_RUN_AS_NODE=1 让 Electron 作为纯 Node.js 运行时工作
    const proc = spawn(command, args, {
      cwd: workspacePath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (!proc.stdout || !proc.stdin) return false

    const instance: LspServerInstance = {
      config,
      process: proc,
      requestId: 0,
      pendingRequests: new Map(),
      buffer: Buffer.alloc(0),
      contentLength: -1,
      initialized: false,
      workspacePath,
      crashCount: 0,
      lastCrashTime: 0,
    }

    this.servers.set(key, instance)

    logger.lsp.debug(`[LSP ${key}] Starting process: ${command} ${args.join(' ')}`)

    proc.on('error', (err) => {
      logger.lsp.error(`[LSP ${key}] Process spawn error:`, err.message)
    })

    proc.stdout.on('data', (data: Buffer) => this.handleServerOutput(key, data))
    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) logger.lsp.warn(`[LSP ${key}] STDERR:`, msg)
    })

    proc.on('close', (code) => {
      logger.lsp.debug(`[LSP ${key}] Closed with code: ${code}`)
      const inst = this.servers.get(key)
      this.servers.delete(key)

      // 自动重启逻辑
      if (code !== 0 && code !== null && inst) {
        const now = Date.now()
        // 检查是否在冷却时间内
        if (now - inst.lastCrashTime > LspManager.CRASH_COOLDOWN_MS) {
          inst.crashCount = 0 // 重置崩溃计数
        }
        inst.crashCount++
        inst.lastCrashTime = now

        if (inst.crashCount <= LspManager.MAX_CRASH_COUNT) {
          logger.lsp.warn(`[LSP ${key}] Server crashed, attempting restart (${inst.crashCount}/${LspManager.MAX_CRASH_COUNT})...`)
          setTimeout(() => {
            this.startServer(inst.config.name, inst.workspacePath).catch(console.error)
          }, 1000)
        } else {
          logger.lsp.error(`[LSP ${key}] Server crashed too many times, giving up`)
        }
      }
    })

    proc.stdin.on('error', (err) => logger.lsp.warn(`[LSP ${key}] stdin error:`, err.message))

    try {
      await this.initializeServer(key, workspacePath)
      instance.initialized = true
      logger.lsp.debug(`[LSP ${key}] Initialized successfully`)
      return true
    } catch (error: any) {
      logger.lsp.error(`[LSP ${key}] Init failed:`, error.message)
      this.stopServerByKey(key)
      return false
    }
  }

  private handleServerOutput(key: string, data: Buffer): void {
    const instance = this.servers.get(key)
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

      if (instance.contentLength === -1 || instance.buffer.length < instance.contentLength) return

      const message = instance.buffer.slice(0, instance.contentLength).toString('utf8')
      instance.buffer = instance.buffer.slice(instance.contentLength)
      instance.contentLength = -1

      try {
        this.handleServerMessage(key, JSON.parse(message))
      } catch { }
    }
  }

  private handleServerMessage(key: string, message: any): void {
    const instance = this.servers.get(key)
    if (!instance) return

    if (message.id !== undefined && instance.pendingRequests.has(message.id)) {
      const { resolve, reject, timeout } = instance.pendingRequests.get(message.id)!
      instance.pendingRequests.delete(message.id)
      clearTimeout(timeout)
      if (message.error) reject(message.error)
      else resolve(message.result)
    } else if (message.method) {
      this.handleNotification(key, message)
    }
  }

  private handleNotification(key: string, message: any): void {
    if (message.method === 'textDocument/publishDiagnostics') {
      const { uri, diagnostics } = message.params
      this.diagnosticsCache.set(uri, diagnostics)

      // 只在有诊断信息时记录日志
      if (diagnostics.length > 0) {
        logger.lsp.debug(`[LSP ${key}] Diagnostics: ${uri} (${diagnostics.length} items)`)
      }

      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          try {
            win.webContents.send('lsp:diagnostics', { ...message.params, serverKey: key })
          } catch { }
        }
      })
    }
    // 忽略其他通知类型的日志，太频繁了
  }

  sendRequest(key: string, method: string, params: any, timeoutMs = 30000): Promise<any> {
    // 更新活动时间
    this.updateActivity(key)
    
    return new Promise((resolve, reject) => {
      const instance = this.servers.get(key)
      if (!instance?.process?.stdin || !instance.process.stdin.writable) {
        reject(new Error(`Server ${key} not running`))
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

      try {
        instance.process.stdin.write(message)
      } catch (err: any) {
        instance.pendingRequests.delete(id)
        clearTimeout(timeout)
        reject(err)
      }
    })
  }

  sendNotification(key: string, method: string, params: any): void {
    // 更新活动时间
    this.updateActivity(key)
    
    const instance = this.servers.get(key)
    if (!instance?.process?.stdin || !instance.process.stdin.writable) return
    const body = JSON.stringify({ jsonrpc: '2.0', method, params })
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
    try { instance.process.stdin.write(message) } catch { }
  }

  private async initializeServer(key: string, workspacePath: string): Promise<void> {
    const normalizedPath = workspacePath.replace(/\\/g, '/')
    const rootUri = /^[a-zA-Z]:/.test(normalizedPath) ? `file:///${normalizedPath}` : `file://${normalizedPath}`

    await this.sendRequest(key, 'initialize', {
      processId: process.pid,
      rootUri,
      capabilities: this.getClientCapabilities(),
      workspaceFolders: [{ uri: rootUri, name: path.basename(workspacePath) }],
    }, 60000)

    this.sendNotification(key, 'initialized', {})
  }

  private getClientCapabilities(): any {
    return {
      textDocument: {
        synchronization: { openClose: true, change: 2, save: { includeText: true } },
        completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] }, contextSupport: true },
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
      workspace: { workspaceFolders: true, applyEdit: true, configuration: true },
    }
  }

  async stopServerByKey(key: string): Promise<void> {
    const instance = this.servers.get(key)
    if (!instance?.process) return
    
    // 清除该服务器相关的诊断缓存
    const workspaceUri = `file:///${instance.workspacePath.replace(/\\/g, '/')}`
    for (const uri of this.diagnosticsCache.keys()) {
      if (uri.startsWith(workspaceUri) || uri.startsWith(workspaceUri.replace('file:///', 'file://'))) {
        this.diagnosticsCache.delete(uri)
        // 通知前端清除诊断
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            try {
              win.webContents.send('lsp:diagnostics', { uri, diagnostics: [], serverKey: key })
            } catch { }
          }
        })
      }
    }
    
    // 清除文档跟踪（服务器关闭后文档状态无效）
    this.serverOpenedDocuments.delete(key)
    
    try {
      await this.sendRequest(key, 'shutdown', null, 3000)
      this.sendNotification(key, 'exit', null)
    } catch { }
    instance.process.kill()
    this.servers.delete(key)
    this.serverLastActivity.delete(key)
    
    logger.lsp.info(`[LSP ${key}] Server stopped and diagnostics cleared`)
  }

  async stopAllServers(): Promise<void> {
    // 停止空闲检查
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval)
      this.idleCheckInterval = null
    }
    await Promise.all(Array.from(this.servers.keys()).map(key => this.stopServerByKey(key)))
  }

  async ensureServerForLanguage(languageId: LanguageId, workspacePath: string): Promise<string | null> {
    const serverName = this.getServerForLanguage(languageId)
    if (!serverName) return null
    const success = await this.startServer(serverName, workspacePath)
    return success ? this.getInstanceKey(serverName, workspacePath) : null
  }

  getRunningServers(): string[] {
    return Array.from(this.servers.keys())
  }

  getDiagnostics(uri: string): any[] {
    return this.diagnosticsCache.get(uri) || []
  }

  // 文档版本管理
  getDocumentVersion(uri: string): number {
    return this.documentVersions.get(uri) || 0
  }

  incrementDocumentVersion(uri: string): number {
    const current = this.documentVersions.get(uri) || 0
    const next = current + 1
    this.documentVersions.set(uri, next)
    return next
  }

  resetDocumentVersion(uri: string): void {
    this.documentVersions.delete(uri)
  }

  // 跟踪文档打开状态
  trackDocumentOpen(serverKey: string, uri: string, languageId: string, version: number, text: string): void {
    if (!this.serverOpenedDocuments.has(serverKey)) {
      this.serverOpenedDocuments.set(serverKey, new Map())
    }
    this.serverOpenedDocuments.get(serverKey)!.set(uri, { languageId, version, text })
  }

  trackDocumentChange(serverKey: string, uri: string, version: number, text: string): void {
    const docs = this.serverOpenedDocuments.get(serverKey)
    if (docs?.has(uri)) {
      const doc = docs.get(uri)!
      doc.version = version
      doc.text = text
    }
  }

  trackDocumentClose(serverKey: string, uri: string): void {
    this.serverOpenedDocuments.get(serverKey)?.delete(uri)
  }

  // 检查文档是否已在服务器上打开
  isDocumentOpen(serverKey: string, uri: string): boolean {
    return this.serverOpenedDocuments.get(serverKey)?.has(uri) || false
  }

  // 获取服务器打开的所有文档（用于重启后恢复）
  getOpenedDocuments(serverKey: string): Map<string, { languageId: string; version: number; text: string }> | undefined {
    return this.serverOpenedDocuments.get(serverKey)
  }
}

export const lspManager = new LspManager()
