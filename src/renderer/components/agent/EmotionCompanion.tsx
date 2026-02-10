/**
 * 情绪伙伴（Companion）v4
 *
 * 变化：
 *  - 订阅 emotion:changed，展示上下文建议 + 可操作按钮
 *  - 每条消息底部有 👍/👎 反馈按钮（存储到 emotionFeedback）
 *  - 规则引擎 + 上下文分析器直接产出建议，无 LLM 依赖
 */

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ThumbsUp, ThumbsDown, Coffee, Sparkles, AlertTriangle } from 'lucide-react'
import { EventBus } from '@/renderer/agent/core/EventBus'
import { emotionFeedback } from '@/renderer/agent/services/emotionFeedback'
import { getRecommendedActions } from '@/renderer/agent/services/emotionActions'
import type { EmotionState, EmotionDetection } from '@/renderer/agent/types/emotion'
import type { EmotionActionDef } from '@/renderer/agent/services/emotionActions'
import { useStore } from '@store'
import { t } from '@/renderer/i18n'

interface CompanionMessage {
  id: string
  text: string
  type: 'encouragement' | 'suggestion' | 'warning' | 'break'
  state: EmotionState
  priority: number
  dismissable: boolean
  actions?: Array<{
    label: string
    emoji?: string
    icon?: React.ReactNode
    onClick: () => void
  }>
  /** 是否显示反馈按钮 */
  showFeedback?: boolean
}

// 冷却时间
const COOLDOWN: Record<CompanionMessage['type'], number> = {
  encouragement: 10 * 60 * 1000,
  suggestion: 5 * 60 * 1000,
  warning: 2 * 60 * 1000,
  break: 20 * 60 * 1000,
}

// 自动消失时间
const AUTO_DISMISS: Record<CompanionMessage['type'], number> = {
  encouragement: 6000,
  suggestion: 10000,
  warning: 15000,
  break: 20000,
}

