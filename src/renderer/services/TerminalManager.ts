/**
 * 终端管理服务
 * 
 * 职责：
 * - 管理用户交互式终端的生命周期（创建、销毁）
 * - 管理 xterm 实例和 PTY 进程
 * - 提供统一 API 给 UI 层
 * 
 * 注意：Agent 命令执行使用 shell:executeBackground，不经过此服务
 */

import { api } from '@/renderer/services/electronAPI'
import { Terminal as XTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { getEditorConfig } from '@renderer/settings'
import { logger } from '@utils/Logger'

// ===== 类型定义 =====

export interface TerminalInstance {
  id: string
  name: string
  cwd: string
  shell: string
  createdAt: number
}

export interface TerminalManagerState {
  terminals: TerminalInstance[]
  activeId: string | null
}

interface XTermInstance {
  terminal: XTerminal
  fitAddon: FitAddon
  container: HTMLDivElement | null
}

type StateListener = (state: TerminalManagerState) => void

// ===== 终端管理器 =====

// 获取终端缓冲配置（从 editorConfig 读取）
function getOutputBufferConfig() {
  const config = getEditorConfig()
  const maxLines = config.performance.terminalBufferSize || 1000
  return {
    maxLines,
    // 使用行数 * 平均行长度估算，避免频繁计算字节
    maxTotalChars: maxLines * 200,
    trimRatio: 0.3,
  }
}

class TerminalManagerClass {
  private state: TerminalManagerState = {
    terminals: [],
    activeId: null,
  }

  // xterm 实例管理
  private xtermInstances = new Map<string, XTermInstance>()
  // 简化缓冲区：只记录行数和字符数（比字节数计算更快）
  private outputBuffers = new Map<string, { lines: string[]; totalChars: number }>()
  
  // PTY 状态
  private ptyReady = new Map<string, boolean>()
  private pendingPtyCreation = new Map<string, Promise<boolean>>()

  // 监听器
  private stateListeners = new Set<StateListener>()
  
  // 主题配置
  private currentTheme: Record<string, string> = {}

  // IPC 监听器清理函数
  private ipcCleanup: (() => void) | null = null

  constructor() {
    this.setupIpcListeners()
  }

  private setupIpcListeners() {
    const onData = api.terminal.onData(({ id, data }: { id: string; data: string }) => {
      const xterm = this.xtermInstances.get(id)
      if (xterm?.terminal) {
        xterm.terminal.write(data)
      }

      // 缓存输出
      this.appendToBuffer(id, data)
    })

    const onExit = api.terminal.onExit(({ id, exitCode, signal }: { id: string; exitCode: number; signal?: number }) => {
      logger.system.info(`[TerminalManager] Terminal ${id} exited with code ${exitCode}, signal ${signal}`)
      
      const xterm = this.xtermInstances.get(id)
      if (xterm?.terminal) {
        xterm.terminal.write(`\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m\r\n`)
      }
      
      // 清理 PTY 状态
      this.ptyReady.delete(id)
    })

    const onError = api.terminal.onError?.(({ id, error }: { id: string; error: string }) => {
      logger.system.error(`[TerminalManager] Terminal ${id} error:`, error)
      
      const xterm = this.xtermInstances.get(id)
      if (xterm?.terminal) {
        xterm.terminal.write(`\r\n\x1b[31m[Terminal Error: ${error}]\x1b[0m\r\n`)
      }
    })

    this.ipcCleanup = () => {
      onData()
      onExit()
      onError?.()
    }
  }

  /**
   * 追加数据到输出缓冲区
   */
  private appendToBuffer(id: string, data: string): void {
    let buffer = this.outputBuffers.get(id)
    if (!buffer) {
      buffer = { lines: [], totalChars: 0 }
      this.outputBuffers.set(id, buffer)
    }

    buffer.lines.push(data)
    buffer.totalChars += data.length

    const config = getOutputBufferConfig()

    // 检查是否需要裁剪
    if (buffer.lines.length > config.maxLines || buffer.totalChars > config.maxTotalChars) {
      const keepCount = Math.floor(buffer.lines.length * (1 - config.trimRatio))
      const removed = buffer.lines.splice(0, buffer.lines.length - keepCount)
      // 减去被移除的字符数
      for (const line of removed) {
        buffer.totalChars -= line.length
      }
    }
  }

  /**
   * 获取缓冲区统计信息
   */
  getBufferStats(id: string): { lines: number; chars: number } | null {
    const buffer = this.outputBuffers.get(id)
    if (!buffer) return null
    return { lines: buffer.lines.length, chars: buffer.totalChars }
  }

  // ===== 状态订阅 =====

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    listener(this.getState())
    return () => this.stateListeners.delete(listener)
  }

  private notify() {
    const state = this.getState()
    this.stateListeners.forEach(listener => listener(state))
  }

  getState(): TerminalManagerState {
    return {
      terminals: [...this.state.terminals],
      activeId: this.state.activeId,
    }
  }

  // ===== 主题管理 =====

  setTheme(theme: Record<string, string>) {
    this.currentTheme = theme
    this.xtermInstances.forEach(({ terminal }) => {
      terminal.options.theme = theme
    })
  }

  // ===== 终端生命周期 =====

  async createTerminal(options: {
    name?: string
    cwd: string
    shell?: string
  }): Promise<string> {
    const id = crypto.randomUUID()
    
    const instance: TerminalInstance = {
      id,
      name: options.name || 'Terminal',
      cwd: options.cwd,
      shell: options.shell || '',
      createdAt: Date.now(),
    }

    this.state.terminals.push(instance)
    this.state.activeId = id
    this.notify()

    // 创建 PTY
    const ptyPromise = this.createPty(id, options.cwd, options.shell)
    this.pendingPtyCreation.set(id, ptyPromise)

    try {
      const success = await ptyPromise
      this.ptyReady.set(id, success)
    } catch {
      this.ptyReady.set(id, false)
    } finally {
      this.pendingPtyCreation.delete(id)
    }

    return id
  }

  private async createPty(id: string, cwd: string, shell?: string): Promise<boolean> {
    try {
      const result = await api.terminal.create({ id, cwd, shell })
      if (!result?.success) {
        const errorMsg = result?.error || 'Unknown error'
        logger.system.error(`[TerminalManager] Failed to create PTY for ${id}:`, errorMsg)
        
        // 显示错误信息到终端
        const xterm = this.xtermInstances.get(id)
        if (xterm?.terminal) {
          xterm.terminal.write(`\r\n\x1b[31m[Error: ${errorMsg}]\x1b[0m\r\n`)
          if (errorMsg.includes('rebuild')) {
            xterm.terminal.write(`\x1b[33mPlease run: npm run rebuild\x1b[0m\r\n`)
          }
        }
        return false
      }
      return true
    } catch (error: any) {
      logger.system.error(`[TerminalManager] Exception creating PTY for ${id}:`, error)
      
      // 显示错误信息到终端
      const xterm = this.xtermInstances.get(id)
      if (xterm?.terminal) {
        const errorMsg = error?.message || 'Failed to create terminal'
        xterm.terminal.write(`\r\n\x1b[31m[Error: ${errorMsg}]\x1b[0m\r\n`)
      }
      return false
    }
  }

  mountTerminal(id: string, container: HTMLDivElement): boolean {
    if (this.xtermInstances.has(id)) {
      const existing = this.xtermInstances.get(id)!
      if (existing.container !== container) {
        existing.terminal.open(container)
        existing.container = container
        try { existing.fitAddon.fit() } catch {}
      }
      return true
    }

    const termConfig = getEditorConfig().terminal
    const terminal = new XTerminal({
      cursorBlink: termConfig.cursorBlink,
      fontFamily: termConfig.fontFamily,
      fontSize: termConfig.fontSize,
      lineHeight: termConfig.lineHeight,
      scrollback: termConfig.scrollback,
      allowProposedApi: true,
      theme: this.currentTheme,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(container)

    try {
      const webglAddon = new WebglAddon()
      terminal.loadAddon(webglAddon)
      webglAddon.onContextLoss(() => webglAddon.dispose())
    } catch {}

    // 处理终端输入
    terminal.onData(data => {
      api.terminal.write(id, data)
    })

    // 处理复制粘贴快捷键
    terminal.attachCustomKeyEventHandler((event) => {
      // Ctrl+C 复制（有选中内容时）
      if (event.ctrlKey && event.key === 'c' && event.type === 'keydown') {
        const selection = terminal.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
          return false // 阻止默认行为
        }
        // 没有选中内容时，让 Ctrl+C 发送到终端（中断信号）
        return true
      }
      
      // Ctrl+V 粘贴
      if (event.ctrlKey && event.key === 'v' && event.type === 'keydown') {
        navigator.clipboard.readText().then(text => {
          if (text) {
            api.terminal.write(id, text)
          }
        }).catch(() => {})
        return false // 阻止默认行为
      }
      
      // Ctrl+Shift+C 复制（备用）
      if (event.ctrlKey && event.shiftKey && event.key === 'C' && event.type === 'keydown') {
        const selection = terminal.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
        }
        return false
      }
      
      // Ctrl+Shift+V 粘贴（备用）
      if (event.ctrlKey && event.shiftKey && event.key === 'V' && event.type === 'keydown') {
        navigator.clipboard.readText().then(text => {
          if (text) {
            api.terminal.write(id, text)
          }
        }).catch(() => {})
        return false
      }
      
      return true // 其他按键正常处理
    })

    this.xtermInstances.set(id, { terminal, fitAddon, container })

    try { fitAddon.fit() } catch {}

    const dims = fitAddon.proposeDimensions()
    if (dims && dims.cols > 0 && dims.rows > 0) {
      api.terminal.resize(id, dims.cols, dims.rows)
    }

    return true
  }

  fitTerminal(id: string) {
    const instance = this.xtermInstances.get(id)
    if (!instance) return

    try {
      instance.fitAddon.fit()
      const dims = instance.fitAddon.proposeDimensions()
      if (dims && dims.cols > 0 && dims.rows > 0) {
        api.terminal.resize(id, dims.cols, dims.rows)
      }
    } catch {}
  }

  closeTerminal(id: string) {
    const xterm = this.xtermInstances.get(id)
    if (xterm) {
      xterm.terminal.dispose()
      this.xtermInstances.delete(id)
    }

    this.outputBuffers.delete(id)
    this.ptyReady.delete(id)
    api.terminal.kill(id)

    const index = this.state.terminals.findIndex(t => t.id === id)
    if (index !== -1) {
      this.state.terminals.splice(index, 1)
    }

    if (this.state.activeId === id) {
      this.state.activeId = this.state.terminals[0]?.id || null
    }

    this.notify()
  }

  setActiveTerminal(id: string | null) {
    if (this.state.activeId !== id) {
      this.state.activeId = id
      this.notify()
    }
  }

  // ===== 工具方法 =====

  writeToTerminal(id: string, data: string) {
    api.terminal.write(id, data)
  }

  getOutputBuffer(id: string): string[] {
    return this.outputBuffers.get(id)?.lines || []
  }

  getXterm(id: string): XTerminal | null {
    return this.xtermInstances.get(id)?.terminal || null
  }

  focusTerminal(id: string) {
    const xterm = this.xtermInstances.get(id)
    if (xterm) {
      xterm.terminal.focus()
    }
  }

  cleanup() {
    if (this.ipcCleanup) {
      this.ipcCleanup()
      this.ipcCleanup = null
    }

    for (const terminal of this.state.terminals) {
      this.closeTerminal(terminal.id)
    }

    this.state = {
      terminals: [],
      activeId: null,
    }
    this.notify()
  }
}

export const terminalManager = new TerminalManagerClass()
