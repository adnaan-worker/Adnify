/**
 * 调试服务
 * 管理调试会话，支持多种语言的调试器
 */

import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import { logger } from '@shared/utils/Logger'
import type {
  DebugConfig,
  DebugEvent,
  DebuggerState,
  Breakpoint,
  SourceBreakpoint,
  StackFrame,
  Thread,
  Scope,
  Variable,
  Source,
  DebugCapabilities,
} from './types'
import { NodeDebugAdapter } from './adapters/NodeDebugAdapter'
import { DAPClient } from './DAPClient'
import { getAdapterInfo } from './adapters'

/** 调试会话 */
interface DebugSession {
  id: string
  config: DebugConfig
  state: DebuggerState
  /** Node.js 使用专用适配器 */
  nodeAdapter?: NodeDebugAdapter
  /** 其他语言使用 DAP 客户端 */
  dapClient?: DAPClient
  /** 断点 */
  breakpoints: Map<string, Breakpoint[]>
  /** 能力 */
  capabilities: DebugCapabilities
}

export class DebugServiceClass extends EventEmitter {
  private sessions = new Map<string, DebugSession>()
  private activeSessionId: string | null = null
  private sessionCounter = 0

  /**
   * 创建调试会话
   */
  async createSession(config: DebugConfig): Promise<string> {
    const sessionId = `debug-${++this.sessionCounter}`

    const session: DebugSession = {
      id: sessionId,
      config,
      state: 'idle',
      breakpoints: new Map(),
      capabilities: {},
    }

    // 根据类型创建适配器
    if (config.type === 'node') {
      session.nodeAdapter = new NodeDebugAdapter()
      session.capabilities = session.nodeAdapter.getCapabilities()
      
      // 监听事件
      session.nodeAdapter.on('event', (event: DebugEvent) => {
        this.handleEvent(sessionId, event)
      })
    } else {
      // 使用 DAP 客户端
      const adapterInfo = getAdapterInfo(config.type)
      if (!adapterInfo) {
        throw new Error(`Unsupported debug type: ${config.type}`)
      }

      session.dapClient = new DAPClient()
      
      // 监听事件
      session.dapClient.on('event', (event: DebugEvent) => {
        this.handleEvent(sessionId, event)
      })

      session.dapClient.on('exit', () => {
        this.handleEvent(sessionId, { type: 'terminated' })
      })

      // 启动适配器
      const descriptor = await adapterInfo.getDescriptor(config)
      await session.dapClient.start(descriptor)
      
      // 初始化
      session.capabilities = await session.dapClient.initialize()
    }

    this.sessions.set(sessionId, session)
    this.activeSessionId = sessionId

    logger.system.info('[DebugService] Session created:', sessionId, config.type)
    return sessionId
  }

  /**
   * 启动调试
   */
  async launch(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    session.state = 'running'
    this.notifyStateChange(sessionId)

    try {
      if (session.nodeAdapter) {
        await session.nodeAdapter.launch(session.config)
      } else if (session.dapClient) {
        await session.dapClient.launch(session.config)
      }
    } catch (error) {
      session.state = 'stopped'
      this.notifyStateChange(sessionId)
      throw error
    }
  }

  /**
   * 附加到进程
   */
  async attach(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    session.state = 'running'
    this.notifyStateChange(sessionId)

    try {
      if (session.nodeAdapter) {
        await session.nodeAdapter.attach(session.config)
      } else if (session.dapClient) {
        await session.dapClient.attach(session.config)
      }
    } catch (error) {
      session.state = 'stopped'
      this.notifyStateChange(sessionId)
      throw error
    }
  }

  /**
   * 配置完成
   */
  async configurationDone(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    
    if (session.nodeAdapter) {
      await session.nodeAdapter.configurationDone()
    } else if (session.dapClient && session.capabilities.supportsConfigurationDoneRequest) {
      await session.dapClient.configurationDone()
    }
  }

  /**
   * 停止调试
   */
  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    try {
      if (session.nodeAdapter) {
        await session.nodeAdapter.disconnect()
      } else if (session.dapClient) {
        await session.dapClient.disconnect()
        await session.dapClient.stop()
      }
    } catch (e) {
      logger.system.warn('[DebugService] Error stopping session:', e)
    }

