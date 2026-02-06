/**
 * 情绪检测引擎 v3
 *
 * 三层检测架构：
 *  1. 行为指标（键盘/鼠标/停顿） → 基础评分
 *  2. 真实上下文（诊断/Git/AI 对话）→ 增强评分
 *  3. LLM 辅助分析（定期调用）→ 高置信度校准
 *
 * LLM 不会每个周期都调（太贵），但一旦有结果会混合进最终判断。
 */

import { logger } from '@utils/Logger'
import { EventBus } from '../core/EventBus'
import { emotionContextAnalyzer } from './emotionContextAnalyzer'
import { emotionLLMAnalyzer } from './emotionLLMAnalyzer'
import { emotionBaseline } from './emotionBaseline'
import type { LLMEmotionResult, BehaviorSummary } from './emotionLLMAnalyzer'
import type {
  EmotionState,
  EmotionDetection,
  EmotionFactor,
  BehaviorMetrics,
  EmotionHistory,
} from '../types/emotion'

// 检测窗口配置
const DETECTION_WINDOW = 12000   // 12秒分析窗口（比15s更快响应）
const SAMPLE_INTERVAL = 4000     // 每4秒采样一次指标
const METRICS_BUFFER_SIZE = 100
const HISTORY_LIMIT = 1440       // 保存24小时的历史

class EmotionDetectionEngine {
  private metricsBuffer: BehaviorMetrics[] = []
  private history: EmotionHistory[] = []
  private currentState: EmotionDetection | null = null
  private stateStartTime = Date.now()
  private _lastActivityTime = Date.now()

  // 定时器
  private typingTimer: NodeJS.Timeout | null = null
  private pauseTimer: NodeJS.Timeout | null = null
  private analysisTimer: NodeJS.Timeout | null = null
  private samplingTimer: NodeJS.Timeout | null = null

  // 运行状态
  private isRunning = false
  private isTyping = false
  private currentFile = ''
  private currentProject = ''

  // 实时计数器（在采样间隔内累积，每次采样时写入指标块）
  private liveCounters = {
    keystrokes: 0,
    backspaces: 0,
    cursorMoves: 0,
    copyPastes: 0,
    fileSwitches: 0,
    testRuns: 0,
    testFailures: 0,
  }

  // 事件监听器引用
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null
  private mousemoveHandler: (() => void) | null = null
  private blurHandler: (() => void) | null = null
  private focusHandler: (() => void) | null = null

  /**
   * 启动检测引擎（防重入）
   */
  start(): void {
    if (this.isRunning) return
    this.isRunning = true

    // 初始化上下文分析器（订阅 Store / EventBus）
    emotionContextAnalyzer.init()

    this.setupEventListeners()
    this.startSampling()
    this.startPeriodicAnalysis()

    // 立即发射初始状态，不让 UI 等
    this.emitInitialState()

    logger.agent.info('[EmotionEngine] Started (v2 — real data)')
  }

  /**
   * 停止检测引擎
   */
  stop(): void {
    if (!this.isRunning) return
    this.isRunning = false
    this.cleanup()
    emotionContextAnalyzer.destroy()
    logger.agent.info('[EmotionEngine] Stopped')
  }

  // ===== 记录方法（外部调用） =====

  recordKeystroke(key: string): void {
    this._lastActivityTime = Date.now()
    this.liveCounters.keystrokes++
    if (key === 'Backspace' || key === 'Delete') {
      this.liveCounters.backspaces++
    }
    this.handleTypingStart()
  }

  recordCursorMovement(): void {
    this.liveCounters.cursorMoves++
  }

  recordCopyPaste(): void {
    this.liveCounters.copyPastes++
  }

  recordFileSwitch(filePath: string): void {
    this.currentFile = filePath
    this.liveCounters.fileSwitches++
  }

  recordTestRun(failed: number, _total: number): void {
    this.liveCounters.testRuns++
    this.liveCounters.testFailures += failed
  }

  recordSave(): void {
    // 未来扩展
  }

  recordError(): void {
    // 未来扩展
  }

  getCurrentState(): EmotionDetection | null {
    return this.currentState
  }

  getHistory(duration: number = 24 * 60 * 60 * 1000): EmotionHistory[] {
    const cutoff = Date.now() - duration
    return this.history.filter(h => h.timestamp > cutoff)
  }

