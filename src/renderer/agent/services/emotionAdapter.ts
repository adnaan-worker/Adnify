/**
 * 情绪环境适配服务
 * 根据情绪状态自动调整编辑器环境
 */

import { EventBus } from '../core/EventBus'
import { logger } from '@utils/Logger'
import type {
  EmotionState,
  EmotionDetection,
  EnvironmentAdaptation,
} from '../types/emotion'

// 默认适配配置
const DEFAULT_ADAPTATIONS: Record<EmotionState, EnvironmentAdaptation> = {
  focused: {
    theme: {
      id: 'adnify-dark',
      brightness: 'normal',
      accentColor: '#3b82f6',
    },
    ui: {
      notifications: 'minimal',
      animationSpeed: 'normal',
      fontSize: 14,
      lineHeight: 1.5,
    },
    ai: {
      proactivity: 'suggestive',
      tone: 'neutral',
      suggestionFrequency: 'medium',
    },
    sound: {
      enabled: false,
      volume: 0,
      type: 'none',
    },
    break: {
      suggestBreak: false,
      breakInterval: 90 * 60 * 1000, // 90分钟
      microBreaks: false,
    },
  },
  
  frustrated: {
    theme: {
      id: 'adnify-dark',
      brightness: 'dim',
      accentColor: '#f97316', // 温暖的橙色
    },
    ui: {
      notifications: 'disabled',
      animationSpeed: 'slow',
      fontSize: 15, // 稍大字体减少压力
      lineHeight: 1.6,
    },
    ai: {
      proactivity: 'active',
      tone: 'encouraging',
      suggestionFrequency: 'high',
    },
    sound: {
      enabled: true,
      volume: 0.3,
      type: 'relax',
    },
    break: {
      suggestBreak: true,
      breakInterval: 15 * 60 * 1000, // 15分钟建议休息
      microBreaks: true,
    },
  },
  
  tired: {
    theme: {
      id: 'adnify-dark',
      brightness: 'dim', // 降低亮度
      accentColor: '#8b5cf6', // 柔和的紫色
    },
    ui: {
      notifications: 'disabled',
      animationSpeed: 'slow',
      fontSize: 16, // 更大字体
      lineHeight: 1.7,
    },
    ai: {
      proactivity: 'active',
      tone: 'encouraging',
      suggestionFrequency: 'low', // 减少干扰
    },
    sound: {
      enabled: true,
      volume: 0.2,
      type: 'energize',
    },
    break: {
      suggestBreak: true,
      breakInterval: 30 * 60 * 1000, // 30分钟
      microBreaks: true,
    },
  },
  
  excited: {
    theme: {
      id: 'adnify-dark',
      brightness: 'bright',
      accentColor: '#22c55e', // 明亮的绿色
    },
    ui: {
      notifications: 'normal',
      animationSpeed: 'fast',
      fontSize: 14,
      lineHeight: 1.5,
    },
    ai: {
      proactivity: 'passive', // 不打扰创意
      tone: 'neutral',
      suggestionFrequency: 'low',
    },
    sound: {
      enabled: true,
      volume: 0.4,
      type: 'focus',
    },
    break: {
      suggestBreak: false,
      breakInterval: 120 * 60 * 1000,
      microBreaks: false,
    },
  },
  
  bored: {
    theme: {
      id: 'cyberpunk',
      brightness: 'bright',
      accentColor: '#ec4899', // 鲜艳的粉色
    },
    ui: {
      notifications: 'normal',
      animationSpeed: 'fast',
      fontSize: 14,
      lineHeight: 1.5,
    },
    ai: {
      proactivity: 'active',
      tone: 'encouraging',
      suggestionFrequency: 'high', // 多给建议
    },
    sound: {
      enabled: true,
      volume: 0.5,
      type: 'energize',
    },
    break: {
      suggestBreak: true,
      breakInterval: 45 * 60 * 1000,
      microBreaks: true,
    },
  },
  
  stressed: {
    theme: {
      id: 'midnight',
      brightness: 'dim',
      accentColor: '#06b6d4', // 冷静的青色
    },
    ui: {
      notifications: 'disabled',
      animationSpeed: 'slow',
      fontSize: 15,
      lineHeight: 1.6,
    },
    ai: {
      proactivity: 'active',
      tone: 'direct',
      suggestionFrequency: 'medium',
    },
    sound: {
      enabled: true,
      volume: 0.25,
      type: 'relax',
    },
    break: {
      suggestBreak: true,
      breakInterval: 20 * 60 * 1000,
      microBreaks: true,
    },
  },
  
  flow: {
    theme: {
      id: 'adnify-dark',
      brightness: 'normal',
      accentColor: '#6366f1', // 靛蓝
    },
    ui: {
      notifications: 'disabled', // 完全无干扰
      animationSpeed: 'normal',
      fontSize: 14,
      lineHeight: 1.5,
    },
    ai: {
      proactivity: 'passive', // 绝不打扰
      tone: 'neutral',
      suggestionFrequency: 'low',
    },
    sound: {
      enabled: true,
      volume: 0.3,
      type: 'focus',
    },
    break: {
      suggestBreak: false, // 不打扰心流
      breakInterval: 150 * 60 * 1000, // 2.5小时
      microBreaks: true, // 但建议微休息
    },
  },
  
  neutral: {
    theme: {
      id: 'adnify-dark',
      brightness: 'normal',
      accentColor: '#3b82f6',
    },
    ui: {
      notifications: 'normal',
      animationSpeed: 'normal',
      fontSize: 14,
      lineHeight: 1.5,
    },
    ai: {
      proactivity: 'suggestive',
      tone: 'neutral',
      suggestionFrequency: 'medium',
    },
    sound: {
      enabled: false,
      volume: 0,
      type: 'none',
    },
    break: {
      suggestBreak: true,
      breakInterval: 60 * 60 * 1000,
      microBreaks: true,
    },
  },
}

