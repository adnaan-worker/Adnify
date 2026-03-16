/**
 * 情绪上下文分析器（v2 — 接入真实数据源）
 *
 * 从以下来源获取实时数据：
 *  - useStore           → activeFilePath / openFiles / gitStatus / toolCallLogs / cursorPosition
 *  - useDiagnosticsStore → errorCount / warningCount / diagnostics Map
 *  - useAgentStore       → AI 消息历史（thread messages）
 *  - EventBus           → tool:error / tool:completed / llm:done 等实时事件
 */

import type { CodeContext, EmotionState } from '../types/emotion'
import { EventBus } from '../core/EventBus'
import { useStore } from '@/renderer/store'
import { useDiagnosticsStore } from '@/renderer/services/diagnosticsStore'
import { useAgentStore, selectMessages } from '@/renderer/agent/store/AgentStore'

// ===== 内部统计结构 =====
interface AIInteractionRecord {
  timestamp: number
  type: 'user_message' | 'assistant_reply' | 'tool_call' | 'tool_error' | 'tool_success'
  durationMs?: number  // 对话回合用时
}

interface ErrorRecord {
  timestamp: number
  severity: 'error' | 'warning'
  source: 'diagnostics' | 'tool' | 'llm'
}

class EmotionContextAnalyzer {
  // ===== 自动采集的历史 =====
  private aiHistory: AIInteractionRecord[] = []
  private errorHistory: ErrorRecord[] = []
  private fileSwitchTimestamps: number[] = []

  // ===== LLM 回合计时 =====
  private llmStartTime: number | null = null

  // ===== Store 快照缓存（每次 analyzeContext 刷新） =====
  private lastDiagErrorCount = 0
  private lastDiagWarnCount = 0

  // ===== 订阅清理 =====
  private unsubscribers: Array<() => void> = []
  private initialized = false

  // ===== 初始化：订阅 EventBus + Store 变化 =====
  init(): void {
    if (this.initialized) return
    this.initialized = true

    // 1. 监听 EventBus 的工具/LLM 事件
    this.unsubscribers.push(
      EventBus.on('tool:completed', () => {
        this.recordAI({ type: 'tool_success' })
      }),
      EventBus.on('tool:error', () => {
        this.recordAI({ type: 'tool_error' })
        this.recordError('tool')
      }),
      EventBus.on('llm:start', () => {
        this.llmStartTime = Date.now()
      }),
      EventBus.on('llm:done', () => {
        const duration = this.llmStartTime ? Date.now() - this.llmStartTime : undefined
        this.recordAI({ type: 'assistant_reply', durationMs: duration })
        this.llmStartTime = null
      }),
      EventBus.on('llm:error', () => {
        this.recordError('llm')
        this.llmStartTime = null
      }),
    )

    // 2. 监听主 Store — 文件切换
    let prevFile = useStore.getState().activeFilePath
    this.unsubscribers.push(
      useStore.subscribe((state) => {
        if (state.activeFilePath && state.activeFilePath !== prevFile) {
          prevFile = state.activeFilePath
          this.fileSwitchTimestamps.push(Date.now())
          // 裁剪旧时间戳
          const cutoff = Date.now() - 60 * 60 * 1000
          while (this.fileSwitchTimestamps.length > 0 && this.fileSwitchTimestamps[0] < cutoff) {
            this.fileSwitchTimestamps.shift()
          }
        }
      }),
    )

    // 3. 监听诊断 Store — 错误/警告变化
    this.unsubscribers.push(
      useDiagnosticsStore.subscribe((state) => {
        const { errorCount, warningCount } = state
        // 新增错误时记录
        if (errorCount > this.lastDiagErrorCount) {
          const newErrors = errorCount - this.lastDiagErrorCount
          for (let i = 0; i < newErrors; i++) {
            this.recordError('diagnostics', 'error')
          }
        }
        if (warningCount > this.lastDiagWarnCount) {
          const newWarns = warningCount - this.lastDiagWarnCount
          for (let i = 0; i < newWarns; i++) {
            this.recordError('diagnostics', 'warning')
          }
        }
        this.lastDiagErrorCount = errorCount
        this.lastDiagWarnCount = warningCount
      }),
    )

    // 4. 监听 AgentStore — 用户发送消息
    let prevMsgCount = 0
    this.unsubscribers.push(
      useAgentStore.subscribe((state) => {
        const messages = selectMessages(state)
        if (messages.length > prevMsgCount) {
          // 新增的消息
          const newMessages = messages.slice(prevMsgCount)
          for (const msg of newMessages) {
            if (msg.role === 'user') {
              this.recordAI({ type: 'user_message' })
            }
          }
          prevMsgCount = messages.length
        }
      }),
    )
  }