  getProductivityReport(): {
    focusTime: number
    flowSessions: number
    frustrationEpisodes: number
    breakRecommendations: number
    mostProductiveHour: number
  } {
    const dayHistory = this.getHistory(24 * 60 * 60 * 1000)

    const focusTime = dayHistory.filter(h =>
      h.state === 'focused' || h.state === 'flow'
    ).length * (DETECTION_WINDOW / 1000 / 60)

    let flowSessions = 0
    let inFlowSession = false
    for (const h of dayHistory) {
      if (h.state === 'flow' && !inFlowSession) {
        flowSessions++
        inFlowSession = true
      } else if (h.state !== 'flow') {
        inFlowSession = false
      }
    }

    const frustrationEpisodes = dayHistory.filter(h => h.state === 'frustrated').length
    const breakRecommendations = dayHistory.filter(h => h.state === 'tired').length

    const hourlyProductivity = new Array(24).fill(0)
    for (const h of dayHistory) {
      if (h.state === 'focused' || h.state === 'flow') {
        const hour = new Date(h.timestamp).getHours()
        hourlyProductivity[hour]++
      }
    }
    const mostProductiveHour = hourlyProductivity.indexOf(Math.max(...hourlyProductivity))

    return { focusTime, flowSessions, frustrationEpisodes, breakRecommendations, mostProductiveHour }
  }

  // ===== 私有方法 =====

  private setupEventListeners(): void {
    this.keydownHandler = (e: KeyboardEvent) => this.recordKeystroke(e.key)
    this.mousemoveHandler = () => { this._lastActivityTime = Date.now() }
    this.blurHandler = () => this.handlePause()
    this.focusHandler = () => { this._lastActivityTime = Date.now() }

    window.addEventListener('keydown', this.keydownHandler)
    window.addEventListener('mousemove', this.mousemoveHandler)
    window.addEventListener('blur', this.blurHandler)
    window.addEventListener('focus', this.focusHandler)
  }

  /**
   * 定期采样（每4秒创建一个指标快照）
   */
  private startSampling(): void {
    this.flushCountersToMetrics()

    this.samplingTimer = setInterval(() => {
      this.flushCountersToMetrics()
    }, SAMPLE_INTERVAL)
  }

  /**
   * 把实时计数器写入一个指标快照
   */
  private flushCountersToMetrics(): void {
    const metrics: BehaviorMetrics = {
      timestamp: Date.now(),
      typingSpeed: 0,
      errorRate: 0,
      activeTypingTime: this.isTyping ? Date.now() : 0,
      pauseDuration: this.getCurrentPauseDuration(),
      keystrokes: this.liveCounters.keystrokes,
      backspaceRate: this.liveCounters.backspaces,
      cursorMovement: this.liveCounters.cursorMoves,
      copyPasteCount: this.liveCounters.copyPastes,
      fileSwitches: this.liveCounters.fileSwitches,
      testRuns: this.liveCounters.testRuns,
      testFailures: this.liveCounters.testFailures,
    }

    this.metricsBuffer.push(metrics)
    if (this.metricsBuffer.length > METRICS_BUFFER_SIZE) {
      this.metricsBuffer.shift()
    }

    // 重置计数器
    this.liveCounters = {
      keystrokes: 0,
      backspaces: 0,
      cursorMoves: 0,
      copyPastes: 0,
      fileSwitches: 0,
      testRuns: 0,
      testFailures: 0,
    }
  }

  private pauseStartTime: number | null = null

  private getCurrentPauseDuration(): number {
    return this.pauseStartTime ? Date.now() - this.pauseStartTime : 0
  }

  private handleTypingStart(): void {
    this.isTyping = true
    this.pauseStartTime = null

    if (this.typingTimer) clearTimeout(this.typingTimer)

    this.typingTimer = setTimeout(() => {
      this.isTyping = false
      this.handlePause()
    }, 2000)
  }

  private handlePause(): void {
    this.pauseStartTime = Date.now()
  }

  private startPeriodicAnalysis(): void {
    if (this.analysisTimer) clearInterval(this.analysisTimer)

    this.analysisTimer = setInterval(() => {
      this.analyzeAndDetect()
    }, DETECTION_WINDOW)
  }