    session.state = 'stopped'
    this.sessions.delete(sessionId)
    
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null
    }

    this.notifyStateChange(sessionId)
    logger.system.info('[DebugService] Session stopped:', sessionId)
  }


  async cleanupAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys())
    for (const sessionId of sessionIds) {
      await this.stop(sessionId)
    }
    this.activeSessionId = null
  }

  /**
   * 继续执行
   */
  async continue(sessionId: string, threadId = 1): Promise<void> {
    const session = this.getSession(sessionId)
    
    if (session.nodeAdapter) {
      await session.nodeAdapter.continue(threadId)
    } else if (session.dapClient) {
      await session.dapClient.continue(threadId)
    }
    
    session.state = 'running'
    this.notifyStateChange(sessionId)
  }

  /**
   * 单步跳过
   */
  async stepOver(sessionId: string, threadId = 1): Promise<void> {
    const session = this.getSession(sessionId)
    
    if (session.nodeAdapter) {
      await session.nodeAdapter.next(threadId)
    } else if (session.dapClient) {
      await session.dapClient.next(threadId)
    }
  }

  /**
   * 单步进入
   */
  async stepInto(sessionId: string, threadId = 1): Promise<void> {
    const session = this.getSession(sessionId)
    
    if (session.nodeAdapter) {
      await session.nodeAdapter.stepIn(threadId)
    } else if (session.dapClient) {
      await session.dapClient.stepIn(threadId)
    }
  }

  /**
   * 单步跳出
   */
  async stepOut(sessionId: string, threadId = 1): Promise<void> {
    const session = this.getSession(sessionId)
    
    if (session.nodeAdapter) {
      await session.nodeAdapter.stepOut(threadId)
    } else if (session.dapClient) {
      await session.dapClient.stepOut(threadId)
    }
  }

  /**
   * 暂停
   */
  async pause(sessionId: string, threadId = 1): Promise<void> {
    const session = this.getSession(sessionId)
    
    if (session.nodeAdapter) {
      await session.nodeAdapter.pause(threadId)
    } else if (session.dapClient) {
      await session.dapClient.pause(threadId)
    }
  }

  /**
   * 设置断点
   */
  async setBreakpoints(sessionId: string, file: string, breakpoints: SourceBreakpoint[]): Promise<Breakpoint[]> {
    const session = this.getSession(sessionId)
    const source: Source = { path: file, name: file.split(/[/\\]/).pop() }
    
    let result: Breakpoint[]
    
    if (session.nodeAdapter) {
      result = await session.nodeAdapter.setBreakpoints(source, breakpoints)
    } else if (session.dapClient) {
      result = await session.dapClient.setBreakpoints(source, breakpoints)
    } else {
      result = []
    }

    session.breakpoints.set(file, result)
    return result
  }

  /**
   * 获取线程列表
   */
  async getThreads(sessionId: string): Promise<Thread[]> {
    const session = this.getSession(sessionId)
    
    if (session.nodeAdapter) {
      return session.nodeAdapter.threads()
    } else if (session.dapClient) {
      return session.dapClient.threads()
    }
    
    return []
  }

  /**
   * 获取堆栈帧
   */
  async getStackTrace(sessionId: string, threadId: number): Promise<StackFrame[]> {
    const session = this.getSession(sessionId)
    
    if (session.nodeAdapter) {
      const result = await session.nodeAdapter.stackTrace(threadId)
      return result.stackFrames
    } else if (session.dapClient) {
      const result = await session.dapClient.stackTrace(threadId)
      return result.stackFrames
    }
    
    return []
  }

  /**
   * 获取作用域
   */
  async getScopes(sessionId: string, frameId: number): Promise<Scope[]> {
    const session = this.getSession(sessionId)
    
    if (session.nodeAdapter) {
      return session.nodeAdapter.scopes(frameId)
    } else if (session.dapClient) {
      return session.dapClient.scopes(frameId)
    }
    
    return []
  }

  /**
   * 获取变量
   */
  async getVariables(sessionId: string, variablesReference: number): Promise<Variable[]> {
    const session = this.getSession(sessionId)
    
    if (session.nodeAdapter) {
      return session.nodeAdapter.variables(variablesReference)
    } else if (session.dapClient) {
      return session.dapClient.variables(variablesReference)
    }
    
    return []
  }

  /**
   * 求值表达式
   */
  async evaluate(sessionId: string, expression: string, frameId?: number): Promise<{ result: string; type?: string; variablesReference: number }> {
    const session = this.getSession(sessionId)
    
    if (session.nodeAdapter) {
      return session.nodeAdapter.evaluate(expression, frameId)
    } else if (session.dapClient) {
      return session.dapClient.evaluate(expression, frameId)
    }
    
    return { result: '', variablesReference: 0 }
  }

  /**
   * 获取会话状态
   */
  getSessionState(sessionId: string): DebuggerState {
    return this.sessions.get(sessionId)?.state || 'stopped'
  }

  /**
   * 获取活动会话 ID
   */
  getActiveSessionId(): string | null {
    return this.activeSessionId
  }

  /**
   * 获取所有会话
   */
  getAllSessions(): Array<{ id: string; config: DebugConfig; state: DebuggerState }> {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      config: s.config,
      state: s.state,
    }))
  }

  /**
   * 停止所有活跃会话（应用退出时调用）
   */
  async stopAll(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys())
    for (const id of sessionIds) {
      try { await this.stop(id) } catch { /* ignore cleanup errors */ }
    }
  }

  /**
   * 获取会话能力
   */
  getCapabilities(sessionId: string): DebugCapabilities {
    return this.sessions.get(sessionId)?.capabilities || {}
  }

  // ========== 私有方法 ==========

  private getSession(sessionId: string): DebugSession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Debug session not found: ${sessionId}`)
    }
    return session
  }

  private handleEvent(sessionId: string, event: DebugEvent): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    // 更新状态
    switch (event.type) {
      case 'stopped':
        session.state = 'paused'
        break
      case 'continued':
        session.state = 'running'
        break
      case 'exited':
      case 'terminated':
        session.state = 'stopped'
        break
    }

    // 通知渲染进程
    this.sendToRenderer('debug:event', { sessionId, event })
    
    if (event.type === 'stopped' || event.type === 'continued' || event.type === 'exited' || event.type === 'terminated') {
      this.notifyStateChange(sessionId)
    }
  }

  private notifyStateChange(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    this.sendToRenderer('debug:stateChanged', {
      sessionId,
      state: session?.state || 'stopped',
    })
  }

  private sendToRenderer(channel: string, data: unknown): void {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        try {
          win.webContents.send(channel, data)
        } catch {
          // 忽略发送失败
        }
      }
    })
  }
}

export const debugService = new DebugServiceClass()
