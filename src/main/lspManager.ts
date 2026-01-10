/**
 * 内置 LSP 管理器
 * 支持多根目录工作区（为每个根目录启动独立的服务器实例）
 * 
 * 增强功能：
 * - 智能根目录检测
 * - Call Hierarchy 支持
 * - waitForDiagnostics 机制
 * - 更多语言服务器支持
 * - 自动下载安装 LSP 服务器
 */

import { logger } from '@shared/utils/Logger'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { BrowserWindow } from 'electron'
import { LanguageId } from '@shared/languages'
import { LSP_DEFAULTS } from '@shared/config/defaults'
import { CacheService } from '@shared/utils/CacheService'
import { getCacheConfig } from '@shared/config/agentConfig'
import {
  getInstalledServerPath,
  commandExists,
} from './lsp/installer'

// 重新导出 LanguageId 供其他模块使用
export type { LanguageId } from '@shared/languages'

// ============ 类型定义 ============

interface LspServerConfig {
  name: string
  languages: LanguageId[]
  getCommand: () => Promise<{ command: string; args: string[] } | null>
  /** 智能根目录检测函数，返回 null 表示不应该使用此服务器 */
  findRoot?: (filePath: string, workspacePath: string) => Promise<string | null>
  /** 自动安装函数 */
  install?: () => Promise<{ success: boolean; path?: string; error?: string }>
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

// ============ 智能根目录检测辅助函数 ============

/**
 * 向上查找包含指定文件的目录
 */
async function findNearestRoot(
  startDir: string,
  stopDir: string,
  patterns: string[],
  excludePatterns?: string[]
): Promise<string | undefined> {
  let currentDir = startDir
  
  while (currentDir.length >= stopDir.length) {
    // 检查排除模式
    if (excludePatterns) {
      for (const pattern of excludePatterns) {
        const excludePath = path.join(currentDir, pattern)
        if (fs.existsSync(excludePath)) {
          return undefined // 被排除
        }
      }
    }
    
    // 检查目标模式
    for (const pattern of patterns) {
      const targetPath = path.join(currentDir, pattern)
      if (fs.existsSync(targetPath)) {
        return currentDir
      }
    }
    
    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }
  
  return undefined
}

// ============ 服务器命令获取函数 ============
// 使用 installer.ts 中的 getInstalledServerPath 统一查找路径

async function getTypeScriptServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('typescript')
  if (serverPath) {
    logger.lsp.debug('[LSP Manager] TypeScript server path:', serverPath)
    return { command: process.execPath, args: [serverPath, '--stdio'] }
  }
  return null
}

async function getHtmlServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('html')
  if (serverPath) return { command: process.execPath, args: [serverPath, '--stdio'] }
  return null
}

async function getCssServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('css')
  if (serverPath) return { command: process.execPath, args: [serverPath, '--stdio'] }
  return null
}

async function getJsonServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('json')
  if (serverPath) return { command: process.execPath, args: [serverPath, '--stdio'] }
  return null
}

// Python LSP (pyright)
async function getPythonServerCommand(): Promise<{ command: string; args: string[] } | null> {
  // 优先使用 pyright（通过 npm 安装）
  const serverPath = getInstalledServerPath('python')

  if (serverPath) {
    return { command: process.execPath, args: [serverPath, '--stdio'] }
  }

  // 检查系统是否有 pylsp
  if (commandExists('pylsp')) {
    return { command: 'pylsp', args: [] }
  }

  return null
}

// Go LSP (gopls)
async function getGoplsCommand(): Promise<{ command: string; args: string[] } | null> {
  // 检查已安装的 gopls
  const goplsPath = getInstalledServerPath('go')

  if (goplsPath) {
    return { command: goplsPath, args: [] }
  }

  // 检查系统 PATH
  if (commandExists('gopls')) {
    return { command: 'gopls', args: [] }
  }

  // 检查 GOPATH/bin
  const isWindows = process.platform === 'win32'
  const goplsName = isWindows ? 'gopls.exe' : 'gopls'
  const goPathBin = process.env.GOPATH ? path.join(process.env.GOPATH, 'bin', goplsName) : null

  if (goPathBin && fs.existsSync(goPathBin)) {
    return { command: goPathBin, args: [] }
  }

  return null
}

