/**
 * 统一日志工具 - 跨进程通用
 * 支持 Main 进程和 Renderer 进程
 * 
 * 功能：
 * - 日志级别控制
 * - 日志持久化（写入文件）
 * - 日志轮转
 * - 性能计时
 */

// 日志级别
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// 日志分类 - 扩展支持更多模块
export type LogCategory =
  | 'Agent'
  | 'LLM'
  | 'Tool'
  | 'LSP'
  | 'UI'
  | 'System'
  | 'Completion'
  | 'Store'
  | 'File'
  | 'Git'
  | 'IPC'
  | 'Index'
  | 'Security'
  | 'Settings'
  | 'Terminal'
  | 'Performance'
  | 'Cache'
  | 'MCP'
  | 'Plan'

// 日志条目
export interface LogEntry {
  timestamp: Date
  level: LogLevel
  category: LogCategory
  message: string
  data?: unknown
  duration?: number
  source?: 'main' | 'renderer'
}

// 日志级别优先级
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// 日志级别颜色（控制台）
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '#888888',
  info: '#00bcd4',
  warn: '#ff9800',
  error: '#f44336',
}

// 分类颜色
const CATEGORY_COLORS: Record<LogCategory, string> = {
  Agent: '#9c27b0',
  LLM: '#2196f3',
  Tool: '#4caf50',
  LSP: '#ff5722',
  UI: '#e91e63',
  System: '#607d8b',
  Completion: '#00bcd4',
  Store: '#795548',
  File: '#8bc34a',
  Git: '#ff9800',
  IPC: '#3f51b5',
  Index: '#009688',
  Security: '#f44336',
  Settings: '#673ab7',
  Terminal: '#00bcd4',
  Performance: '#ff5722',
  Cache: '#795548',
  MCP: '#00acc1',
  Plan: '#ab47bc',
}

// 日志配置
interface LoggerConfig {
  minLevel: LogLevel
  enabled: boolean
  maxLogs: number
  fileLogging: boolean
  consoleLogging: boolean
  logFilePath?: string
  maxFileSize: number  // 最大文件大小（字节）
  maxFiles: number     // 最大文件数量（轮转）
}

// 全局类型扩展（用于生产环境标记）
interface GlobalWithProd {
  __PROD__?: boolean
}

// 检测是否为生产环境
function isProduction(): boolean {
  // 1. Renderer 进程 - 检查 window.__PROD__ 标记（由 main.tsx 注入）
  // 这个值来自 import.meta.env.PROD，在 Vite 构建时会被正确替换
  if (typeof globalThis !== 'undefined') {
    const prodFlag = (globalThis as unknown as GlobalWithProd).__PROD__
    if (prodFlag === true) {
      return true
    }
  }

  // 2. Electron 主进程 - 检查是否打包后运行
  if (typeof process !== 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron')
      if (app?.isPackaged === true) {
        return true
      }
    } catch {
      // 不在 Electron 主进程环境中，继续其他检查
    }
  }

  // 3. 检查 NODE_ENV（适用于所有环境）
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
    return true
  }

  // 4. 检查是否在打包后的环境中（通过检查路径，作为后备方案）
  if (typeof process !== 'undefined' && process.execPath) {
    const execPath = process.execPath.toLowerCase()
    // 在打包后的 Electron 应用中，execPath 通常指向 .asar 文件或打包后的可执行文件
    // 且不包含开发相关的路径
    if (execPath.includes('.asar')) {
      return true
    }
    // 检查是否不在典型的开发环境中
    const cwd = (process.cwd?.() || '').toLowerCase()
    if (!execPath.includes('node_modules') &&
      !execPath.includes('electron') &&
      !cwd.includes('src') &&
      !cwd.includes('node_modules')) {
      // 可能是生产环境，但需要更严格的检查
      // 只有在明确不是开发环境时才返回 true
      if (!execPath.includes('dev') && !cwd.includes('dev')) {
        return true
      }
    }
  }

  return false
}

// 性能计时器
interface PerformanceTimer {
  name: string
  category: LogCategory
  startTime: number
  metadata?: Record<string, unknown>
}

// ANSI 颜色代码 (更加丰富的调色盘)
const ANSI_COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // 前景色
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // 背景色 (Badge 风格)
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgGray: '\x1b[100m',

  // 明亮背景色 (黑字)
  bgBrightInfo: '\x1b[106m\x1b[30m',
  bgBrightWarn: '\x1b[103m\x1b[30m',
  bgBrightError: '\x1b[41m\x1b[97m',
  bgBrightDebug: '\x1b[47m\x1b[30m',
}