  /**
   * 启动时立即发射初始状态
   */
  private emitInitialState(): void {
    const detection: EmotionDetection = {
      state: 'neutral',
      intensity: 0.5,
      confidence: 0.3,
      triggeredAt: Date.now(),
      duration: 0,
      factors: [{
        type: 'session_duration',
        weight: 1,
        value: 0,
        description: 'Session just started',
      }],
      suggestions: ['欢迎回来！准备好开始高效编码了吗？'],
    }

    this.currentState = detection
    this.stateStartTime = Date.now()
    this.recordHistory(detection)

    EventBus.emit({ type: 'emotion:changed', emotion: detection })
  }

  /**
   * 核心分析流程 — 三层架构：行为 → 上下文 → LLM
   */
  private analyzeAndDetect(): void {
    const windowStart = Date.now() - DETECTION_WINDOW
    const recentMetrics = this.metricsBuffer.filter(m => m.timestamp > windowStart)

    if (recentMetrics.length === 0) return

    const aggregated = this.aggregateMetrics(recentMetrics)

    // —— 第 1 层：基于行为指标的基础检测 ——
    const baseDetection = this.detectEmotionFromBehavior(aggregated)

    // —— 第 2 层：从上下文分析器获取真实数据，增强检测 ——
    const context = emotionContextAnalyzer.analyzeContext()
    const enhanced = emotionContextAnalyzer.enhanceEmotionDetection(
      baseDetection.state,
      baseDetection.intensity,
      context
    )

    // —— 合并因子 ——
    const contextFactors = this.buildContextFactors(context)
    const allFactors = [...baseDetection.factors, ...contextFactors]

    let finalState = enhanced.state
    let finalIntensity = enhanced.intensity
    let finalConfidence = enhanced.confidence
    let finalSuggestions = enhanced.suggestions

    // —— 第 3 层：LLM 辅助（异步，不阻塞当前周期） ——
    // 构建行为摘要
    const behaviorSummary = this.buildBehaviorSummary(aggregated)

    // 先用上一次 LLM 结果混合（如果有）
    const lastLLM = emotionLLMAnalyzer.getLastResult()
    if (lastLLM) {
      const merged = this.mergeWithLLM(
        finalState, finalIntensity, finalConfidence, finalSuggestions,
        lastLLM,
      )
      finalState = merged.state
      finalIntensity = merged.intensity
      finalConfidence = merged.confidence
      finalSuggestions = merged.suggestions
    }

    const detection: EmotionDetection = {
      state: finalState,
      intensity: finalIntensity,
      confidence: finalConfidence,
      triggeredAt: Date.now(),
      duration: Date.now() - this.stateStartTime,
      factors: allFactors,
      context: context || undefined,
      suggestions: finalSuggestions.length > 0 ? finalSuggestions : undefined,
      llmReasoning: lastLLM?.reasoning,
    }

    // 始终更新 currentState
    const shouldBroadcast = this.shouldNotifyStateChange(detection)
    this.currentState = detection

    if (shouldBroadcast) {
      this.stateStartTime = Date.now()
      this.recordHistory(detection)
      EventBus.emit({ type: 'emotion:changed', emotion: detection })

      logger.agent.info('[EmotionEngine] State:', detection.state,
        `intensity=${detection.intensity.toFixed(2)}`,
        `confidence=${detection.confidence.toFixed(2)}`,
        `factors=${allFactors.length}`,
        `ctx=${context ? 'yes' : 'no'}`,
        lastLLM ? `llm=${lastLLM.state}` : 'llm=pending',
      )
    }

    // 异步触发 LLM 分析（不阻塞，结果在下一个周期生效）
    this.triggerLLMAnalysis(detection, context, behaviorSummary)
  }

  /**
   * 异步触发 LLM 分析（fire-and-forget）
   * LLM 结果会缓存在 emotionLLMAnalyzer 中，下一个分析周期会读到
   */
  private triggerLLMAnalysis(
    detection: EmotionDetection,
    context: ReturnType<typeof emotionContextAnalyzer.analyzeContext>,
    summary: BehaviorSummary,
  ): void {
    emotionLLMAnalyzer.analyze(detection, context, summary).then((result) => {
      if (result && this.isRunning) {
        // LLM 返回了新结果，立即用它修正当前状态并广播
        const merged = this.mergeWithLLM(
          this.currentState?.state || 'neutral',
          this.currentState?.intensity || 0.5,
          this.currentState?.confidence || 0.5,
          this.currentState?.suggestions || [],
          result,
        )

        const llmDetection: EmotionDetection = {
          ...this.currentState!,
          state: merged.state,
          intensity: merged.intensity,
          confidence: merged.confidence,
          suggestions: merged.suggestions.length > 0 ? merged.suggestions : undefined,
          triggeredAt: Date.now(),
        }

        const shouldBroadcast = this.shouldNotifyStateChange(llmDetection)
        this.currentState = llmDetection

        if (shouldBroadcast) {
          this.stateStartTime = Date.now()
          this.recordHistory(llmDetection)
          EventBus.emit({ type: 'emotion:changed', emotion: llmDetection })
          logger.agent.info('[EmotionEngine] LLM override →', merged.state,
            `conf=${merged.confidence.toFixed(2)}`,
            `reason: ${result.reasoning}`,
          )
        }
      }
    }).catch(() => {
      // 静默失败 — LLM 不可用不影响基础功能
    })
  }

