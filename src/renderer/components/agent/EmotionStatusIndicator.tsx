/**
 * StatusBar 情绪指示器
 * 始终可见的小组件：一个呼吸灯 + 悬停展开详情
 * 设计原则：不打扰，但一眼能看到当前状态
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { emotionDetectionEngine } from '@/renderer/agent/services/emotionDetectionEngine'
import { useStore } from '@store'
import { t } from '@/renderer/i18n'
import { Sparkles, ThumbsUp, ThumbsDown, Coffee } from 'lucide-react'
import { EventBus } from '@/renderer/agent/core/EventBus'
import { emotionFeedback } from '@/renderer/agent/services/emotionFeedback'
import { getRecommendedActions } from '@/renderer/agent/services/emotionActions'
import type { EmotionState, EmotionDetection } from '@/renderer/agent/types/emotion'
import type { EmotionActionDef } from '@/renderer/agent/services/emotionActions'
import { useEmotionState } from '@/renderer/hooks/useEmotionState'
import { EMOTION_META, EMOTION_STATUS_MESSAGE_KEYS } from '@/renderer/agent/emotion'

// Companion Message Types (ported from EmotionCompanion)
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
  showFeedback?: boolean
}

const AUTO_DISMISS: Record<CompanionMessage['type'], number> = {
  encouragement: 12000,
  suggestion: 20000,
  warning: 30000,
  break: 40000,
}
const COOLDOWN: Record<CompanionMessage['type'], number> = {
  encouragement: 10 * 60 * 1000,
  suggestion: 5 * 60 * 1000,
  warning: 2 * 60 * 1000,
  break: 20 * 60 * 1000,
}

const EMOTION_MESSAGES = EMOTION_STATUS_MESSAGE_KEYS

export const EmotionStatusIndicator: React.FC = () => {
  const { language } = useStore()
  const emotion = useEmotionState()

  // Base Tooltip State
  const [isHovered, setIsHovered] = useState(false)
  const [justChanged, setJustChanged] = useState(false)
  const [messageIndex, setMessageIndex] = useState(0)

  // State Notice & Companion Merger State
  const [activeMessage, setActiveMessage] = useState<CompanionMessage | null>(null)
  const [feedbackGiven, setFeedbackGiven] = useState(false)

  const prevStateRef = useRef<EmotionState>('neutral')
  const lastNoticeTimeRef = useRef(Date.now())

  const lastMessageTimeRef = useRef<Record<string, number>>({})
  const shownMessagesRef = useRef<Set<string>>(new Set())
  const activeMessageRef = useRef<CompanionMessage | null>(null)
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null)

  const clearMessageTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  const dismissActiveMessage = useCallback(() => {
    setActiveMessage(null)
    activeMessageRef.current = null
    setFeedbackGiven(false)
    clearMessageTimer()
  }, [clearMessageTimer])

  const showMessage = useCallback((msg: CompanionMessage) => {
    const lastTime = lastMessageTimeRef.current[msg.type] || 0
    const cooldown = COOLDOWN[msg.type]
    if (Date.now() - lastTime < cooldown) return

    const msgKey = `${msg.state}:${msg.text}`
    if (shownMessagesRef.current.has(msgKey)) return

    const current = activeMessageRef.current
    if (current && current.priority > msg.priority) return

    activeMessageRef.current = msg
    setActiveMessage(msg)
    setFeedbackGiven(false)
    lastMessageTimeRef.current[msg.type] = Date.now()
    shownMessagesRef.current.add(msgKey)

    if (shownMessagesRef.current.size > 50) {
      const entries = Array.from(shownMessagesRef.current)
      shownMessagesRef.current = new Set(entries.slice(-25))
    }

    clearMessageTimer()
    dismissTimerRef.current = setTimeout(dismissActiveMessage, AUTO_DISMISS[msg.type])
  }, [dismissActiveMessage, clearMessageTimer])

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
    emotionDetectionEngine.start()
  }, [])

  useEffect(() => {
    if (!emotion) return
    const newState = emotion.state

    // Base Notification Logic (was in EmotionStatusIndicator & StateNotice)
    if (prevStateRef.current !== newState) {
      setJustChanged(true)
      setMessageIndex(0)

      const timer = setTimeout(() => setJustChanged(false), 8000)

      // If significant, trigger rules engine / actions (from Companion logic)
      if (newState !== 'flow' && prevStateRef.current !== newState) {
        const detection: EmotionDetection = emotion as EmotionDetection
        const emotionActions = getRecommendedActions(detection)

        if (detection.suggestions && detection.suggestions.length > 0) {
          showMessage({
            id: `ctx-${Date.now()}`,
            text: detection.suggestions[0],
            type: newState === 'frustrated' || newState === 'stressed' ? 'warning' : 'suggestion',
            state: newState,
            priority: 5,
            dismissable: true,
            showFeedback: true,
            actions: buildActionButtons(emotionActions, dismissActiveMessage),
          })
        }
      }
      prevStateRef.current = newState
      lastNoticeTimeRef.current = Date.now()

      return () => clearTimeout(timer)
    }
  }, [emotion, showMessage, buildActionButtons, dismissActiveMessage])

  // Event Subscriptions
  useEffect(() => {
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
          onClick: dismissActiveMessage,
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
          { label: t('emotion.companion.takeBreak', language), icon: <Coffee className="w-3 h-3" />, onClick: dismissActiveMessage },
          { label: t('emotion.companion.later', language), icon: <ThumbsDown className="w-3 h-3" />, onClick: dismissActiveMessage },
        ],
      })
    })

    return () => {
      unsubMessage()
      unsubBreakMicro()
      unsubBreakSuggested()
      clearMessageTimer()
    }
  }, [showMessage, language, dismissActiveMessage, clearMessageTimer])

  // 轮播消息 (Only if no active message popups are taking precedence)
  useEffect(() => {
    if (!emotion || emotion.state === 'neutral' || activeMessage) return

    const messages = EMOTION_MESSAGES[emotion.state]
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length)
    }, 6000)

    return () => clearInterval(interval)
  }, [emotion?.state, activeMessage])

  const state = emotion?.state || 'neutral'
  const meta = EMOTION_META[state]
  const intensity = emotion?.intensity ?? 0.5
  const label = t(meta.translationKey, language)
  const messages = EMOTION_MESSAGES[state]
  const currentMessageKey = messages[messageIndex]

  const handleClick = useCallback(() => {
    if (activeMessage) {
      dismissActiveMessage()
      return
    }
    if (!emotion || emotion.state === 'neutral') return
    const messages = EMOTION_MESSAGES[emotion.state]
    setMessageIndex((prev) => (prev + 1) % messages.length)
  }, [emotion, activeMessage, dismissActiveMessage])

  const handleFeedback = useCallback((accurate: boolean) => {
    if (!activeMessage || feedbackGiven) return
    emotionFeedback.recordFeedback(activeMessage.state, accurate ? 'accurate' : 'inaccurate')
    setFeedbackGiven(true)
    clearMessageTimer()
    dismissTimerRef.current = setTimeout(dismissActiveMessage, 2000)
  }, [activeMessage, feedbackGiven, clearMessageTimer, dismissActiveMessage])

  return (
    <div
      className="relative flex items-center h-full gap-2"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 呼吸灯本体 / 灵动胶囊 */}
      <button
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all duration-500 ease-out group relative overflow-hidden ${activeMessage
          ? 'bg-surface/80 backdrop-blur-md shadow-lg border border-white/10'
          : justChanged
            ? 'bg-surface/50 backdrop-blur-sm border border-white/5'
            : 'hover:bg-white/5 border border-transparent'
          }`}
      >
        {/* 背景渐变光晕 (ActiveMessage 时) */}
        {activeMessage && (
          <motion.div
            className="absolute inset-0 opacity-20 pointer-events-none"
            animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
            transition={{ duration: 5, ease: 'linear', repeat: Infinity }}
            style={{
              background: `linear-gradient(90deg, transparent, ${meta.color}, transparent)`,
              backgroundSize: '200% 100%'
            }}
          />
        )}
        {/* 呼吸灯圆点 & 背景光晕 */}
        <div className="relative flex-shrink-0">
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: meta.color }}
            animate={{
              scale: [1, 1.8, 1],
              opacity: [0.4, 0, 0.4],
            }}
            transition={{ duration: meta.pulseSpeed, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="w-2.5 h-2.5 rounded-full relative z-10"
            style={{ backgroundColor: meta.color }}
            animate={justChanged || activeMessage ? { scale: [1, 1.5, 1] } : { opacity: [0.7, 1, 0.7] }}
            transition={justChanged || activeMessage ? { duration: 0.5, type: 'spring' } : { duration: meta.pulseSpeed, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        {/* 状态文字 / 伙伴消息提示（动态灵动岛展开） */}
        <AnimatePresence mode="wait">
          {activeMessage ? (
            <motion.div
              key="active-message"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="overflow-hidden whitespace-nowrap pl-0.5 pr-1 flex items-center gap-1.5 relative z-10"
            >
              <span className="text-[11px] font-medium text-text-primary drop-shadow-sm">
                {activeMessage.text}
              </span>
              {/* 交互提示箭头 */}
              <motion.div
                animate={{ x: [0, 3, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                className="opacity-50 text-[9px] font-bold"
                style={{ color: meta.color }}
              >
                ›
              </motion.div>
            </motion.div>
          ) : (justChanged || isHovered) ? (
            <motion.div
              key="status-text"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="overflow-hidden whitespace-nowrap pl-0.5 pr-1 text-[10px] font-medium relative z-10"
              style={{ color: meta.color }}
            >
              {meta.emoji} {label}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </button>

      {/* 普通提示消息（如果没有高优 Companion 消息） */}
      {!activeMessage && emotion && emotion.state !== 'neutral' && (isHovered || justChanged) && (
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          className="flex items-center gap-2 px-2 py-1 rounded-md bg-background-secondary/95 backdrop-blur-sm border border-white/10 max-w-[200px]"
          onClick={handleClick}
          style={{ cursor: 'pointer' }}
        >
          <AnimatePresence mode="wait">
            <motion.span
              key={messageIndex}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.2 }}
              className="text-[10px] text-text-secondary leading-relaxed truncate"
            >
              {t(currentMessageKey as any, language)}
            </motion.span>
          </AnimatePresence>
          {emotion.suggestions && emotion.suggestions.length > 0 && (
            <Sparkles className="w-3 h-3 text-accent flex-shrink-0" />
          )}
        </motion.div>
      )}

      {/* 悬停详情卡片 (或主动弹出的强提醒框) */}
      <AnimatePresence>
        {(isHovered || (activeMessage && activeMessage.priority >= 4)) && emotion && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[200]"
          >
            <div className="bg-background-secondary/95 backdrop-blur-xl border border-white/10 rounded-xl p-3 shadow-2xl min-w-[200px]">
              {/* 标题行 */}
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                <span className="text-sm font-medium text-text-primary">
                  {meta.emoji} {label}
                </span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full ml-auto"
                  style={{
                    backgroundColor: `${meta.color}20`,
                    color: meta.color,
                  }}
                >
                  {Math.round(intensity * 100)}%
                </span>
              </div>

              {/* 强度条 */}
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mb-2">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: meta.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${intensity * 100}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>

              {/* 影响因素 */}
              {emotion.factors.length > 0 && !activeMessage && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {emotion.factors.slice(0, 3).map((f, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted">
                      {f.description}
                    </span>
                  ))}
                </div>
              )}

              {/* 建议与行动 (如果有 Companion Message，展示高级操作区) */}
              {activeMessage ? (
                <div className="mt-3 pt-3 border-t border-white/5 flex flex-col gap-2">
                  <p className="text-[11px] text-text-primary leading-relaxed font-medium">
                    {activeMessage.text}
                  </p>

                  {activeMessage.actions && activeMessage.actions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {activeMessage.actions.map((action, i) => (
                        <button
                          key={i}
                          onClick={action.onClick}
                          className="flex items-center gap-1 px-2 py-1.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-text-secondary hover:text-text-primary transition-colors border border-white/5 shadow-sm"
                        >
                          {action.emoji && <span>{action.emoji}</span>}
                          {action.icon && React.cloneElement(action.icon as React.ReactElement, { className: 'w-3 h-3' })}
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {activeMessage.showFeedback && (
                    <div className="flex items-center gap-2 mt-1">
                      {feedbackGiven ? (
                        <span className="text-[9px] text-text-muted">{t('emotion.companion.feedbackThanks', language)}</span>
                      ) : (
                        <>
                          <span className="text-[9px] text-text-muted">{t('emotion.companion.feedbackQuestion', language)}</span>
                          <button onClick={() => handleFeedback(true)} className="p-1 rounded bg-white/5 hover:bg-green-500/10 text-text-muted hover:text-green-400 transition-colors">
                            <ThumbsUp className="w-2.5 h-2.5" />
                          </button>
                          <button onClick={() => handleFeedback(false)} className="p-1 rounded bg-white/5 hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-colors">
                            <ThumbsDown className="w-2.5 h-2.5" />
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* 倒计时进度条 */}
                  <motion.div
                    className="h-[2px] w-full bg-white/10 rounded-full mt-1 overflow-hidden"
                  >
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: meta.color }}
                      initial={{ width: '100%' }}
                      animate={{ width: '0%' }}
                      transition={{ duration: AUTO_DISMISS[activeMessage.type] / 1000, ease: 'linear' }}
                    />
                  </motion.div>
                </div>
              ) : (
                emotion.suggestions && emotion.suggestions.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/5">
                    <p className="text-[10px] text-text-muted italic">
                      💡 {emotion.suggestions[0]}
                    </p>
                  </div>
                )
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