const LEVEL_ANSI: Record<LogLevel, string> = {
  debug: ANSI_COLORS.bgBrightDebug,
  info: ANSI_COLORS.bgBrightInfo,
  warn: ANSI_COLORS.bgBrightWarn,
  error: ANSI_COLORS.bgBrightError,
}

const CATEGORY_ANSI: Record<LogCategory | string, string> = {
  Agent: ANSI_COLORS.magenta,
  LLM: ANSI_COLORS.blue,
  Tool: ANSI_COLORS.green,
  LSP: ANSI_COLORS.yellow,
  UI: ANSI_COLORS.magenta,
  System: ANSI_COLORS.white,
  IPC: ANSI_COLORS.blue,
  Index: ANSI_COLORS.cyan,
  Terminal: ANSI_COLORS.cyan,
  Performance: ANSI_COLORS.red,
  Plan: ANSI_COLORS.magenta,
  Security: ANSI_COLORS.red,
}

// 日志配置
interface LoggerConfig {
  // ... (previous interfaces)
  minLevel: LogLevel
  enabled: boolean
  maxLogs: number
  fileLogging: boolean
  consoleLogging: boolean
  logFilePath?: string
  maxFileSize: number  // 最大文件大小（字节）
  maxFiles: number     // 最大文件数量（轮转）
}

// ... (other internal interfaces/functions)

class LoggerClass {
  private config: LoggerConfig
  private logs: LogEntry[] = []
  private timers: Map<string, PerformanceTimer> = new Map()
  private fileWriteQueue: LogEntry[] = []
  private isWriting = false

  // 检测是否在主进程中运行
  private isMain = typeof process !== 'undefined' && process.versions?.node && typeof (globalThis as Record<string, unknown>).window === 'undefined'

  // 缓存生产环境检测结果
  private _isProd: boolean | null = null

  constructor() {
    const isProd = isProduction()
    this._isProd = isProd
    this.config = {
      minLevel: isProd ? 'warn' : 'info',
      enabled: true,
      maxLogs: 1000,
      fileLogging: false,
      consoleLogging: !isProd,
      maxFileSize: 10 * 1024 * 1024,
      maxFiles: 5,
    }
  }

  // 获取生产环境状态
  private get isProd(): boolean {
    if (this._isProd === null) {
      this._isProd = isProduction()
      if (this._isProd) {
        this.config.minLevel = 'warn'
        this.config.consoleLogging = false
      }
    }
    return this._isProd
  }

  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  setMinLevel(level: LogLevel): void {
    this.config.minLevel = level
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled
  }

  setConsoleLogging(enabled: boolean): void {
    this.config.consoleLogging = enabled
  }

  isProductionMode(): boolean {
    return this.isProd
  }

  refreshProductionMode(): void {
    this._isProd = null
    const wasProd = this.isProd
    if (wasProd) {
      this.config.minLevel = 'warn'
      this.config.consoleLogging = false
    }
  }

