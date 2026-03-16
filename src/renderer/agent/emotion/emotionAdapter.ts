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
  /** 当前正在播放的音频源 */
  private currentAudioSource: AudioBufferSourceNode | HTMLAudioElement | null = null
  /** 当前音频的增益节点 */
  private currentGainNode: GainNode | null = null

  /**
   * 初始化适配器（防重入）
   */
  initialize(): void {
    // 如果已经初始化，直接返回
    if (this.unsubscribeEmotionChanged) {
      return
    }

    // 环境音效已禁用：启动时先停掉任何可能残留的背景音
    this.stopAmbientSound()

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

  /** 环境音效功能已禁用，暂不开发 */
  private readonly AMBIENT_SOUND_ENABLED = false

  private applySoundAdaptation(_sound: EnvironmentAdaptation['sound']): void {
    this.stopAmbientSound()
    // 环境音效已关闭，不再调用任何播放逻辑
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

  private showEmotionAwareness(_detection: EmotionDetection): void {
    // 通过 toast 或内联提示显示情绪检测
  }

  // 获取情绪对应的 toast 类型
  // private getEmotionVariant(state: EmotionState): string {...}

  // ===== 环境音效 =====

  /**
   * 轻音乐资源 URL ！！！待定开发！！！
   */
  private readonly MUSIC_URLS: Record<'focus' | 'relax' | 'energize', string[]> = {
    focus: [
      // 专注音乐 - 使用 Lofi 或 Ambient 风格
      // 示例：可以使用 Pixabay 或其他免费资源
      // 如果网络资源不可用，会自动回退到生成的白噪音
    ],
    relax: [
      // 放松音乐 - 自然声音或冥想音乐
    ],
    energize: [
      // 激励音乐 - 轻快的背景音乐
    ],
  }

  /**
   * 获取音乐 URL（支持从设置中读取用户配置）
   */
  // @ts-ignore: Unused method
  private _getMusicUrl(type: 'focus' | 'relax' | 'energize'): string | null {
    const urls = this.MUSIC_URLS[type]
    // 优先使用第一个 URL，如果没有则返回 null（会使用回退方案）
    return urls && urls.length > 0 ? urls[0] : null
  }

  /**
   * 加载并播放网络音频（环境音效已关闭，此方法不再播放）
   */
  // @ts-ignore: Unused method
  private async _loadAndPlayAudio(url: string, volume: number): Promise<void> {
    if (!this.AMBIENT_SOUND_ENABLED) return
    try {
      // 使用 HTMLAudioElement 播放（更简单，支持网络资源）
      const audio = new Audio(url)
      audio.loop = true
      audio.volume = volume * 0.3 // 降低音量，更舒适
      audio.preload = 'auto'

      // 淡入效果
      audio.volume = 0
      await audio.play()

      // 淡入动画
      const fadeInDuration = 2000 // 2秒
      const startTime = Date.now()
      const targetVolume = volume * 0.3

      const fadeInterval = setInterval(() => {
        const elapsed = Date.now() - startTime
        if (elapsed >= fadeInDuration) {
          audio.volume = targetVolume
          clearInterval(fadeInterval)
        } else {
          audio.volume = (elapsed / fadeInDuration) * targetVolume
        }
      }, 50)

      this.currentAudioSource = audio
      this.currentGainNode = null // HTMLAudioElement 不使用 GainNode

      // 错误处理
      audio.addEventListener('error', () => {
        logger.agent.warn('[EmotionAdapter] Audio load failed, falling back to generated sound:', url)
        // 如果网络音频加载失败，可以回退到生成的音效
        this.playFallbackSound(volume)
      })

    } catch (error) {
      logger.agent.error('[EmotionAdapter] Failed to play audio:', error)
      // 回退到生成的音效
      this.playFallbackSound(volume)
    }
  }

  /**
   * 回退方案：如果网络音频加载失败，使用生成的音效（环境音效已关闭，此方法不再播放）
   */
  private playFallbackSound(volume: number): void {
    if (!this.AMBIENT_SOUND_ENABLED) return
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      }

      // 生成简单的白噪音（比之前的正弦波更自然）
      const bufferSize = this.audioContext.sampleRate * 2
      const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate)
      const data = buffer.getChannelData(0)

      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1
      }

      const source = this.audioContext.createBufferSource()
      const gainNode = this.audioContext.createGain()
      const filter = this.audioContext.createBiquadFilter()

      source.buffer = buffer
      source.loop = true
      filter.type = 'lowpass'
      filter.frequency.value = 2000
      gainNode.gain.value = volume * 0.05

      source.connect(filter)
      filter.connect(gainNode)
      gainNode.connect(this.audioContext.destination)
      source.start(0)

      this.currentAudioSource = source
      this.currentGainNode = gainNode
    } catch (error) {
      logger.agent.error('[EmotionAdapter] Fallback sound failed:', error)
    }
  }

  // @ts-ignore: Unused method
  private async _playAmbientSound(
    _type: 'focus' | 'relax' | 'energize' | 'none',
    _volume: number
  ): Promise<void> {
    // 环境音效已关闭：只停止、不播放
    this.stopAmbientSound()
  }

  private stopAmbientSound(): void {
    // 停止 HTMLAudioElement
    if (this.currentAudioSource instanceof HTMLAudioElement) {
      try {
        // 淡出效果
        const audio = this.currentAudioSource
        const fadeOutDuration = 1000 // 1秒
        const startVolume = audio.volume
        const startTime = Date.now()

        const fadeInterval = setInterval(() => {
          const elapsed = Date.now() - startTime
          if (elapsed >= fadeOutDuration) {
            audio.volume = 0
            audio.pause()
            audio.src = ''
            clearInterval(fadeInterval)
            this.currentAudioSource = null
          } else {
            audio.volume = startVolume * (1 - elapsed / fadeOutDuration)
          }
        }, 50)
      } catch (error) {
        // 忽略错误
        this.currentAudioSource = null
      }
    }
    // 停止 AudioBufferSourceNode
    else if (this.currentAudioSource instanceof AudioBufferSourceNode) {
      try {
        if (this.currentGainNode && this.audioContext) {
          // 淡出效果
          this.currentGainNode.gain.linearRampToValueAtTime(
            0,
            this.audioContext.currentTime + 1
          )
          setTimeout(() => {
            try {
              if (this.currentAudioSource instanceof AudioBufferSourceNode) {
                this.currentAudioSource.stop()
              }
            } catch { /* already stopped */ }
            this.currentAudioSource = null
            this.currentGainNode = null
          }, 1100)
        } else {
          try {
            if (this.currentAudioSource instanceof AudioBufferSourceNode) {
              this.currentAudioSource.stop()
            }
          } catch { /* already stopped */ }
          this.currentAudioSource = null
        }
      } catch (error) {
        this.currentAudioSource = null
        this.currentGainNode = null
      }
    }

    // 清理 AudioContext（如果不再需要）
    if (this.audioContext && !this.currentAudioSource) {
      try {
        this.audioContext.close().catch(() => { })
      } catch { /* ignore */ }
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