  /**
   * 混合规则引擎结果与 LLM 结果
   *
   * 策略：
   *  - LLM 置信度高 → 以 LLM 为主
   *  - LLM 和规则引擎一致 → 提高整体置信度
   *  - LLM 和规则引擎不一致 → 选置信度更高的那个
   *  - LLM 的建议优先（更智能更具体）
   */
  private mergeWithLLM(
    ruleState: EmotionState,
    ruleIntensity: number,
    ruleConfidence: number,
    ruleSuggestions: string[],
    llm: LLMEmotionResult,
  ): { state: EmotionState; intensity: number; confidence: number; suggestions: string[] } {
    // 如果 LLM 和规则一致 → 信心大增
    if (llm.state === ruleState) {
      return {
        state: ruleState,
        intensity: (ruleIntensity * 0.4 + llm.intensity * 0.6),
        confidence: Math.min((ruleConfidence + llm.confidence) / 2 + 0.15, 0.98),
        suggestions: llm.suggestion ? [llm.suggestion] : ruleSuggestions,
      }
    }

    // 不一致 — 看谁置信度更高
    if (llm.confidence > ruleConfidence + 0.1) {
      // LLM 明显更有信心 → 采用 LLM
      return {
        state: llm.state,
        intensity: llm.intensity,
        confidence: llm.confidence,
        suggestions: llm.suggestion ? [llm.suggestion] : ruleSuggestions,
      }
    }

    // 规则引擎信心更高或差不多 → 保持规则结果，但用 LLM 的建议
    return {
      state: ruleState,
      intensity: (ruleIntensity * 0.6 + llm.intensity * 0.4),
      confidence: ruleConfidence,
      suggestions: llm.suggestion ? [llm.suggestion, ...ruleSuggestions.slice(0, 1)] : ruleSuggestions,
    }
  }

  /**
   * 从聚合指标构建 LLM 需要的行为摘要
   */
  private buildBehaviorSummary(aggregated: BehaviorMetrics): BehaviorSummary {
    return {
      windowMinutes: DETECTION_WINDOW / 1000 / 60,
      avgTypingSpeed: aggregated.typingSpeed,
      backspaceRate: aggregated.errorRate,
      totalKeystrokes: aggregated.keystrokes,
      pauseDurationSec: aggregated.pauseDuration / 1000,
      fileSwitches: aggregated.fileSwitches,
      sessionMinutes: (Date.now() - this.stateStartTime) / 1000 / 60,
      copyPasteCount: aggregated.copyPasteCount,
    }
  }