// 情绪对应的提示消息
const EMOTION_MESSAGES: Record<EmotionState, string[]> = {
  focused: [
    '保持专注，你正在高效工作 💪',
    '良好的节奏，继续保持',
    '专注模式已启动',
  ],
  frustrated: [
    '遇到困难了吗？深呼吸，一步步来 🌱',
    '每个 bug 都是成长的机会',
    '需要我帮你分析一下吗？',
    '休息一下，换个思路可能会更好',
  ],
  tired: [
    '看起来有点累了，喝杯水休息一下吧 ☕',
    '长时间工作会降低效率，建议休息',
    '你的眼睛需要放松了，看看远处',
  ],
  excited: [
    '充满能量！保持这个状态 🚀',
    '灵感爆发时刻，记录下来',
    '创造力满满，继续保持！',
  ],
  bored: [
    '看起来有点无聊，试试重构这段代码？ 🤔',
    '要不要尝试一个新的实现方式？',
    '休息一下，做点有趣的事情',
  ],
  stressed: [
    '压力有点大，深呼吸放松一下 🧘',
    '优先级排序，一件一件来',
    '你已经做得很好了，不要给自己太大压力',
    '需要我帮你整理一下思路吗？',
  ],
  flow: [
    '进入心流状态，享受编码的乐趣 ✨',
    '完美的心流，继续保持',
    '你正在创造伟大的代码',
  ],
  neutral: [],
}

class EmotionAdapter {
  private currentAdaptation: EnvironmentAdaptation | null = null
  private breakTimer: NodeJS.Timeout | null = null
  private microBreakTimer: NodeJS.Timeout | null = null
  private audioContext: AudioContext | null = null
  private unsubscribeEmotionChanged: (() => void) | null = null
  /** 跟踪所有待执行的 setTimeout，cleanup 时统一清理 */
  private pendingTimeouts: NodeJS.Timeout[] = []
  /** 当前正在播放的 oscillator 引用 */
  private currentOscillator: OscillatorNode | null = null