// Rust LSP (rust-analyzer)
async function getRustAnalyzerCommand(): Promise<{ command: string; args: string[] } | null> {
  if (commandExists('rust-analyzer')) {
    return { command: 'rust-analyzer', args: [] }
  }

  const isWindows = process.platform === 'win32'
  const raName = isWindows ? 'rust-analyzer.exe' : 'rust-analyzer'
  const cargoHome =
    process.env.CARGO_HOME || path.join(process.env.HOME || process.env.USERPROFILE || '', '.cargo')
  const raPath = path.join(cargoHome, 'bin', raName)

  if (fs.existsSync(raPath)) {
    return { command: raPath, args: [] }
  }

  return null
}

// C/C++ LSP (clangd)
async function getClangdCommand(): Promise<{ command: string; args: string[] } | null> {
  if (commandExists('clangd')) {
    return { command: 'clangd', args: ['--background-index', '--clang-tidy'] }
  }

  return null
}

// Vue LSP (vue-language-server)
async function getVueServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('vue')
  if (serverPath) return { command: process.execPath, args: [serverPath, '--stdio'] }

  // 尝试全局安装的 vue-language-server
  if (commandExists('vue-language-server')) {
    return { command: 'vue-language-server', args: ['--stdio'] }
  }
  
  return null
}

// Zig LSP (zls)
async function getZlsCommand(): Promise<{ command: string; args: string[] } | null> {
  const zlsPath = getInstalledServerPath('zig')
  if (zlsPath) return { command: zlsPath, args: [] }

  if (commandExists('zls')) {
    return { command: 'zls', args: [] }
  }

  return null
}

// C# LSP (csharp-ls)
async function getCsharpLsCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('csharp')
  if (serverPath) return { command: serverPath, args: [] }

  if (commandExists('csharp-ls')) {
    return { command: 'csharp-ls', args: [] }
  }

  return null
}

// Deno LSP
async function getDenoCommand(): Promise<{ command: string; args: string[] } | null> {
  if (commandExists('deno')) {
    return { command: 'deno', args: ['lsp'] }
  }

  return null
}

// ============ 服务器配置 ============

