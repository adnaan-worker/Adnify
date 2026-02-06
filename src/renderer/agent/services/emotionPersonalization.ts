/**
 * 情绪个性化学习系统
 * 学习用户的行为模式，提供个性化的情绪检测和适配
 */

import type {
  PersonalPattern,
  UserFeedback,
  EmotionState,
  EmotionFactorType,
  BehaviorMetrics,
  EmotionDetection,
} from '../types/emotion'
import { logger } from '@utils/Logger'

class EmotionPersonalization {
  private pattern: PersonalPattern | null = null
  private feedbackHistory: UserFeedback[] = []
  private readonly FEEDBACK_HISTORY_LIMIT = 1000

  /**
   * 初始化个性化模式
   */
  initialize(userId: string): void {
    this.pattern = this.loadPattern(userId) || this.createDefaultPattern(userId)
    this.feedbackHistory = this.loadFeedbackHistory(userId)
    logger.agent.info('[EmotionPersonalization] Initialized for user:', userId)
  }

  /**
   * 记录用户反馈
   */
  recordFeedback(feedback: UserFeedback): void {
    this.feedbackHistory.push(feedback)
    
    // 限制历史记录大小
    if (this.feedbackHistory.length > this.FEEDBACK_HISTORY_LIMIT) {
      this.feedbackHistory.shift()
    }

    // 更新个性化模式
    this.updatePatternFromFeedback(feedback)
    
    // 保存
    this.saveFeedbackHistory()
    this.savePattern()
  }

  /**
   * 根据个性化模式调整检测结果
   */
  personalizeDetection(
    detection: EmotionDetection,
    metrics: BehaviorMetrics
  ): EmotionDetection {
    if (!this.pattern) return detection

    // 1. 调整因子权重
    const personalizedFactors = detection.factors.map(factor => {
      const personalWeight = this.pattern!.factorWeights[factor.type] || 1.0
      return {
        ...factor,
        weight: factor.weight * personalWeight,
      }
    })

    // 2. 考虑情绪转换概率
    const transitionProbability = this.getTransitionProbability(
      this.getLastState(),
      detection.state
    )
    
    // 如果转换概率很低，可能需要降低置信度
    let adjustedConfidence = detection.confidence
    if (transitionProbability < 0.1) {
      adjustedConfidence = detection.confidence * 0.8
    } else if (transitionProbability > 0.7) {
      adjustedConfidence = Math.min(detection.confidence * 1.1, 0.95)
    }

    // 3. 基于个人基准调整强度
    const baselineAdjustment = this.calculateBaselineAdjustment(metrics)
    const adjustedIntensity = Math.min(
      Math.max(detection.intensity + baselineAdjustment, 0),
      1
    )

    return {
      ...detection,
      intensity: adjustedIntensity,
      confidence: adjustedConfidence,
      factors: personalizedFactors,
    }
  }

  /**
   * 获取个人化的适配建议
   */
  getPersonalizedAdaptation(state: EmotionState): Partial<import('../types/emotion').EnvironmentAdaptation> {
    if (!this.pattern) return {}

    // 合并个人偏好和默认适配
    return {
      ...this.pattern.adaptationPreferences,
      // 可以根据状态进一步个性化
    }
  }

  /**
   * 预测用户可能需要的帮助
   */
  predictNeeds(state: EmotionState, metrics: BehaviorMetrics): string[] {
    if (!this.pattern) return []

    const needs: string[] = []

    // 基于历史反馈预测
    const similarFeedback = this.feedbackHistory.filter(
      f => f.detectedState === state && f.accuracy === 'incorrect'
    )

    if (similarFeedback.length > 3) {
      // 这个状态经常检测错误，可能需要特殊处理
      needs.push('这个状态可能需要更仔细的分析')
    }

    // 基于行为模式预测
    if (state === 'frustrated' && metrics.errorRate > 0.3) {
      needs.push('高错误率，可能需要代码审查')
    }

    if (state === 'tired' && metrics.activeTypingTime > 2 * 60 * 60 * 1000) {
      needs.push('长时间工作，建议休息')
    }

    return needs
  }

  // ===== 私有方法 =====

  private createDefaultPattern(userId: string): PersonalPattern {
    return {
      userId,
      baselineTypingSpeed: 40, // 默认40 WPM
      preferredWorkHours: [9, 10, 11, 14, 15, 16, 17], // 默认工作时间
      emotionTransitions: this.createDefaultTransitions(),
      factorWeights: this.createDefaultWeights(),
      adaptationPreferences: {},
      learnedTriggers: [],
    }
  }