  /**
   * 清理所有订阅
   */
  destroy(): void {
    for (const unsub of this.unsubscribers) unsub()
    this.unsubscribers = []
    this.initialized = false
  }

  // ===== 核心分析方法 =====

  /**
   * 分析当前代码上下文（从真实数据源读取）
   */
  analyzeContext(): CodeContext | null {
    try {
      const mainState = useStore.getState()
      const diagState = useDiagnosticsStore.getState()

      // 当前文件
      const currentFile = mainState.activeFilePath || ''
      if (!currentFile) return null

      const fileType = this.classifyFile(currentFile)
      const projectType = this.detectProjectType(mainState.openFiles)

      // 代码复杂度 — 基于打开文件数量 + 文件内容长度
      const codeComplexity = this.estimateComplexity(mainState)

      // 诊断错误 — 只看当前文件是否有真正的 error（severity === 1），不看全局 warnings
      const { hasErrors, errorType } = this.checkCurrentFileErrors(diagState.diagnostics, currentFile)

      // Git 状态
      const gitStatus = this.readGitStatus(mainState.gitStatus)
      const recentCommits = 0 // TODO: 可从 git log 获取，暂不阻塞

      // 文件切换频率（最近15分钟）
      const recentSwitches = this.countRecent(this.fileSwitchTimestamps, 15 * 60 * 1000)

      // AI 交互分析
      const aiInteractions = this.summarizeAIInteractions(30 * 60 * 1000) // 最近30分钟

      return {
        currentFile,
        fileType,
        projectType,
        recentFiles: (mainState.openFiles || []).map((f: { path: string }) => f.path).slice(0, 10),
        codeComplexity,
        hasErrors,
        errorType,
        gitStatus,
        recentCommits,
        searchQueries: recentSwitches, // 用文件切换数代替搜索次数（相关性高）
        aiInteractions,
      }
    } catch (error) {
      console.warn('[EmotionContextAnalyzer] Failed to analyze context:', error)
      return null
    }
  }

  /**
   * 基于上下文增强情绪检测
   */
  enhanceEmotionDetection(
    baseState: EmotionState,
    baseIntensity: number,
    context: CodeContext | null
  ): { state: EmotionState; intensity: number; confidence: number; suggestions: string[] } {
    if (!context) {
      return { state: baseState, intensity: baseIntensity, confidence: 0.5, suggestions: [] }
    }

    let adjustedState = baseState
    let adjustedIntensity = baseIntensity
    let confidence = 0.75
    const suggestions: string[] = []

    // —————— 1. 诊断错误信号（来自真实 LSP 数据） ——————
    if (context.hasErrors) {
      const errorBoost = context.errorType === 'syntax' ? 0.35 : 0.25
      if (context.errorType === 'syntax') {
        adjustedState = this.nudgeState(adjustedState, 'frustrated', 0.6)
        adjustedIntensity = Math.min(adjustedIntensity + errorBoost, 1)
        suggestions.push('检测到语法错误，让 AI 帮你快速定位？')
      } else if (context.errorType === 'type') {
        adjustedState = this.nudgeState(adjustedState, 'stressed', 0.5)
        adjustedIntensity = Math.min(adjustedIntensity + errorBoost, 1)
        suggestions.push('类型错误有时候很烦人，需要帮忙梳理一下类型关系吗？')
      }
      confidence += 0.1
    }

    // —————— 2. AI 交互模式（来自真实消息历史） ——————
    const ai = context.aiInteractions
    if (ai.count > 0) {
      const toolErrorRate = this.getRecentToolErrorRate(30 * 60 * 1000)
      
      if (toolErrorRate > 0.4) {
        // 工具频繁失败 = 环境不顺
        adjustedState = this.nudgeState(adjustedState, 'frustrated', 0.5)
        adjustedIntensity = Math.min(adjustedIntensity + 0.2, 1)
        suggestions.push('AI 工具执行遇到一些困难，要检查一下工具配置吗？')
      }
      
      if (ai.count > 8 && ai.avgResponseTime > 5000) {
        // 高频对话 + 回复慢 = 可能在复杂问题上挣扎
        adjustedState = this.nudgeState(adjustedState, 'stressed', 0.4)
        adjustedIntensity = Math.min(adjustedIntensity + 0.15, 1)
      } else if (ai.count > 5 && ai.avgResponseTime < 2000) {
        // 高频对话 + 快速回复 = 流畅状态
        adjustedState = this.nudgeState(adjustedState, 'flow', 0.3)
      }

      confidence += 0.08
    }

    // —————— 3. Git 状态（来自真实 git 数据） ——————
    if (context.gitStatus === 'conflict') {
      adjustedState = this.nudgeState(adjustedState, 'stressed', 0.7)
      adjustedIntensity = Math.min(adjustedIntensity + 0.3, 1)
      suggestions.push('检测到 Git 冲突，需要帮忙解决吗？')
      confidence += 0.1
    } else if (context.gitStatus === 'modified') {
      // 有修改但状态正常，不强制改变
      confidence += 0.05
    }

    // —————— 4. 文件类型影响 ——————
    if (context.fileType === 'test') {
      // 写测试文件时往往更有条理
      adjustedState = this.nudgeState(adjustedState, 'focused', 0.2)
    } else if (context.fileType === 'config') {
      // 配置文件 = 可能在排查问题
      if (adjustedState === 'neutral') adjustedState = 'focused'
    }

    // —————— 5. 代码复杂度 ——————
    if (context.codeComplexity > 0.7) {
      adjustedState = this.nudgeState(adjustedState, 'stressed', 0.3)
      adjustedIntensity = Math.min(adjustedIntensity + 0.1, 1)
      suggestions.push('当前工作负载较高，适当休息可以提高效率')
    }

    // —————— 6. 频繁切换文件（来自真实 store 订阅） ——————
    if (context.searchQueries > 8) {
      adjustedState = this.nudgeState(adjustedState, 'stressed', 0.4)
      adjustedIntensity = Math.min(adjustedIntensity + 0.15, 1)
      suggestions.push('频繁切换文件？试试让 AI 帮你跨文件搜索')
    }

    confidence = Math.min(confidence, 0.95)

    return {
      state: adjustedState,
      intensity: Math.max(adjustedIntensity, 0),
      confidence,
      suggestions: suggestions.slice(0, 3),
    }
  }