const LSP_SERVERS: LspServerConfig[] = [
  {
    name: 'typescript',
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    getCommand: getTypeScriptServerCommand,
    // 智能根目录检测：查找 package.json 或 lock 文件，排除 deno 项目
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['package-lock.json', 'bun.lockb', 'bun.lock', 'pnpm-lock.yaml', 'yarn.lock', 'package.json'],
        ['deno.json', 'deno.jsonc'] // 排除 Deno 项目
      )
      return root || workspacePath
    },
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
    // 智能根目录检测：查找 Python 项目配置文件
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile', 'pyrightconfig.json']
      )
      return root || workspacePath
    },
  },
  {
    name: 'go',
    languages: ['go'],
    getCommand: getGoplsCommand,
    // 智能根目录检测：优先查找 go.work，然后 go.mod
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      // 先查找 go.work（工作区模式）
      const workRoot = await findNearestRoot(fileDir, workspacePath, ['go.work'])
      if (workRoot) return workRoot
      // 再查找 go.mod
      const modRoot = await findNearestRoot(fileDir, workspacePath, ['go.mod', 'go.sum'])
      return modRoot || workspacePath
    },
  },
  {
    name: 'rust',
    languages: ['rust'],
    getCommand: getRustAnalyzerCommand,
    // 智能根目录检测：查找 Cargo.toml，优先查找 workspace
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const crateRoot = await findNearestRoot(fileDir, workspacePath, ['Cargo.toml', 'Cargo.lock'])
      if (!crateRoot) return workspacePath
      
      // 向上查找 workspace 根目录
      let currentDir = crateRoot
      while (currentDir.length >= workspacePath.length) {
        const cargoTomlPath = path.join(currentDir, 'Cargo.toml')
        if (fs.existsSync(cargoTomlPath)) {
          try {
            const content = fs.readFileSync(cargoTomlPath, 'utf-8')
            if (content.includes('[workspace]')) {
              return currentDir
            }
          } catch { }
        }
        const parentDir = path.dirname(currentDir)
        if (parentDir === currentDir) break
        currentDir = parentDir
      }
      
      return crateRoot
    },
  },
  {
    name: 'clangd',
    languages: ['cpp', 'c'],
    getCommand: getClangdCommand,
    // 智能根目录检测：查找编译数据库或构建配置
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['compile_commands.json', 'compile_flags.txt', '.clangd', 'CMakeLists.txt', 'Makefile']
      )
      return root || workspacePath
    },
  },
  {
    name: 'vue',
    languages: ['vue'],
    getCommand: getVueServerCommand,
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['package-lock.json', 'bun.lockb', 'bun.lock', 'pnpm-lock.yaml', 'yarn.lock', 'package.json']
      )
      return root || workspacePath
    },
  },
  {
    name: 'zig',
    languages: ['zig'],
    getCommand: getZlsCommand,
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(fileDir, workspacePath, ['build.zig', 'build.zig.zon'])
      return root || workspacePath
    },
  },
  {
    name: 'csharp',
    languages: ['csharp'],
    getCommand: getCsharpLsCommand,
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(fileDir, workspacePath, ['*.sln', '*.csproj'])
      return root || workspacePath
    },
  },
  {
    name: 'deno',
    languages: [], // 不注册为默认服务器，通过 findBestRoot 动态选择
    getCommand: getDenoCommand,
    // Deno 项目检测：查找 deno.json 或 deno.jsonc
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(fileDir, workspacePath, ['deno.json', 'deno.jsonc'])
      return root || null // 找不到 deno.json 返回 null，表示不应该使用 Deno LSP
    },
  },
]

// ============ LSP 管理器 ============

class LspManager {
  private servers: Map<string, LspServerInstance> = new Map() // key: serverName:workspacePath
  private languageToServer: Map<LanguageId, string> = new Map()
  private documentVersions: Map<string, number> = new Map() // 启用文档版本管理
  private diagnosticsCache: CacheService<any[]>
  private startingServers: Set<string> = new Set()
  
  // 跟踪每个服务器打开的文档
  private serverOpenedDocuments: Map<string, Map<string, { languageId: string; version: number; text: string }>> = new Map()
  
  // 空闲关闭配置
  private serverLastActivity: Map<string, number> = new Map()
  private idleCheckInterval: NodeJS.Timeout | null = null
  private static readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 分钟无活动则关闭

  // 自动重启配置
  private static readonly MAX_CRASH_COUNT = 3
  private static readonly CRASH_COOLDOWN_MS = LSP_DEFAULTS.crashCooldownMs

  // waitForDiagnostics 相关
  private diagnosticsWaiters: Map<string, { resolve: () => void; timeout: NodeJS.Timeout }[]> = new Map()
  private static readonly DIAGNOSTICS_DEBOUNCE_MS = 100
  private static readonly DIAGNOSTICS_TIMEOUT_MS = 3000

  constructor() {
    // 初始化诊断缓存
    const cacheConfig = getCacheConfig('lspDiagnostics')
    this.diagnosticsCache = new CacheService<any[]>('LspDiagnostics', {
      maxSize: cacheConfig.maxSize,
      defaultTTL: cacheConfig.ttlMs,
      evictionPolicy: cacheConfig.evictionPolicy || 'lru',
      cleanupInterval: cacheConfig.cleanupInterval || 0,
    })

    for (const config of LSP_SERVERS) {
      for (const lang of config.languages) {
        this.languageToServer.set(lang, config.name)
      }
    }
    
    // 启动空闲检查定时器
    this.startIdleCheck()
  }