  /**
   * 根据真实上下文生成额外的 EmotionFactor
   */
  private buildContextFactors(context: ReturnType<typeof emotionContextAnalyzer.analyzeContext>): EmotionFactor[] {
    if (!context) return []
    const factors: EmotionFactor[] = []

    // 诊断错误因子
    if (context.hasErrors) {
      const diagErrors = emotionContextAnalyzer.getRecentDiagnosticErrors(15 * 60 * 1000)
      factors.push({
        type: 'error_context',
        weight: 0.3,
        value: Math.min(diagErrors.errors / 5, 1),
        description: `${diagErrors.errors} errors, ${diagErrors.warnings} warnings (LSP)`,
      })
    }

    // AI 交互因子
    if (context.aiInteractions.count > 0) {
      factors.push({
        type: 'ai_interaction_pattern',
        weight: 0.2,
        value: Math.min(context.aiInteractions.count / 10, 1),
        description: `${context.aiInteractions.count} AI interactions, avg ${(context.aiInteractions.avgResponseTime / 1000).toFixed(1)}s`,
      })
    }

    // Git 状态因子
    if (context.gitStatus && context.gitStatus !== 'clean') {
      factors.push({
        type: 'git_activity',
        weight: context.gitStatus === 'conflict' ? 0.35 : 0.15,
        value: context.gitStatus === 'conflict' ? 1.0 : 0.5,
        description: `Git: ${context.gitStatus}`,
      })
    }

    // 文件类型因子
    factors.push({
      type: 'file_type_pattern',
      weight: 0.1,
      value: context.fileType === 'test' ? 0.7 : context.fileType === 'config' ? 0.5 : 0.3,
      description: `File: ${context.fileType} (${context.currentFile.split('/').pop()})`,
    })

    // 文件切换/搜索因子
    if (context.searchQueries > 3) {
      factors.push({
        type: 'search_pattern',
        weight: 0.15,
        value: Math.min(context.searchQueries / 10, 1),
        description: `${context.searchQueries} file switches (15min)`,
      })
    }

    // 代码复杂度因子
    if (context.codeComplexity > 0.3) {
      factors.push({
        type: 'code_complexity',
        weight: 0.15,
        value: context.codeComplexity,
        description: `Complexity: ${(context.codeComplexity * 100).toFixed(0)}%`,
      })
    }

    return factors
  }

  private aggregateMetrics(metrics: BehaviorMetrics[]): BehaviorMetrics {
    if (metrics.length === 0) {
      return this.createEmptyMetrics()
    }

    const sum = (key: keyof BehaviorMetrics) =>
      metrics.reduce((acc, m) => acc + (m[key] as number), 0)

    const totalKeystrokes = sum('keystrokes')
    const timeSpanMs = metrics.length > 1
      ? metrics[metrics.length - 1].timestamp - metrics[0].timestamp
      : SAMPLE_INTERVAL
    const timeSpanMin = Math.max(timeSpanMs / 1000 / 60, 0.01)
    const typingSpeed = (totalKeystrokes / 5) / timeSpanMin

    const totalBackspaces = sum('backspaceRate')
    const errorRate = totalKeystrokes > 0 ? totalBackspaces / totalKeystrokes : 0

    const lastPause = metrics[metrics.length - 1].pauseDuration

    return {
      timestamp: Date.now(),
      typingSpeed: Math.min(typingSpeed, 150),
      errorRate,
      activeTypingTime: sum('activeTypingTime'),
      pauseDuration: lastPause,
      keystrokes: totalKeystrokes,
      backspaceRate: totalBackspaces,
      cursorMovement: sum('cursorMovement'),
      copyPasteCount: sum('copyPasteCount'),
      fileSwitches: sum('fileSwitches'),
      testRuns: sum('testRuns'),
      testFailures: sum('testFailures'),
    }
  }

  private createEmptyMetrics(): BehaviorMetrics {
    return {
      timestamp: Date.now(), typingSpeed: 0, errorRate: 0,
      activeTypingTime: 0, pauseDuration: 0, keystrokes: 0,
      backspaceRate: 0, cursorMovement: 0, copyPasteCount: 0,
      fileSwitches: 0, testRuns: 0, testFailures: 0,
    }
  }