  /**
   * 初始化适配器（防重入）
   */
  initialize(): void {
    // 如果已经初始化，直接返回
    if (this.unsubscribeEmotionChanged) {
      return
    }

    // 订阅情绪变化事件
    this.unsubscribeEmotionChanged = EventBus.on('emotion:changed', (event) => {
      if (event.emotion) {
        this.adaptToEmotion(event.emotion)
      }
    })

    logger.agent.info('[EmotionAdapter] Initialized')
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    // 取消事件订阅
    if (this.unsubscribeEmotionChanged) {
      this.unsubscribeEmotionChanged()
      this.unsubscribeEmotionChanged = null
    }

    // 清理定时器
    if (this.breakTimer) {
      clearInterval(this.breakTimer)
      this.breakTimer = null
    }
    if (this.microBreakTimer) {
      clearInterval(this.microBreakTimer)
      this.microBreakTimer = null
    }

    // 清理所有待执行的 setTimeout（消息延迟发送、音频自动停止等）
    for (const t of this.pendingTimeouts) clearTimeout(t)
    this.pendingTimeouts = []

    // 停止环境音
    this.stopAmbientSound()

    logger.agent.info('[EmotionAdapter] Cleaned up')
  }

  /**
   * 根据情绪适配环境
   */
  adaptToEmotion(detection: EmotionDetection): void {
    const adaptation = DEFAULT_ADAPTATIONS[detection.state]
    this.currentAdaptation = adaptation

    // 应用各项适配
    this.applyThemeAdaptation(adaptation.theme)
    this.applyUIAdaptation(adaptation.ui)
    this.applyAIAdaptation(adaptation.ai, detection)
    this.applySoundAdaptation(adaptation.sound)
    this.setupBreakReminders(adaptation.break, detection.state)

    // 显示情绪感知提示
    this.showEmotionAwareness(detection)

    logger.agent.info('[EmotionAdapter] Adapted to:', detection.state)
  }

  /**
   * 手动应用特定情绪的适配
   */
  forceAdapt(state: EmotionState): void {
    const mockDetection: EmotionDetection = {
      state,
      intensity: 0.8,
      confidence: 1,
      triggeredAt: Date.now(),
      duration: 0,
      factors: [],
    }
    this.adaptToEmotion(mockDetection)
  }

  // ===== 私有适配方法 =====

  private applyThemeAdaptation(theme: EnvironmentAdaptation['theme']): void {
    // 切换主题（简化实现）
    // const store = useStore.getState()

    // 应用亮度调整（通过 CSS 变量）
    const root = document.documentElement
    const brightnessMap = {
      dim: '0.85',
      normal: '1',
      bright: '1.1',
    }
    root.style.setProperty('--editor-brightness', brightnessMap[theme.brightness])
    
    // 设置强调色
    root.style.setProperty('--custom-accent', theme.accentColor)
  }

  private applyUIAdaptation(ui: EnvironmentAdaptation['ui']): void {
    // 字体大小（简化实现）
    // const store = useStore.getState()

    // 动画速度（通过 CSS 变量）
    const root = document.documentElement
    const speedMap = {
      slow: '0.5s',
      normal: '0.2s',
      fast: '0.1s',
    }
    root.style.setProperty('--transition-duration', speedMap[ui.animationSpeed])

    // 通知设置（简化实现）
    // store.updateSettings?.({
    //   notifications: ui.notifications,
    // })
  }

  private applyAIAdaptation(
    _ai: EnvironmentAdaptation['ai'],
    detection: EmotionDetection
  ): void {
    const state = detection.state

    // 心流 / 中性状态不发消息
    if (state === 'neutral' || state === 'flow') return

    // 优先使用上下文分析器产生的真实建议
    const contextSuggestions = detection.suggestions || []
    if (contextSuggestions.length > 0) {
      const t = setTimeout(() => {
        EventBus.emit({
          type: 'emotion:message',
          message: contextSuggestions[0],
          state,
        })
      }, 2000)
      this.pendingTimeouts.push(t)
      return
    }

    // 没有上下文建议时退回到通用消息
    const messages = EMOTION_MESSAGES[state]
    if (messages.length > 0) {
      const randomIndex = Math.floor(Math.random() * messages.length)
      const message = messages[randomIndex]
      const t = setTimeout(() => {
        EventBus.emit({
          type: 'emotion:message',
          message,
          state,
        })
      }, 3000)
      this.pendingTimeouts.push(t)
    }
  }

  private applySoundAdaptation(sound: EnvironmentAdaptation['sound']): void {
    if (!sound.enabled || !sound.type || sound.type === 'none') {
      this.stopAmbientSound()
      return
    }

    // 播放环境音（如果需要）
    this.playAmbientSound(sound.type, sound.volume)
  }