  /**
   * 设置诊断缓存
   */
  private setDiagnosticsCache(uri: string, diagnostics: any[]): void {
    this.diagnosticsCache.set(uri, diagnostics)
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
    const cmdInfo = await config.getCommand()
    if (!cmdInfo) {
      logger.lsp.warn(`[LSP ${config.name}] No command available for server`)
      return false
    }

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

      // 自动重启逻辑（改进版）
      if (code !== 0 && code !== null && inst) {
        const now = Date.now()
        
        // 如果距离上次崩溃超过冷却时间，重置计数
        if (now - inst.lastCrashTime > LspManager.CRASH_COOLDOWN_MS) {
          inst.crashCount = 1
        } else {
          inst.crashCount++
        }
        inst.lastCrashTime = now

        // 只有在崩溃次数未超限时才重启
        if (inst.crashCount <= LspManager.MAX_CRASH_COUNT) {
          const delay = Math.min(1000 * inst.crashCount, 5000) // 递增延迟，最大 5 秒
          logger.lsp.warn(`[LSP ${key}] Server crashed (${inst.crashCount}/${LspManager.MAX_CRASH_COUNT}), restarting in ${delay}ms...`)
          
          setTimeout(() => {
            // 再次检查是否应该重启（可能用户已手动停止）
            if (!this.servers.has(key)) {
              this.startServer(inst.config.name, inst.workspacePath).catch(e => {
                logger.lsp.error(`[LSP ${key}] Restart failed:`, e)
              })
            }
          }, delay)
        } else {
          logger.lsp.error(`[LSP ${key}] Server crashed ${inst.crashCount} times, giving up`)
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
      this.setDiagnosticsCache(uri, diagnostics)

      // 只在有诊断信息时记录日志
      if (diagnostics.length > 0) {
        logger.lsp.debug(`[LSP ${key}] Diagnostics: ${uri} (${diagnostics.length} items)`)
      }

      // 通知等待诊断的调用者
      this.notifyDiagnosticsWaiters(uri)

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

  /**
   * 通知等待诊断的调用者（带防抖）
   */
  private notifyDiagnosticsWaiters(uri: string): void {
    const waiters = this.diagnosticsWaiters.get(uri)
    if (!waiters || waiters.length === 0) return

    // 使用防抖，等待 LSP 发送后续诊断（如语义诊断在语法诊断之后）
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout)
      waiter.timeout = setTimeout(() => {
        waiter.resolve()
        // 从等待列表中移除
        const idx = waiters.indexOf(waiter)
        if (idx >= 0) waiters.splice(idx, 1)
        if (waiters.length === 0) this.diagnosticsWaiters.delete(uri)
      }, LspManager.DIAGNOSTICS_DEBOUNCE_MS)
    }
  }

  /**
   * 等待指定文件的诊断信息
   */
  async waitForDiagnostics(uri: string): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // 超时后自动 resolve
        const waiters = this.diagnosticsWaiters.get(uri)
        if (waiters) {
          const idx = waiters.findIndex(w => w.resolve === resolve)
          if (idx >= 0) waiters.splice(idx, 1)
          if (waiters.length === 0) this.diagnosticsWaiters.delete(uri)
        }
        resolve()
      }, LspManager.DIAGNOSTICS_TIMEOUT_MS)

      if (!this.diagnosticsWaiters.has(uri)) {
        this.diagnosticsWaiters.set(uri, [])
      }
      this.diagnosticsWaiters.get(uri)!.push({ resolve, timeout })
    })
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
        // Call Hierarchy 支持
        callHierarchy: {
          dynamicRegistration: false,
        },
        // Inlay Hints 支持
        inlayHint: {
          dynamicRegistration: false,
        },
      },
      workspace: { 
        workspaceFolders: true, 
        applyEdit: true, 
        configuration: true,
        // 文件监视支持
        didChangeWatchedFiles: {
          dynamicRegistration: false,
        },
      },
    }
  }

  async stopServerByKey(key: string): Promise<void> {
    const instance = this.servers.get(key)
    if (!instance?.process) return
    
    // 清除该服务器相关的诊断缓存（按前缀删除）
    const workspaceUri = `file:///${instance.workspacePath.replace(/\\/g, '/')}`
    const altUri = workspaceUri.replace('file:///', 'file://')
    
    // 获取要删除的 URI 列表
    const urisToDelete = this.diagnosticsCache.keys().filter(
      uri => uri.startsWith(workspaceUri) || uri.startsWith(altUri)
    )
    
    for (const uri of urisToDelete) {
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
    return this.diagnosticsCache.get(uri) ?? []
  }

  getDiagnosticsCacheStats() {
    return this.diagnosticsCache.getStats()
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

  // ============ Call Hierarchy 支持 ============

  /**
   * 准备调用层次结构
   * 返回指定位置的调用层次项
   */
  async prepareCallHierarchy(
    key: string,
    uri: string,
    line: number,
    character: number
  ): Promise<any[] | null> {
    try {
      const result = await this.sendRequest(key, 'textDocument/prepareCallHierarchy', {
        textDocument: { uri },
        position: { line, character },
      })
      return result || null
    } catch {
      return null
    }
  }

  /**
   * 获取调用当前函数的所有位置（谁调用了我）
   */
  async getIncomingCalls(key: string, item: any): Promise<any[] | null> {
    try {
      const result = await this.sendRequest(key, 'callHierarchy/incomingCalls', { item })
      return result || null
    } catch {
      return null
    }
  }

  /**
   * 获取当前函数调用的所有位置（我调用了谁）
   */
  async getOutgoingCalls(key: string, item: any): Promise<any[] | null> {
    try {
      const result = await this.sendRequest(key, 'callHierarchy/outgoingCalls', { item })
      return result || null
    } catch {
      return null
    }
  }

  // ============ 智能根目录检测 ============

  /**
   * 根据文件路径和语言获取最佳的工作区根目录
   */
  async findBestRoot(filePath: string, languageId: LanguageId, workspacePath: string): Promise<string> {
    const serverName = this.getServerForLanguage(languageId)
    if (!serverName) return workspacePath

    const config = LSP_SERVERS.find(c => c.name === serverName)
    if (!config?.findRoot) return workspacePath

    try {
      const root = await config.findRoot(filePath, workspacePath)
      return root || workspacePath
    } catch {
      return workspacePath
    }
  }

  /**
   * 为指定文件启动 LSP 服务器（使用智能根目录检测）
   */
  async ensureServerForFile(filePath: string, languageId: LanguageId, workspacePath: string): Promise<string | null> {
    const serverName = this.getServerForLanguage(languageId)
    if (!serverName) return null

    // 使用智能根目录检测
    const bestRoot = await this.findBestRoot(filePath, languageId, workspacePath)
    const success = await this.startServer(serverName, bestRoot)
    return success ? this.getInstanceKey(serverName, bestRoot) : null
  }

  // ============ 文件监视通知 ============

  /**
   * 通知服务器文件变化
   */
  notifyDidChangeWatchedFiles(key: string, changes: Array<{ uri: string; type: number }>): void {
    this.sendNotification(key, 'workspace/didChangeWatchedFiles', { changes })
  }

  /**
   * 获取服务器配置
   */
  getServerConfig(serverName: string): LspServerConfig | undefined {
    return LSP_SERVERS.find(c => c.name === serverName)
  }

  /**
   * 获取所有支持的语言
   */
  getSupportedLanguages(): LanguageId[] {
    return Array.from(this.languageToServer.keys())
  }
}

export const lspManager = new LspManager()
