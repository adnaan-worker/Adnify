/**
 * Debug Adapter Protocol (DAP) 客户端
 * 通过 stdin/stdout 或 socket 与 Debug Adapter 通信
 */

import { spawn, ChildProcess } from 'child_process'
import { Socket } from 'net'
import { EventEmitter } from 'events'
import { logger } from '@shared/utils/Logger'
import type {
  DebugAdapterDescriptor,
  DebugConfig,
  DebugEvent,
  DebugCapabilities,
  Breakpoint,
  SourceBreakpoint,
  StackFrame,
  Thread,
  Scope,
  Variable,
  Source,
} from './types'

/** DAP 消息头 */
const CONTENT_LENGTH_HEADER = 'Content-Length: '
const HEADER_DELIMITER = '\r\n\r\n'

/** DAP 请求 */
interface DAPRequest {
  seq: number
  type: 'request'
  command: string
  arguments?: Record<string, unknown>
}

/** DAP 响应 */
interface DAPResponse {
  seq: number
  type: 'response'
  request_seq: number
  success: boolean
  command: string
  message?: string
  body?: Record<string, unknown>
}

/** DAP 事件 */
interface DAPEvent {
  seq: number
  type: 'event'
  event: string
  body?: Record<string, unknown>
}

type DAPMessage = DAPRequest | DAPResponse | DAPEvent

/** 待处理请求 */
interface PendingRequest {
  resolve: (body: Record<string, unknown> | undefined) => void
  reject: (error: Error) => void
  command: string
}

export class DAPClient extends EventEmitter {
  private process: ChildProcess | null = null
  private socket: Socket | null = null
  private seq = 0
  private pendingRequests = new Map<number, PendingRequest>()
  private buffer = ''
  private capabilities: DebugCapabilities = {}
  private isConnected = false

  /**
   * 启动 Debug Adapter
   */
  async start(descriptor: DebugAdapterDescriptor): Promise<void> {
    if (descriptor.type === 'executable') {
      await this.startProcess(descriptor)
    } else {
      await this.connectSocket(descriptor)
    }
    this.isConnected = true
  }