  // ===== 数据统计辅助 =====

  /**
   * 获取最近时间窗口内的工具错误率
   */
  getRecentToolErrorRate(windowMs: number): number {
    const cutoff = Date.now() - windowMs
    const recentAI = this.aiHistory.filter(r => r.timestamp > cutoff)
    const toolCalls = recentAI.filter(r => r.type === 'tool_success' || r.type === 'tool_error')
    if (toolCalls.length === 0) return 0
    const errors = toolCalls.filter(r => r.type === 'tool_error').length
    return errors / toolCalls.length
  }

  /**
   * 获取最近时间窗口内的诊断错误数
   */
  getRecentDiagnosticErrors(windowMs: number): { errors: number; warnings: number } {
    const cutoff = Date.now() - windowMs
    const recent = this.errorHistory.filter(r => r.timestamp > cutoff && r.source === 'diagnostics')
    return {
      errors: recent.filter(r => r.severity === 'error').length,
      warnings: recent.filter(r => r.severity === 'warning').length,
    }
  }

  /**
   * 获取最近的 AI 交互摘要
   */
  private summarizeAIInteractions(windowMs: number): CodeContext['aiInteractions'] {
    const cutoff = Date.now() - windowMs
    const recent = this.aiHistory.filter(r => r.timestamp > cutoff)

    const count = recent.length
    const replies = recent.filter(r => r.type === 'assistant_reply')
    const avgResponseTime = replies.length > 0
      ? replies.reduce((sum, r) => sum + (r.durationMs || 0), 0) / replies.length
      : 0

    const toolErrors = recent.filter(r => r.type === 'tool_error').length
    const toolTotal = recent.filter(r => r.type === 'tool_error' || r.type === 'tool_success').length
    const rejectionRate = toolTotal > 0 ? toolErrors / toolTotal : 0

    // 根据消息量推断复杂度
    const userMsgs = recent.filter(r => r.type === 'user_message').length
    const questionComplexity: 'simple' | 'medium' | 'complex' =
      userMsgs > 10 ? 'complex' : userMsgs > 4 ? 'medium' : 'simple'

    return { count, avgResponseTime, rejectionRate, questionComplexity }
  }

  // ===== 数据分类辅助 =====

  private classifyFile(filePath: string): string {
    const lower = filePath.toLowerCase()
    if (lower.includes('.test.') || lower.includes('.spec.') || lower.includes('__tests__'))
      return 'test'
    if (lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml') ||
        lower.endsWith('.toml') || lower.endsWith('.env') || lower.includes('config'))
      return 'config'
    if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'doc'
    if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.less')) return 'style'
    return 'code'
  }