  private createDefaultTransitions(): Record<EmotionState, Record<EmotionState, number>> {
    const states: EmotionState[] = ['focused', 'frustrated', 'tired', 'excited', 'bored', 'stressed', 'flow', 'neutral']
    const transitions: Record<EmotionState, Record<EmotionState, number>> = {} as any

    states.forEach(from => {
      transitions[from] = {} as Record<EmotionState, number>
      states.forEach(to => {
        // 默认转换概率（简化）
        if (from === to) {
          transitions[from][to] = 0.6 // 保持当前状态的概率
        } else {
          transitions[from][to] = 0.4 / (states.length - 1) // 平均分配
        }
      })
    })

    return transitions
  }

  private createDefaultWeights(): Record<EmotionFactorType, number> {
    return {
      typing_speed: 1.0,
      error_rate: 1.0,
      pause_duration: 1.0,
      code_complexity: 1.0,
      time_of_day: 1.0,
      session_duration: 1.0,
      tab_switching: 1.0,
      undo_redo_rate: 1.0,
      test_failure_rate: 1.0,
      save_frequency: 1.0,
      ai_interaction_pattern: 1.0,
      code_change_pattern: 1.0,
      git_activity: 1.0,
      error_context: 1.0,
      file_type_pattern: 1.0,
      search_pattern: 1.0,
    }
  }

  private updatePatternFromFeedback(feedback: UserFeedback): void {
    if (!this.pattern) return

    // 更新情绪转换概率
    const lastState = this.getLastState()
    if (lastState && feedback.userState) {
      const currentProb = this.pattern.emotionTransitions[lastState][feedback.userState] || 0
      // 简单移动平均更新
      this.pattern.emotionTransitions[lastState][feedback.userState] = currentProb * 0.9 + 0.1
      
      // 归一化
      const total = Object.values(this.pattern.emotionTransitions[lastState]).reduce((a, b) => a + b, 0)
      Object.keys(this.pattern.emotionTransitions[lastState]).forEach(key => {
        this.pattern.emotionTransitions[lastState][key as EmotionState] /= total
      })
    }

    // 如果反馈是"不正确"，可能需要调整因子权重
    if (feedback.accuracy === 'incorrect') {
      // 降低相关因子的权重（简化实现）
      // 实际应该分析哪些因子导致了错误检测
    }
  }

  private getTransitionProbability(from: EmotionState | null, to: EmotionState): number {
    if (!this.pattern || !from) return 0.5 // 默认概率
    return this.pattern.emotionTransitions[from][to] || 0.1
  }

  private getLastState(): EmotionState | null {
    if (this.feedbackHistory.length === 0) return null
    const last = this.feedbackHistory[this.feedbackHistory.length - 1]
    return last.userState || last.detectedState
  }

  private calculateBaselineAdjustment(metrics: BehaviorMetrics): number {
    if (!this.pattern) return 0

    // 如果打字速度远低于个人基准，可能强度需要调整
    const speedDiff = metrics.typingSpeed - this.pattern.baselineTypingSpeed
    const speedRatio = speedDiff / this.pattern.baselineTypingSpeed

    // 速度慢可能意味着疲劳或沮丧
    if (speedRatio < -0.3) return -0.1
    // 速度快可能意味着兴奋或专注
    if (speedRatio > 0.3) return 0.1

    return 0
  }

  private loadPattern(userId: string): PersonalPattern | null {
    try {
      const stored = localStorage.getItem(`emotion_pattern_${userId}`)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  }

  private savePattern(): void {
    if (!this.pattern) return
    try {
      localStorage.setItem(`emotion_pattern_${this.pattern.userId}`, JSON.stringify(this.pattern))
    } catch (error) {
      logger.agent.error('[EmotionPersonalization] Failed to save pattern:', error)
    }
  }

  private loadFeedbackHistory(userId: string): UserFeedback[] {
    try {
      const stored = localStorage.getItem(`emotion_feedback_${userId}`)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  }

  private saveFeedbackHistory(): void {
    if (!this.pattern) return
    try {
      localStorage.setItem(
        `emotion_feedback_${this.pattern.userId}`,
        JSON.stringify(this.feedbackHistory)
      )
    } catch (error) {
      logger.agent.error('[EmotionPersonalization] Failed to save feedback:', error)
    }
  }
}

export const emotionPersonalization = new EmotionPersonalization()