  /**
   * 基于行为指标的基础情绪检测
   */
  private detectEmotionFromBehavior(metrics: BehaviorMetrics): EmotionDetection {
    const factors: EmotionFactor[] = []
    const scores: Record<EmotionState, number> = {
      // neutral 基线提高 — 需要多个信号同时触发才能打败 neutral
      focused: 0, frustrated: 0, tired: 0, excited: 0,
      bored: 0, stressed: 0, flow: 0, neutral: 0.55,
    }

    // 记录基线样本（持续学习）
    const windowMin = DETECTION_WINDOW / 1000 / 60
    emotionBaseline.recordSample(
      metrics.typingSpeed,
      metrics.errorRate,
      metrics.fileSwitches / Math.max(windowMin, 0.1),
    )

    // 获取相对于个人基线的偏差
    const relative = emotionBaseline.getRelativeMetrics(
      metrics.typingSpeed,
      metrics.errorRate,
      metrics.fileSwitches / Math.max(windowMin, 0.1),
    )

    // === 判断用户是否在"阅读/思考"状态 ===
    // 鼠标有移动 or 最近有文件切换 → 在阅读代码，不是真正的"停顿"
    const recentMouseActivity = Date.now() - this._lastActivityTime < 15_000
    const isReading = metrics.typingSpeed < 5 && recentMouseActivity

    // 1. 打字速度 — 如果有基线，用偏差；否则用绝对值
    let typingSpeedScore: number
    if (relative.calibrated) {
      typingSpeedScore = clampScore((relative.typingSpeedDeviation + 1) / 2)
    } else {
      typingSpeedScore = this.normalizeTypingSpeed(metrics.typingSpeed)
    }
    factors.push({
      type: 'typing_speed', weight: 0.3, value: typingSpeedScore,
      description: relative.calibrated
        ? `${metrics.typingSpeed.toFixed(0)} WPM (${relative.typingSpeedDeviation > 0 ? '+' : ''}${relative.typingSpeedDeviation.toFixed(1)}σ)`
        : `${metrics.typingSpeed.toFixed(0)} WPM`,
    })

    // 没打字不等于负面 — 阅读时不惩罚 focused/flow
    if (metrics.typingSpeed > 5) {
      scores.focused   += typingSpeedScore * 0.7
      scores.excited   += typingSpeedScore * 0.9
      scores.flow      += typingSpeedScore * 0.8
    } else if (isReading) {
      // 在阅读代码 — 仍可能 focused，给适度分
      scores.focused += 0.3
      scores.neutral += 0.1
    }
    scores.tired     -= typingSpeedScore * 0.3
    scores.bored     -= typingSpeedScore * 0.4

    // 个性化加成：打字速度比自己平时慢很多 → 更倾向 frustrated/tired
    if (relative.calibrated && relative.typingSpeedDeviation < -1.5) {
      scores.frustrated += 0.25
      scores.tired += 0.15
    }

    // 2. 错误率（退格）
    let errorRateScore: number
    if (relative.calibrated && relative.backspaceRateDeviation > 0.5) {
      errorRateScore = clampScore(metrics.errorRate + relative.backspaceRateDeviation * 0.15)
    } else {
      errorRateScore = metrics.errorRate
    }
    factors.push({
      type: 'error_rate', weight: 0.25, value: errorRateScore,
      description: relative.calibrated
        ? `Backspace: ${(metrics.errorRate * 100).toFixed(0)}% (${relative.backspaceRateDeviation > 0 ? '↑' : '→'})`
        : `Backspace: ${(metrics.errorRate * 100).toFixed(0)}%`,
    })
    scores.frustrated += errorRateScore * 0.8
    scores.tired      += errorRateScore * 0.2   // 退格对 tired 影响减弱
    scores.stressed   += errorRateScore * 0.5
    scores.focused    -= errorRateScore * 0.3
    scores.flow       -= errorRateScore * 0.4

    // 3. 停顿 — 关键修复：只有"真正的发呆"才是 tired 信号
    //    短停顿（<20s）或鼠标活跃 = 在思考/阅读，不算 tired
    const pauseScore = Math.min(metrics.pauseDuration / 30000, 1)
    factors.push({
      type: 'pause_duration', weight: 0.15, value: pauseScore,
      description: `Pause: ${(metrics.pauseDuration / 1000).toFixed(0)}s`,
    })
    if (isReading) {
      // 在阅读 — 停顿是正常的，不加 tired
      scores.focused += pauseScore * 0.15  // 看代码也是专注的一种
    } else if (metrics.pauseDuration > 20_000 && !recentMouseActivity) {
      // 真正的发呆（>20s 且没有鼠标活动）
      scores.tired  += pauseScore * 0.35
      scores.bored  += pauseScore * 0.3
    }
    scores.flow -= pauseScore * 0.3  // flow 需要持续输出，停顿减分合理

    // 4. 文件切换
    let tabSwitchScore: number
    if (relative.calibrated && relative.fileSwitchDeviation > 1) {
      tabSwitchScore = clampScore(Math.min(metrics.fileSwitches / 3, 1) + relative.fileSwitchDeviation * 0.1)
    } else {
      tabSwitchScore = Math.min(metrics.fileSwitches / 3, 1)
    }
    factors.push({
      type: 'tab_switching', weight: 0.15, value: tabSwitchScore,
      description: `Tab switches: ${metrics.fileSwitches}`,
    })
    if (metrics.fileSwitches >= 4) {
      // 频繁切换 → 压力 / 忙碌
      scores.stressed += tabSwitchScore * 0.6
      scores.focused  -= tabSwitchScore * 0.3
    } else if (metrics.fileSwitches >= 1) {
      // 少量切换 → 正常浏览代码
      scores.focused += 0.1
    }
    scores.flow -= tabSwitchScore * 0.4

    // 5. 工作时长 — 只有超过 45 分钟才开始累积 tired
    const sessionDuration = Date.now() - this.stateStartTime
    const sessionMin = sessionDuration / 1000 / 60
    const sessionScore = sessionMin > 45
      ? Math.min((sessionMin - 45) / 75, 1)  // 45~120 分钟线性增长
      : 0
    factors.push({
      type: 'session_duration', weight: 0.1, value: sessionScore,
      description: `${sessionMin.toFixed(0)}min`,
    })
    scores.tired += sessionScore * 0.4
    if (sessionMin > 15 && sessionMin < 60) {
      scores.flow += 0.15  // 15-60 分钟是 flow 的黄金窗口
    }

    // 6. 时间段
    const hour = new Date().getHours()
    const isUnusualHour = relative.calibrated ? !relative.isActiveHour : (hour < 6 || hour > 22)
    const timeScore = isUnusualHour ? 0.8 : 0
    factors.push({
      type: 'time_of_day', weight: 0.05, value: timeScore,
      description: relative.calibrated
        ? `${hour}:00 ${isUnusualHour ? '(非常用时段)' : ''}`
        : `${hour}:00`,
    })
    // 只有非常用时段才给 tired 加分，正常时段不加
    scores.tired += timeScore * 0.3

    // 7. 活跃度 — 只有真正的完全空闲才判 bored/tired
    const idleDuration = Date.now() - this._lastActivityTime
    if (idleDuration > 120_000) {
      // 2 分钟完全无操作 → 可能走开了
      scores.bored += 0.3
      scores.tired += 0.2
      scores.focused -= 0.2
      scores.flow -= 0.4
    } else if (idleDuration > 60_000) {
      // 1 分钟无操作 → 可能在思考，轻微影响
      scores.bored += 0.1
    }

    // 找出最高分
    let detectedState: EmotionState = 'neutral'
    let maxScore = scores.neutral
    for (const [state, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score
        detectedState = state as EmotionState
      }
    }

    const intensity = Math.min(Math.max(maxScore, 0), 1)
    const confidence = Math.min(factors.length / 4, 1) * (0.4 + intensity * 0.4)

    return {
      state: detectedState,
      intensity,
      confidence,
      triggeredAt: Date.now(),
      duration: Date.now() - this.stateStartTime,
      factors,
    }
  }

