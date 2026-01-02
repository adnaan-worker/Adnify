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

// 性能计时器
interface PerformanceTimer {
  name: string
  category: LogCategory
  startTime: number
  metadata?: Record<string, unknown>
}

class LoggerClass {
  private config: LoggerConfig = {
    minLevel: 'info',  // 默认只显示警告和错误
    enabled: true,
    maxLogs: 1000,
    fileLogging: false,
    consoleLogging: true,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
  }
  private logs: LogEntry[] = []
  private timers: Map<string, PerformanceTimer> = new Map()
  private fileWriteQueue: LogEntry[] = []
  private isWriting = false
  
  // 检测是否在主进程中运行
  private isMain = typeof process !== 'undefined' && process.versions?.node && !(globalThis as Record<string, unknown>).window

  /**
   * 配置日志器
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 设置最低日志级别
   */
  setMinLevel(level: LogLevel): void {
    this.config.minLevel = level
  }

  /**
   * 启用/禁用日志
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled
  }

  /**
   * 启用文件日志
   */
  enableFileLogging(logFilePath: string): void {
    this.config.fileLogging = true
    this.config.logFilePath = logFilePath
  }

  /**
   * 获取所有日志
   */
  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  /**
   * 按分类获取日志
   */
  getLogsByCategory(category: LogCategory): LogEntry[] {
    return this.logs.filter(log => log.category === category)
  }

  /**
   * 按级别获取日志
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(log => log.level === level)
  }

  /**
   * 获取最近的错误日志
   */
  getRecentErrors(count: number = 10): LogEntry[] {
    return this.logs
      .filter(log => log.level === 'error')
      .slice(-count)
  }

  /**
   * 清空日志
   */
  clearLogs(): void {
    this.logs = []
  }

  /**
   * 导出日志为 JSON
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2)
  }

  /**
   * 开始性能计时
   */
  startTimer(name: string, category: LogCategory = 'Performance', metadata?: Record<string, unknown>): void {
    this.timers.set(name, {
      name,
      category,
      startTime: performance.now(),
      metadata,
    })
  }

  /**
   * 结束性能计时并记录
   */
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

  /**
   * 测量异步函数执行时间
   */
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

  /**
   * 测量同步函数执行时间
   */
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

  /**
   * 核心日志方法
   */
  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: unknown,
    duration?: number
  ): void {
    if (!this.config.enabled) return
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

    // 添加到内存日志
    this.logs.push(entry)
    if (this.logs.length > this.config.maxLogs) {
      this.logs.shift()
    }

    // 控制台输出
    if (this.config.consoleLogging) {
      this.printToConsole(entry)
    }

    // 文件日志（仅主进程）
    if (this.config.fileLogging && this.isMain) {
      this.queueFileWrite(entry)
    }
  }

  /**
   * 队列文件写入
   */
  private queueFileWrite(entry: LogEntry): void {
    this.fileWriteQueue.push(entry)
    this.processFileWriteQueue()
  }

  /**
   * 处理文件写入队列（仅主进程）
   */
  private async processFileWriteQueue(): Promise<void> {
    // 仅在主进程中执行文件写入
    if (!this.isMain) return
    if (this.isWriting || this.fileWriteQueue.length === 0) return
    if (!this.config.logFilePath) return

    this.isWriting = true

    try {
      // 动态导入 fs 和 path（仅主进程）
      const fs = await import('fs')
      const path = await import('path')

      const logPath = this.config.logFilePath
      const logDir = path.dirname(logPath)

      // 确保目录存在
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }

      // 检查文件大小，需要轮转
      if (fs.existsSync(logPath)) {
        const stats = fs.statSync(logPath)
        if (stats.size >= this.config.maxFileSize) {
          await this.rotateLogFiles(logPath)
        }
      }

      // 写入日志
      const entries = this.fileWriteQueue.splice(0, 100) // 批量写入
      const lines = entries.map(e => this.formatLogLine(e)).join('\n') + '\n'
      fs.appendFileSync(logPath, lines, 'utf-8')
    } catch (error) {
      console.error('[Logger] Failed to write to file:', error)
    } finally {
      this.isWriting = false
      // 如果还有待写入的日志，继续处理
      if (this.fileWriteQueue.length > 0) {
        setTimeout(() => this.processFileWriteQueue(), 100)
      }
    }
  }

  /**
   * 日志文件轮转（仅主进程）
   */
  private async rotateLogFiles(logPath: string): Promise<void> {
    if (!this.isMain) return
    
    const fs = await import('fs')
    const path = await import('path')

    const dir = path.dirname(logPath)
    const ext = path.extname(logPath)
    const base = path.basename(logPath, ext)

    // 删除最旧的文件
    const oldestPath = path.join(dir, `${base}.${this.config.maxFiles}${ext}`)
    if (fs.existsSync(oldestPath)) {
      fs.unlinkSync(oldestPath)
    }

    // 重命名现有文件
    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldPath = path.join(dir, `${base}.${i}${ext}`)
      const newPath = path.join(dir, `${base}.${i + 1}${ext}`)
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath)
      }
    }

    // 重命名当前文件
    const newPath = path.join(dir, `${base}.1${ext}`)
    fs.renameSync(logPath, newPath)
  }

  /**
   * 格式化日志行（用于文件）
   */
  private formatLogLine(entry: LogEntry): string {
    const time = entry.timestamp.toISOString()
    const source = entry.source === 'main' ? 'M' : 'R'
    const duration = entry.duration !== undefined ? ` (${entry.duration}ms)` : ''
    const data = entry.data ? ` ${JSON.stringify(entry.data)}` : ''
    return `${time} [${source}] [${entry.category}] [${entry.level.toUpperCase()}] ${entry.message}${duration}${data}`
  }

  /**
   * 格式化控制台输出
   */
  private printToConsole(entry: LogEntry): void {
    const time = entry.timestamp.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    })

    const levelColor = LEVEL_COLORS[entry.level]
    const categoryColor = CATEGORY_COLORS[entry.category]
    const sourceTag = this.isMain ? '[M]' : '[R]'

    const prefix = `%c${time}%c ${sourceTag}%c [${entry.category}]%c [${entry.level.toUpperCase()}]`
    const styles = [
      'color: #888',
      'color: #666',
      `color: ${categoryColor}; font-weight: bold`,
      `color: ${levelColor}; font-weight: bold`,
    ]

    const durationStr = entry.duration !== undefined ? ` (${entry.duration}ms)` : ''
    const fullMessage = `${entry.message}${durationStr}`

    const consoleMethod =
      entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'log'

    if (entry.data !== undefined) {
      console[consoleMethod](prefix, ...styles, fullMessage, entry.data)
    } else {
      console[consoleMethod](prefix, ...styles, fullMessage)
    }
  }

  // ===== 分类快捷方法 =====

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

  // 通用方法（用于动态分类）
  logWithCategory(level: LogLevel, category: LogCategory, message: string, data?: unknown): void {
    this.log(level, category, message, data)
  }
}

// 单例导出
export const logger = new LoggerClass()

// 默认导出
export default logger