  private setupBreakReminders(
    breakConfig: EnvironmentAdaptation['break'],
    state: EmotionState
  ): void {
    // 清除之前的计时器
    if (this.breakTimer) {
      clearInterval(this.breakTimer)
      this.breakTimer = null
    }
    if (this.microBreakTimer) {
      clearInterval(this.microBreakTimer)
      this.microBreakTimer = null
    }

    if (!breakConfig.suggestBreak) return

    // 设置微休息提醒（每20分钟）
    if (breakConfig.microBreaks) {
      this.microBreakTimer = setInterval(() => {
        EventBus.emit({
          type: 'break:micro',
          message: '眼睛疲劳了吗？看看远处20秒 👀',
        })
      }, 20 * 60 * 1000)
    }

    // 设置正式休息提醒
    this.breakTimer = setInterval(() => {
      const messages: Record<EmotionState, string> = {
        focused: '你已经专注工作很久了，起来活动一下吧 🚶',
        frustrated: '卡住了？休息一下可能会有新思路 💡',
        tired: '该休息一下了，充电后效率会更高 ⚡',
        excited: '保持热情的同时也要注意休息哦 ☕',
        bored: '休息一下吧，做点有趣的事情 🎮',
        stressed: '压力大时更要休息，深呼吸放松一下 🧘',
        flow: '心流很美好，但也记得照顾好身体 🌿',
        neutral: '工作一段时间了，休息一下吧 ☕',
      }

      // 休息建议
      EventBus.emit({
        type: 'break:suggested',
        message: messages[state],
      })
    }, breakConfig.breakInterval)
  }

  private showEmotionAwareness(detection: EmotionDetection): void {
    // 通过 toast 或内联提示显示情绪检测
    const emotionLabels: Record<EmotionState, string> = {
      focused: '专注模式',
      frustrated: '检测到沮丧',
      tired: '检测到疲劳',
      excited: '能量满满',
      bored: '检测到无聊',
      stressed: '检测到压力',
      flow: '心流状态',
      neutral: '工作模式',
    }

    // 简化 toast 提示
    console.log(`[Emotion] ${emotionLabels[detection.state]} - 强度: ${Math.round(detection.intensity * 100)}%`)
  }

  // 获取情绪对应的 toast 类型
  // private getEmotionVariant(state: EmotionState): string {...}

  // ===== 环境音效 =====

  private async playAmbientSound(
    type: 'focus' | 'relax' | 'energize' | 'none',
    volume: number
  ): Promise<void> {
    if (!type || type === 'none') {
      this.stopAmbientSound()
      return
    }

    // 先停掉之前的，避免堆积
    this.stopCurrentOscillator()

    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      }

      const oscillator = this.audioContext.createOscillator()
      const gainNode = this.audioContext.createGain()

      const frequencies: Record<string, number> = {
        focus: 432,
        relax: 528,
        energize: 639,
      }

      oscillator.frequency.value = frequencies[type] || 432
      oscillator.type = 'sine'
      gainNode.gain.value = volume * 0.1

      oscillator.connect(gainNode)
      gainNode.connect(this.audioContext.destination)
      oscillator.start()

      // 保存引用，以便清理
      this.currentOscillator = oscillator

      // 5 分钟后自动停止（tracked）
      const t = setTimeout(() => {
        this.stopCurrentOscillator()
      }, 5 * 60 * 1000)
      this.pendingTimeouts.push(t)

    } catch (error) {
      logger.agent.error('[EmotionAdapter] Failed to play sound:', error)
    }
  }

  private stopCurrentOscillator(): void {
    if (this.currentOscillator) {
      try { this.currentOscillator.stop() } catch { /* already stopped */ }
      this.currentOscillator = null
    }
  }

  private stopAmbientSound(): void {
    this.stopCurrentOscillator()
    if (this.audioContext) {
      try { this.audioContext.close() } catch { /* ignore */ }
      this.audioContext = null
    }
  }

  /**
   * 获取当前适配配置
   */
  getCurrentAdaptation(): EnvironmentAdaptation | null {
    return this.currentAdaptation
  }
}

export const emotionAdapter = new EmotionAdapter()