  enableFileLogging(logFilePath: string): void {
    this.config.fileLogging = true
    this.config.logFilePath = logFilePath
    if (this.config.minLevel === 'debug' || this.config.minLevel === 'info') {
      this.config.minLevel = 'warn'
    }
  }

  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  getLogsByCategory(category: LogCategory): LogEntry[] {
    return this.logs.filter(log => log.category === category)
  }

  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(log => log.level === level)
  }

  getRecentErrors(count: number = 10): LogEntry[] {
    return this.logs
      .filter(log => log.level === 'error')
      .slice(-count)
  }

  clearLogs(): void {
    this.logs = []
  }

  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2)
  }

  startTimer(name: string, category: LogCategory = 'Performance', metadata?: Record<string, unknown>): void {
    this.timers.set(name, {
      name,
      category,
      startTime: performance.now(),
      metadata,
    })
  }

  endTimer(name: string, additionalData?: Record<string, unknown>): number | null {
    const timer = this.timers.get(name)
    if (!timer) {
      this.log('warn', 'Performance', `Timer "${name}" not found`)
      return null
    }

    const duration = Math.round(performance.now() - timer.startTime)
    this.timers.delete(name)

    const data = { ...timer.metadata, ...additionalData }
    this.log('info', timer.category, `${name} completed`, Object.keys(data).length > 0 ? data : undefined, duration)

    return duration
  }

  async measure<T>(
    name: string,
    fn: () => Promise<T>,
    category: LogCategory = 'Performance'
  ): Promise<T> {
    this.startTimer(name, category)
    try {
      const result = await fn()
      this.endTimer(name, { success: true })
      return result
    } catch (error) {
      this.endTimer(name, { success: false, error: String(error) })
      throw error
    }
  }

  measureSync<T>(
    name: string,
    fn: () => T,
    category: LogCategory = 'Performance'
  ): T {
    this.startTimer(name, category)
    try {
      const result = fn()
      this.endTimer(name, { success: true })
      return result
    } catch (error) {
      this.endTimer(name, { success: false, error: String(error) })
      throw error
    }
  }

  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: unknown,
    duration?: number
  ): void {
    if (!this.config.enabled) return
    this.isProd
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.config.minLevel]) return

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      category,
      message,
      data,
      duration,
      source: this.isMain ? 'main' : 'renderer',
    }

    this.logs.push(entry)
    if (this.logs.length > this.config.maxLogs) {
      this.logs.shift()
    }

    if (this.config.consoleLogging) {
      this.printToConsole(entry)
    }

    if (this.config.fileLogging && this.isMain) {
      this.queueFileWrite(entry)
    }
  }

  private queueFileWrite(entry: LogEntry): void {
    this.fileWriteQueue.push(entry)
    this.processFileWriteQueue()
  }

  private async processFileWriteQueue(): Promise<void> {
    if (!this.isMain) return
    if (this.isWriting || this.fileWriteQueue.length === 0) return
    if (!this.config.logFilePath) return

    this.isWriting = true

    try {
      const fs = await import('fs')
      const path = await import('path')

      const logPath = this.config.logFilePath
      const logDir = path.dirname(logPath)

      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }

      if (fs.existsSync(logPath)) {
        const stats = fs.statSync(logPath)
        if (stats.size >= this.config.maxFileSize) {
          await this.rotateLogFiles(logPath)
        }
      }

      const entries = this.fileWriteQueue.splice(0, 100)
      const lines = entries.map(e => this.formatLogLine(e)).join('\n') + '\n'
      fs.appendFileSync(logPath, lines, 'utf-8')
    } catch (error) {
      console.error('[Logger] Failed to write to file:', error)
    } finally {
      this.isWriting = false
      if (this.fileWriteQueue.length > 0) {
        setTimeout(() => this.processFileWriteQueue(), 100)
      }
    }
  }

  private async rotateLogFiles(logPath: string): Promise<void> {
    if (!this.isMain) return
    const fs = await import('fs')
    const path = await import('path')

    const dir = path.dirname(logPath)
    const ext = path.extname(logPath)
    const base = path.basename(logPath, ext)

    const oldestPath = path.join(dir, `${base}.${this.config.maxFiles}${ext}`)
    if (fs.existsSync(oldestPath)) {
      fs.unlinkSync(oldestPath)
    }

    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldPath = path.join(dir, `${base}.${i}${ext}`)
      const newPath = path.join(dir, `${base}.${i + 1}${ext}`)
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath)
      }
    }

    const newPath = path.join(dir, `${base}.1${ext}`)
    fs.renameSync(logPath, newPath)
  }

  private formatLogLine(entry: LogEntry): string {
    const time = entry.timestamp.toISOString()
    const source = entry.source === 'main' ? 'M' : 'R'
    const duration = entry.duration !== undefined ? ` (${entry.duration}ms)` : ''
    const data = entry.data ? ` ${JSON.stringify(entry.data)}` : ''
    return `${time} [${source}] [${entry.category}] [${entry.level.toUpperCase()}] ${entry.message}${duration}${data}`
  }

  private printToConsole(entry: LogEntry): void {
    const time = entry.timestamp.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    })

    const consoleMethod =
      entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'log'

    if (this.isMain) {
      // Node.js (Main Process) - 使用干净的 ANSI 颜色
      const levelBadge = LEVEL_ANSI[entry.level] || ANSI_COLORS.bgBrightDebug
      const catColor = CATEGORY_ANSI[entry.category] || ANSI_COLORS.white
      const reset = ANSI_COLORS.reset
      const dim = ANSI_COLORS.dim
      const bold = ANSI_COLORS.bold

      const sourceTag = `${dim}M${reset}`
      const timeStr = `${dim}${time}${reset}`

      // Level Badge: " INFO  "
      const levelStr = `${levelBadge} ${entry.level.toUpperCase().padEnd(5)} ${reset}`

      // Category: " INDEX "
      const categoryStr = `${catColor}${bold}${entry.category.toUpperCase().padEnd(10)}${reset}`

      const durationStr = entry.duration !== undefined ? ` ${ANSI_COLORS.yellow}(${entry.duration}ms)${reset}` : ''

      const messageColor = entry.level === 'error' ? ANSI_COLORS.red : entry.level === 'warn' ? ANSI_COLORS.yellow : ''
      const coloredMessage = `${messageColor}${entry.message}${reset}`

      const prefix = `${timeStr} ${sourceTag} ${levelStr} ${categoryStr}`

      if (entry.data !== undefined) {
        console[consoleMethod](`${prefix} ${coloredMessage}${durationStr}`, entry.data)
      } else {
        console[consoleMethod](`${prefix} ${coloredMessage}${durationStr}`)
      }
    } else {
      // Browser (Renderer Process) - 简约现代的 CSS 样式
      const levelColor = LEVEL_COLORS[entry.level]
      const categoryColor = CATEGORY_COLORS[entry.category]
      const sourceTag = 'R'

      // 定义样式
      const timeStyle = 'color: #888; font-family: monospace; font-size: 10px;'
      const sourceStyle = 'color: #aaa; font-weight: bold; font-family: monospace; font-size: 10px; margin-right: 4px;'
      const levelStyle = `
        background: ${levelColor}22; 
        color: ${levelColor}; 
        border: 1px solid ${levelColor}44; 
        padding: 1px 6px; 
        border-radius: 4px; 
        font-weight: 800; 
        font-size: 10px; 
        text-transform: uppercase;
        margin-right: 4px;
      `
      const categoryStyle = `
        color: ${categoryColor}; 
        font-weight: 800; 
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      `
      const messageStyle = `
        color: ${entry.level === 'error' ? '#ff4d4f' : entry.level === 'warn' ? '#faad14' : 'inherit'};
        font-weight: ${entry.level === 'info' ? '400' : '500'};
        margin-left: 8px;
      `

      const prefix = `%c${time} %c${sourceTag} %c${entry.level.toUpperCase()} %c${entry.category.toUpperCase()} %c`
      const styles = [
        timeStyle,
        sourceStyle,
        levelStyle,
        categoryStyle,
        messageStyle
      ]

      const durationStr = entry.duration !== undefined ? ` (${entry.duration}ms)` : ''
      const fullMessage = `${entry.message}${durationStr}`

      if (entry.data !== undefined) {
        console[consoleMethod](prefix, ...styles, fullMessage, entry.data)
      } else {
        console[consoleMethod](prefix, ...styles, fullMessage)
      }
    }
  }

  private createCategoryLogger(category: LogCategory) {
    return {
      debug: (message: string, ...args: unknown[]) => this.log('debug', category, message, args.length > 0 ? args : undefined),
      info: (message: string, ...args: unknown[]) => this.log('info', category, message, args.length > 0 ? args : undefined),
      warn: (message: string, ...args: unknown[]) => this.log('warn', category, message, args.length > 0 ? args : undefined),
      error: (message: string, ...args: unknown[]) => this.log('error', category, message, args.length > 0 ? args : undefined),
      time: (message: string, duration: number, data?: unknown) =>
        this.log('info', category, message, data, duration),
    }
  }

  agent = this.createCategoryLogger('Agent')
  llm = this.createCategoryLogger('LLM')
  tool = this.createCategoryLogger('Tool')
  lsp = this.createCategoryLogger('LSP')
  ui = this.createCategoryLogger('UI')
  system = this.createCategoryLogger('System')
  completion = this.createCategoryLogger('Completion')
  store = this.createCategoryLogger('Store')
  file = this.createCategoryLogger('File')
  git = this.createCategoryLogger('Git')
  ipc = this.createCategoryLogger('IPC')
  index = this.createCategoryLogger('Index')
  security = this.createCategoryLogger('Security')
  settings = this.createCategoryLogger('Settings')
  terminal = this.createCategoryLogger('Terminal')
  perf = this.createCategoryLogger('Performance')
  cache = this.createCategoryLogger('Cache')
  mcp = this.createCategoryLogger('MCP')
  plan = this.createCategoryLogger('Plan')

  logWithCategory(level: LogLevel, category: LogCategory, message: string, data?: unknown): void {
    this.log(level, category, message, data)
  }
}

export const logger = new LoggerClass()
export default logger;