  private normalizeTypingSpeed(wpm: number): number {
    if (wpm < 10) return 0.1
    if (wpm < 20) return 0.2
    if (wpm < 40) return 0.4
    if (wpm < 60) return 0.6
    if (wpm < 80) return 0.8
    return 1.0
  }

  private shouldNotifyStateChange(newDetection: EmotionDetection): boolean {
    if (!this.currentState) return true
    if (this.currentState.state !== newDetection.state) return true
    // 同一状态下，强度变化超过 0.12 也通知
    return Math.abs(this.currentState.intensity - newDetection.intensity) > 0.12
  }

  private recordHistory(detection: EmotionDetection): void {
    this.history.push({
      timestamp: detection.triggeredAt,
      state: detection.state,
      intensity: detection.intensity,
      project: this.currentProject,
      file: this.currentFile,
    })
    if (this.history.length > HISTORY_LIMIT) {
      this.history.shift()
    }
  }

  private cleanup(): void {
    if (this.typingTimer) { clearTimeout(this.typingTimer); this.typingTimer = null }
    if (this.pauseTimer) { clearInterval(this.pauseTimer); this.pauseTimer = null }
    if (this.analysisTimer) { clearInterval(this.analysisTimer); this.analysisTimer = null }
    if (this.samplingTimer) { clearInterval(this.samplingTimer); this.samplingTimer = null }

    if (this.keydownHandler) { window.removeEventListener('keydown', this.keydownHandler); this.keydownHandler = null }
    if (this.mousemoveHandler) { window.removeEventListener('mousemove', this.mousemoveHandler); this.mousemoveHandler = null }
    if (this.blurHandler) { window.removeEventListener('blur', this.blurHandler); this.blurHandler = null }
    if (this.focusHandler) { window.removeEventListener('focus', this.focusHandler); this.focusHandler = null }
  }
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export const emotionDetectionEngine = new EmotionDetectionEngine()