  private detectProjectType(openFiles: Array<{ path: string }> | undefined): string {
    if (!openFiles || openFiles.length === 0) return 'unknown'
    const paths = openFiles.map(f => f.path.toLowerCase())
    if (paths.some(p => p.includes('.tsx') || p.includes('.jsx'))) return 'react'
    if (paths.some(p => p.includes('.vue'))) return 'vue'
    if (paths.some(p => p.includes('.py'))) return 'python'
    if (paths.some(p => p.includes('.go'))) return 'go'
    if (paths.some(p => p.includes('.rs'))) return 'rust'
    return 'typescript'
  }

  private estimateComplexity(state: { openFiles?: Array<{ path: string; content?: string }> }): number {
    const files = state.openFiles || []
    // 综合：打开文件数 + 文件内容长度
    const fileCountScore = Math.min(files.length / 15, 1) // 15个文件 = 满分
    const totalSize = files.reduce((sum, f) => sum + ((f as { content?: string }).content?.length || 0), 0)
    const sizeScore = Math.min(totalSize / 50000, 1) // 50K字符 = 满分
    return fileCountScore * 0.4 + sizeScore * 0.6
  }

  /**
   * 只检查当前文件的诊断错误（severity 1 = error）
   * 不扫描全局，避免切换文件时误报
   */
  private checkCurrentFileErrors(
    diagnostics: Map<string, Array<{ severity?: number; message?: string }>>,
    currentFile: string
  ): { hasErrors: boolean; errorType?: 'syntax' | 'type' | 'runtime' | 'test' } {
    // 尝试多种 URI 格式匹配
    const fileDiags =
      diagnostics.get(currentFile) ||
      diagnostics.get(`file://${currentFile}`) ||
      []

    const errors = fileDiags.filter(d => d.severity === 1)
    if (errors.length === 0) return { hasErrors: false }

    // 根据文件类型和错误内容分类
    const lower = currentFile.toLowerCase()
    if (lower.includes('.test.') || lower.includes('.spec.')) {
      return { hasErrors: true, errorType: 'test' }
    }

    // 检查错误消息内容做更精细的分类
    const messages = errors.map(e => (e.message || '').toLowerCase())
    const hasSyntaxKeywords = messages.some(m =>
      m.includes('unexpected token') || m.includes('parsing error') ||
      m.includes('expression expected') || m.includes('declaration or statement')
    )
    if (hasSyntaxKeywords) {
      return { hasErrors: true, errorType: 'syntax' }
    }

    return { hasErrors: true, errorType: 'type' }
  }

  private readGitStatus(
    gitStatus: { hasConflicts?: boolean; unstaged?: unknown[]; staged?: unknown[] } | null | undefined
  ): 'clean' | 'modified' | 'conflict' {
    if (!gitStatus) return 'clean'
    if (gitStatus.hasConflicts) return 'conflict'
    const hasChanges =
      (Array.isArray(gitStatus.unstaged) && gitStatus.unstaged.length > 0) ||
      (Array.isArray(gitStatus.staged) && gitStatus.staged.length > 0)
    return hasChanges ? 'modified' : 'clean'
  }

  // ===== 记录辅助 =====

  private recordAI(record: Omit<AIInteractionRecord, 'timestamp'>): void {
    this.aiHistory.push({ ...record, timestamp: Date.now() })
    this.pruneByTime(this.aiHistory, 2 * 60 * 60 * 1000) // 保留2小时
  }

  private recordError(source: ErrorRecord['source'], severity: ErrorRecord['severity'] = 'error'): void {
    this.errorHistory.push({ timestamp: Date.now(), severity, source })
    this.pruneByTime(this.errorHistory, 60 * 60 * 1000) // 保留1小时
  }

  private pruneByTime<T extends { timestamp: number }>(arr: T[], windowMs: number): void {
    const cutoff = Date.now() - windowMs
    while (arr.length > 0 && arr[0].timestamp < cutoff) arr.shift()
  }

  private countRecent(timestamps: number[], windowMs: number): number {
    const cutoff = Date.now() - windowMs
    return timestamps.filter(t => t > cutoff).length
  }

  /**
   * 柔性推动状态转换 —— 只在优势足够时切换
   */
  private nudgeState(
    current: EmotionState,
    target: EmotionState,
    strength: number
  ): EmotionState {
    if (current === target) return current
    // strength > 0.5 才强制切换，否则保持原状态
    return strength > 0.5 ? target : current
  }
}

export const emotionContextAnalyzer = new EmotionContextAnalyzer()