const TYPE_STYLES: Record<CompanionMessage['type'], {
  borderColor: string
  iconColor: string
  bgAccent: string
  icon: React.ReactNode
}> = {
  encouragement: {
    borderColor: 'border-green-500/20',
    iconColor: 'text-green-400',
    bgAccent: 'bg-green-500/5',
    icon: <Sparkles className="w-4 h-4" />,
  },
  suggestion: {
    borderColor: 'border-blue-500/20',
    iconColor: 'text-blue-400',
    bgAccent: 'bg-blue-500/5',
    icon: <Sparkles className="w-4 h-4" />,
  },
  warning: {
    borderColor: 'border-orange-500/20',
    iconColor: 'text-orange-400',
    bgAccent: 'bg-orange-500/5',
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  break: {
    borderColor: 'border-purple-500/20',
    iconColor: 'text-purple-400',
    bgAccent: 'bg-purple-500/5',
    icon: <Coffee className="w-4 h-4" />,
  },
}

export const EmotionCompanion: React.FC = () => {
  const { language } = useStore()
  const [activeMessage, setActiveMessage] = useState<CompanionMessage | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [feedbackGiven, setFeedbackGiven] = useState(false)
  const lastMessageTimeRef = useRef<Record<string, number>>({})
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null)
  const shownMessagesRef = useRef<Set<string>>(new Set())
  const prevEmotionStateRef = useRef<EmotionState>('neutral')
  const activeMessageRef = useRef<CompanionMessage | null>(null)
  const dismissFadeTimerRef = useRef<NodeJS.Timeout | null>(null)

  const dismiss = useCallback(() => {
    setIsVisible(false)
    if (dismissFadeTimerRef.current) clearTimeout(dismissFadeTimerRef.current)
    dismissFadeTimerRef.current = setTimeout(() => {
      setActiveMessage(null)
      activeMessageRef.current = null
      setFeedbackGiven(false)
    }, 300)
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  const showMessage = useCallback((msg: CompanionMessage) => {
    const lastTime = lastMessageTimeRef.current[msg.type] || 0
    const cooldown = COOLDOWN[msg.type]
    if (Date.now() - lastTime < cooldown) return

    const msgKey = `${msg.state}:${msg.text}`
    if (shownMessagesRef.current.has(msgKey)) return

    const current = activeMessageRef.current
    if (current && current.priority > msg.priority) {
      return
    }

    activeMessageRef.current = msg
    setActiveMessage(msg)
    setIsVisible(true)
    setFeedbackGiven(false)
    lastMessageTimeRef.current[msg.type] = Date.now()
    shownMessagesRef.current.add(msgKey)

    if (shownMessagesRef.current.size > 50) {
      const entries = Array.from(shownMessagesRef.current)
      shownMessagesRef.current = new Set(entries.slice(-25))
    }

    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    dismissTimerRef.current = setTimeout(dismiss, AUTO_DISMISS[msg.type])
  }, [dismiss])

  /**
   * 把 EmotionActionDef 转换成 CompanionMessage action
   */
  const buildActionButtons = useCallback((
    emotionActions: EmotionActionDef[],
    onDismiss: () => void,
  ): CompanionMessage['actions'] => {
    return emotionActions.map(a => ({
      label: a.label,
      emoji: a.emoji,
      onClick: () => {
        a.execute()
        onDismiss()
      },
    }))
  }, [])

  useEffect(() => {
    // ===== 1. 订阅 emotion:changed — 上下文建议 + 可操作按钮 =====
    const unsubChanged = EventBus.on('emotion:changed', (event) => {
      const detection: EmotionDetection = event.emotion
      if (!detection || detection.state === 'flow') return

      const prevState = prevEmotionStateRef.current
      prevEmotionStateRef.current = detection.state

      // 获取可操作按钮（规则推荐）
      const emotionActions = getRecommendedActions(detection)

      // 有上下文建议 + 状态变化 → 显示建议消息
      if (detection.suggestions && detection.suggestions.length > 0 && prevState !== detection.state) {
        showMessage({
          id: `ctx-${Date.now()}`,
          text: detection.suggestions[0],
          type: detection.state === 'frustrated' || detection.state === 'stressed' ? 'warning' : 'suggestion',
          state: detection.state,
          priority: 5,
          dismissable: true,
          showFeedback: true,
          actions: buildActionButtons(emotionActions, dismiss),
        })
      }
    })

    // ===== 2. emotion:message =====
    const unsubMessage = EventBus.on('emotion:message', (event) => {
      if (event.state === 'flow') return
      showMessage({
        id: `emotion-${Date.now()}`,
        text: event.message,
        type: event.state === 'frustrated' || event.state === 'stressed' ? 'suggestion' : 'encouragement',
        state: event.state,
        priority: event.state === 'frustrated' ? 6 : 3,
        dismissable: true,
        showFeedback: true,
      })
    })

    // ===== 3. 休息提醒 =====
    const unsubBreakMicro = EventBus.on('break:micro', (event) => {
      showMessage({
        id: `break-micro-${Date.now()}`,
        text: event.message,
        type: 'break',
        state: 'tired',
        priority: 4,
        dismissable: true,
        actions: [{
          label: t('emotion.companion.ok', language),
          icon: <ThumbsUp className="w-3 h-3" />,
          onClick: dismiss,
        }],
      })
    })

    const unsubBreakSuggested = EventBus.on('break:suggested', (event) => {
      showMessage({
        id: `break-${Date.now()}`,
        text: event.message,
        type: 'break',
        state: 'tired',
        priority: 7,
        dismissable: true,
        actions: [
          { label: t('emotion.companion.takeBreak', language), icon: <Coffee className="w-3 h-3" />, onClick: dismiss },
          { label: t('emotion.companion.later', language), icon: <ThumbsDown className="w-3 h-3" />, onClick: dismiss },
        ],
      })
    })

    return () => {
      unsubChanged()
      unsubMessage()
      unsubBreakMicro()
      unsubBreakSuggested()
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
      if (dismissFadeTimerRef.current) clearTimeout(dismissFadeTimerRef.current)
    }
  }, [showMessage, dismiss, buildActionButtons, language])

  // ===== 反馈处理 =====
  const handleFeedback = useCallback((accurate: boolean) => {
    if (!activeMessage || feedbackGiven) return
    emotionFeedback.recordFeedback(
      activeMessage.state,
      accurate ? 'accurate' : 'inaccurate',
    )
    setFeedbackGiven(true)
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    dismissTimerRef.current = setTimeout(dismiss, 2000)
  }, [activeMessage, feedbackGiven, dismiss])

  const style = activeMessage ? TYPE_STYLES[activeMessage.type] : TYPE_STYLES.encouragement

  return (
    <AnimatePresence>
      {isVisible && activeMessage && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="fixed bottom-14 right-6 z-[200] max-w-[360px]"
        >
          <div className={`
            bg-background-secondary/95 backdrop-blur-xl
            border ${style.borderColor}
            rounded-2xl shadow-2xl
            overflow-hidden
          `}>
            <div className="p-4">
              <div className="flex items-start gap-3">
                {/* 图标 */}
                <div className={`mt-0.5 ${style.iconColor} flex-shrink-0`}>
                  {style.icon}
                </div>

                {/* 主消息 */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary leading-relaxed">
                    {activeMessage.text}
                  </p>
                </div>

                {/* 关闭 */}
                {activeMessage.dismissable && (
                  <button
                    onClick={dismiss}
                    className="text-text-muted hover:text-text-primary transition-colors p-0.5 rounded-lg hover:bg-white/5 -mt-0.5 -mr-0.5 flex-shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* 操作按钮行 */}
              {activeMessage.actions && activeMessage.actions.length > 0 && (
                <div className="flex items-center gap-2 mt-3 pl-7">
                  {activeMessage.actions.map((action, i) => (
                    <button
                      key={i}
                      onClick={action.onClick}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                        bg-white/5 hover:bg-white/10 text-text-secondary hover:text-text-primary
                        transition-all border border-white/5 hover:border-white/10"
                    >
                      {action.emoji && <span>{action.emoji}</span>}
                      {action.icon}
                      {action.label}
                    </button>
                  ))}
                </div>
              )}

              {/* 反馈行 */}
              {activeMessage.showFeedback && (
                <div className="flex items-center gap-2 mt-3 pl-7 pt-2 border-t border-white/5">
                  {feedbackGiven ? (
                    <span className="text-[10px] text-text-muted">
                      {t('emotion.companion.feedbackThanks', language)}
                    </span>
                  ) : (
                    <>
                      <span className="text-[10px] text-text-muted mr-1">{t('emotion.companion.feedbackQuestion', language)}</span>
                      <button
                        onClick={() => handleFeedback(true)}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px]
                          bg-white/5 hover:bg-green-500/10 text-text-muted hover:text-green-400
                          transition-all"
                      >
                        <ThumbsUp className="w-3 h-3" />
                        {t('emotion.companion.accurate', language)}
                      </button>
                      <button
                        onClick={() => handleFeedback(false)}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px]
                          bg-white/5 hover:bg-red-500/10 text-text-muted hover:text-red-400
                          transition-all"
                      >
                        <ThumbsDown className="w-3 h-3" />
                        {t('emotion.companion.inaccurate', language)}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 进度条 */}
            <motion.div
              className="h-0.5 bg-white/10"
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{
                duration: AUTO_DISMISS[activeMessage.type] / 1000,
                ease: 'linear',
              }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