  /**
   * 停止 Debug Adapter
   */
  async stop(): Promise<void> {
    this.isConnected = false
    
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    
    if (this.process) {
      this.process.kill()
      this.process = null
    }

    // 拒绝所有待处理请求
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Debug adapter stopped'))
    }
    this.pendingRequests.clear()
  }

  /**
   * 获取调试器能力
   */
  getCapabilities(): DebugCapabilities {
    return this.capabilities
  }

  // ========== DAP 请求 ==========

  /**
   * 初始化请求
   */
  async initialize(clientId: string = 'adnify'): Promise<DebugCapabilities> {
    const response = await this.sendRequest('initialize', {
      clientID: clientId,
      clientName: 'Adnify',
      adapterID: 'debug-adapter',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: true,
      supportsMemoryReferences: true,
      supportsProgressReporting: true,
      supportsInvalidatedEvent: true,
    })

    this.capabilities = (response as DebugCapabilities) || {}
    return this.capabilities
  }

  /**
   * 配置完成请求
   */
  async configurationDone(): Promise<void> {
    await this.sendRequest('configurationDone')
  }

  /**
   * 启动请求
   */
  async launch(config: DebugConfig): Promise<void> {
    await this.sendRequest('launch', config as unknown as Record<string, unknown>)
  }

  /**
   * 附加请求
   */
  async attach(config: DebugConfig): Promise<void> {
    await this.sendRequest('attach', config as unknown as Record<string, unknown>)
  }

  /**
   * 断开请求
   */
  async disconnect(restart = false, terminateDebuggee = true): Promise<void> {
    try {
      await this.sendRequest('disconnect', { restart, terminateDebuggee })
    } catch {
      // 忽略断开时的错误
    }
  }

  /**
   * 终止请求
   */
  async terminate(restart = false): Promise<void> {
    if (this.capabilities.supportsTerminateRequest) {
      await this.sendRequest('terminate', { restart })
    } else {
      await this.disconnect(restart)
    }
  }

  /**
   * 设置断点
   */
  async setBreakpoints(source: Source, breakpoints: SourceBreakpoint[]): Promise<Breakpoint[]> {
    const response = await this.sendRequest('setBreakpoints', {
      source,
      breakpoints,
      sourceModified: false,
    })

    const body = response as { breakpoints?: Array<{
      id?: number
      verified: boolean
      line: number
      column?: number
      message?: string
    }> }

    return (body.breakpoints || []).map((bp, i) => ({
      id: String(bp.id ?? i),
      file: source.path || '',
      line: bp.line,
      column: bp.column,
      verified: bp.verified,
      condition: breakpoints[i]?.condition,
      hitCondition: breakpoints[i]?.hitCondition,
      logMessage: breakpoints[i]?.logMessage,
    }))
  }

  /**
   * 继续执行
   */
  async continue(threadId: number): Promise<boolean> {
    const response = await this.sendRequest('continue', { threadId })
    return (response as { allThreadsContinued?: boolean })?.allThreadsContinued ?? true
  }

  /**
   * 暂停
   */
  async pause(threadId: number): Promise<void> {
    await this.sendRequest('pause', { threadId })
  }

  /**
   * 单步跳过
   */
  async next(threadId: number): Promise<void> {
    await this.sendRequest('next', { threadId })
  }

  /**
   * 单步进入
   */
  async stepIn(threadId: number): Promise<void> {
    await this.sendRequest('stepIn', { threadId })
  }

  /**
   * 单步跳出
   */
  async stepOut(threadId: number): Promise<void> {
    await this.sendRequest('stepOut', { threadId })
  }

  /**
   * 获取线程列表
   */
  async threads(): Promise<Thread[]> {
    const response = await this.sendRequest('threads')
    return (response as { threads?: Thread[] })?.threads || []
  }

  /**
   * 获取堆栈帧
   */
  async stackTrace(threadId: number, startFrame = 0, levels = 20): Promise<{ stackFrames: StackFrame[]; totalFrames?: number }> {
    const response = await this.sendRequest('stackTrace', {
      threadId,
      startFrame,
      levels,
    })

    const body = response as { stackFrames?: StackFrame[]; totalFrames?: number }
    return {
      stackFrames: body.stackFrames || [],
      totalFrames: body.totalFrames,
    }
  }

  /**
   * 获取作用域
   */
  async scopes(frameId: number): Promise<Scope[]> {
    const response = await this.sendRequest('scopes', { frameId })
    return (response as { scopes?: Scope[] })?.scopes || []
  }

  /**
   * 获取变量
   */
  async variables(variablesReference: number, start?: number, count?: number): Promise<Variable[]> {
    const response = await this.sendRequest('variables', {
      variablesReference,
      start,
      count,
    })
    return (response as { variables?: Variable[] })?.variables || []
  }

  /**
   * 求值表达式
   */
  async evaluate(
    expression: string,
    frameId?: number,
    context: 'watch' | 'repl' | 'hover' | 'clipboard' = 'repl'
  ): Promise<{ result: string; type?: string; variablesReference: number }> {
    const response = await this.sendRequest('evaluate', {
      expression,
      frameId,
      context,
    })

    const body = response as { result?: string; type?: string; variablesReference?: number }
    return {
      result: body.result || '',
      type: body.type,
      variablesReference: body.variablesReference || 0,
    }
  }

  // ========== 私有方法 ==========

  private async startProcess(descriptor: DebugAdapterDescriptor): Promise<void> {
    if (!descriptor.command) {
      throw new Error('Debug adapter command is required')
    }

    logger.system.info('[DAPClient] Starting debug adapter:', descriptor.command, descriptor.args)

    this.process = spawn(descriptor.command, descriptor.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleData(data.toString())
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      logger.system.warn('[DAPClient] Debug adapter stderr:', data.toString())
    })

    this.process.on('exit', (code) => {
      logger.system.info('[DAPClient] Debug adapter exited with code:', code)
      this.isConnected = false
      this.emit('exit', code)
    })

    this.process.on('error', (err) => {
      logger.system.error('[DAPClient] Debug adapter error:', err)
      this.emit('error', err)
    })
  }

  private async connectSocket(descriptor: DebugAdapterDescriptor): Promise<void> {
    const host = descriptor.host || '127.0.0.1'
    const port = descriptor.port

    if (!port) {
      throw new Error('Debug adapter port is required')
    }

    logger.system.info('[DAPClient] Connecting to debug adapter:', `${host}:${port}`)

    return new Promise((resolve, reject) => {
      this.socket = new Socket()

      this.socket.on('connect', () => {
        logger.system.info('[DAPClient] Connected to debug adapter')
        resolve()
      })

      this.socket.on('data', (data: Buffer) => {
        this.handleData(data.toString())
      })

      this.socket.on('error', (err) => {
        logger.system.error('[DAPClient] Socket error:', err)
        reject(err)
      })

      this.socket.on('close', () => {
        logger.system.info('[DAPClient] Socket closed')
        this.isConnected = false
        this.emit('exit', 0)
      })

      this.socket.connect(port, host)
    })
  }

  private handleData(data: string): void {
    this.buffer += data

    while (true) {
      // 查找头部结束位置
      const headerEnd = this.buffer.indexOf(HEADER_DELIMITER)
      if (headerEnd === -1) break

      // 解析 Content-Length
      const header = this.buffer.substring(0, headerEnd)
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        logger.system.error('[DAPClient] Invalid header:', header)
        this.buffer = this.buffer.substring(headerEnd + HEADER_DELIMITER.length)
        continue
      }

      const contentLength = parseInt(match[1], 10)
      const messageStart = headerEnd + HEADER_DELIMITER.length
      const messageEnd = messageStart + contentLength

      // 检查是否有完整消息
      if (this.buffer.length < messageEnd) break

      // 提取并解析消息
      const messageStr = this.buffer.substring(messageStart, messageEnd)
      this.buffer = this.buffer.substring(messageEnd)

      try {
        const message = JSON.parse(messageStr) as DAPMessage
        this.handleMessage(message)
      } catch (e) {
        logger.system.error('[DAPClient] Failed to parse message:', e)
      }
    }
  }

  private handleMessage(message: DAPMessage): void {
    switch (message.type) {
      case 'response':
        this.handleResponse(message)
        break
      case 'event':
        this.handleEvent(message)
        break
      case 'request':
        this.handleReverseRequest(message)
        break
    }
  }

  private handleResponse(response: DAPResponse): void {
    const pending = this.pendingRequests.get(response.request_seq)
    if (!pending) {
      logger.system.warn('[DAPClient] Unexpected response:', response)
      return
    }

    this.pendingRequests.delete(response.request_seq)

    if (response.success) {
      pending.resolve(response.body)
    } else {
      pending.reject(new Error(response.message || `Request failed: ${pending.command}`))
    }
  }

  private handleEvent(event: DAPEvent): void {
    const debugEvent = this.convertEvent(event)
    if (debugEvent) {
      this.emit('event', debugEvent)
    }
  }

  private convertEvent(event: DAPEvent): DebugEvent | null {
    const body = event.body || {}

    switch (event.event) {
      case 'initialized':
        return { type: 'initialized' }

      case 'stopped':
        return {
          type: 'stopped',
          reason: (body.reason as string) || 'unknown',
          threadId: body.threadId as number | undefined,
          allThreadsStopped: body.allThreadsStopped as boolean | undefined,
          hitBreakpointIds: body.hitBreakpointIds as number[] | undefined,
        }

      case 'continued':
        return {
          type: 'continued',
          threadId: body.threadId as number | undefined,
          allThreadsContinued: body.allThreadsContinued as boolean | undefined,
        }

      case 'exited':
        return { type: 'exited', exitCode: (body.exitCode as number) || 0 }

      case 'terminated':
        return { type: 'terminated', restart: body.restart as boolean | undefined }

      case 'thread':
        return {
          type: 'thread',
          reason: body.reason as 'started' | 'exited',
          threadId: body.threadId as number,
        }

      case 'output':
        return {
          type: 'output',
          category: (body.category as 'console' | 'stdout' | 'stderr' | 'telemetry') || 'console',
          output: (body.output as string) || '',
          source: body.source as Source | undefined,
          line: body.line as number | undefined,
        }

      case 'breakpoint':
        const bp = body.breakpoint as { id?: number; verified?: boolean; line?: number; column?: number } | undefined
        if (bp) {
          return {
            type: 'breakpoint',
            reason: body.reason as 'changed' | 'new' | 'removed',
            breakpoint: {
              id: String(bp.id ?? ''),
              file: '',
              line: bp.line || 0,
              column: bp.column,
              verified: bp.verified ?? false,
            },
          }
        }
        return null

      case 'process':
        return {
          type: 'process',
          name: (body.name as string) || '',
          startMethod: body.startMethod as 'launch' | 'attach' | undefined,
        }

      case 'capabilities':
        return {
          type: 'capabilities',
          capabilities: body.capabilities as DebugCapabilities,
        }

      default:
        logger.system.debug('[DAPClient] Unknown event:', event.event)
        return null
    }
  }

  private handleReverseRequest(request: DAPRequest): void {
    logger.system.info('[DAPClient] Reverse request:', request.command)

    if (request.command === 'runInTerminal') {
      this.handleRunInTerminal(request)
    } else {
      this.sendResponse(request.seq, request.command, false, `Reverse request not supported: ${request.command}`)
    }
  }

  private handleRunInTerminal(request: DAPRequest): void {
    const args = request.arguments as {
      kind?: 'integrated' | 'external'
      title?: string
      cwd: string
      args: string[]
      env?: Record<string, string | null>
    } | undefined

    if (!args?.args?.length) {
      this.sendResponse(request.seq, request.command, false, 'Missing args for runInTerminal')
      return
    }

    try {
      const [cmd, ...cmdArgs] = args.args
      const env = { ...process.env }
      if (args.env) {
        for (const [key, value] of Object.entries(args.env)) {
          if (value === null) {
            delete env[key]
          } else {
            env[key] = value
          }
        }
      }

      const child = spawn(cmd, cmdArgs, {
        cwd: args.cwd,
        env,
        stdio: 'ignore',
        detached: true,
        shell: true,
      })

      child.unref()

      this.sendResponse(request.seq, request.command, true)
      logger.system.info('[DAPClient] runInTerminal launched:', cmd, cmdArgs.join(' '))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.sendResponse(request.seq, request.command, false, `Failed to run in terminal: ${message}`)
    }
  }

  private async sendRequest(command: string, args?: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    if (!this.isConnected) {
      throw new Error('Debug adapter not connected')
    }

    const seq = ++this.seq
    const request: DAPRequest = {
      seq,
      type: 'request',
      command,
      arguments: args,
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(seq, { resolve, reject, command })
      this.sendMessage(request)

      // 超时处理
      setTimeout(() => {
        if (this.pendingRequests.has(seq)) {
          this.pendingRequests.delete(seq)
          reject(new Error(`Request timeout: ${command}`))
        }
      }, 30000)
    })
  }

  private sendResponse(requestSeq: number, command: string, success: boolean, message?: string): void {
    const response: DAPResponse = {
      seq: ++this.seq,
      type: 'response',
      request_seq: requestSeq,
      success,
      command,
      message,
    }
    this.sendMessage(response)
  }

  private sendMessage(message: DAPMessage): void {
    const json = JSON.stringify(message)
    const data = `${CONTENT_LENGTH_HEADER}${Buffer.byteLength(json)}${HEADER_DELIMITER}${json}`

    if (this.process?.stdin) {
      this.process.stdin.write(data)
    } else if (this.socket) {
      this.socket.write(data)
    }
  }
}
