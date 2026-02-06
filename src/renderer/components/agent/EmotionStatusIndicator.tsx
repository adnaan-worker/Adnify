/**
 * StatusBar 情绪指示器
 * 始终可见的小组件：一个呼吸灯 + 悬停展开详情
 * 设计原则：不打扰，但一眼能看到当前状态
 */

import React, { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { EventBus } from '@/renderer/agent/core/EventBus'
import { emotionDetectionEngine } from '@/renderer/agent/services/emotionDetectionEngine'
import type { EmotionState, EmotionDetection } from '@/renderer/agent/types/emotion'
import { useStore } from '@store'
import { t } from '@/renderer/i18n'
import { Sparkles } from 'lucide-react'

const EMOTION_META: Record<EmotionState, {
  color: string
  emoji: string
  pulseSpeed: number  // 呼吸速度，越快越激烈
  translationKey: string
}> = {
  focused:    { color: '#3b82f6', emoji: '⚡', pulseSpeed: 2.5, translationKey: 'emotion.state.focused' },
  frustrated: { color: '#f97316', emoji: '😤', pulseSpeed: 1.2, translationKey: 'emotion.state.frustrated' },
  tired:      { color: '#8b5cf6', emoji: '😴', pulseSpeed: 4.0, translationKey: 'emotion.state.tired' },
  excited:    { color: '#22c55e', emoji: '🚀', pulseSpeed: 0.8, translationKey: 'emotion.state.excited' },
  bored:      { color: '#6b7280', emoji: '😐', pulseSpeed: 3.5, translationKey: 'emotion.state.bored' },
  stressed:   { color: '#06b6d4', emoji: '😰', pulseSpeed: 1.0, translationKey: 'emotion.state.stressed' },
  flow:       { color: '#6366f1', emoji: '✨', pulseSpeed: 2.0, translationKey: 'emotion.state.flow' },
  neutral:    { color: '#94a3b8', emoji: '💻', pulseSpeed: 3.0, translationKey: 'emotion.state.neutral' },
}

const EMOTION_MESSAGES: Record<EmotionState, string[]> = {
  focused: ['emotion.status.focused.1', 'emotion.status.focused.2', 'emotion.status.focused.3'],
  frustrated: ['emotion.status.frustrated.1', 'emotion.status.frustrated.2', 'emotion.status.frustrated.3'],
  tired: ['emotion.status.tired.1', 'emotion.status.tired.2', 'emotion.status.tired.3'],
  excited: ['emotion.status.excited.1', 'emotion.status.excited.2', 'emotion.status.excited.3'],
  bored: ['emotion.status.bored.1', 'emotion.status.bored.2', 'emotion.status.bored.3'],
  stressed: ['emotion.status.stressed.1', 'emotion.status.stressed.2', 'emotion.status.stressed.3'],
  flow: ['emotion.status.flow.1', 'emotion.status.flow.2', 'emotion.status.flow.3'],
  neutral: ['emotion.status.neutral.1', 'emotion.status.neutral.2', 'emotion.status.neutral.3'],
}

export const EmotionStatusIndicator: React.FC = () => {
  const { language } = useStore()
  const [emotion, setEmotion] = useState<EmotionDetection | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [justChanged, setJustChanged] = useState(false)
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    // 初始化检测引擎
    emotionDetectionEngine.start()

    const unsubscribe = EventBus.on('emotion:changed', (event) => {
      setEmotion(event.emotion)
      // 状态变化时闪烁提示
      setJustChanged(true)
      setMessageIndex(0) // 重置消息索引
      setTimeout(() => setJustChanged(false), 3000)
    })

    // 获取初始状态
    setEmotion(emotionDetectionEngine.getCurrentState())

    return () => {
      unsubscribe()
    }
  }, [])

  // 轮播消息
  useEffect(() => {
    if (!emotion || emotion.state === 'neutral') return

    const messages = EMOTION_MESSAGES[emotion.state]
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length)
    }, 6000) // 每6秒切换一次

    return () => clearInterval(interval)
  }, [emotion])

  const state = emotion?.state || 'neutral'
  const meta = EMOTION_META[state]
  const intensity = emotion?.intensity ?? 0.5
  const label = t(meta.translationKey as any, language)
  const messages = EMOTION_MESSAGES[state]
  const currentMessageKey = messages[messageIndex]

  const handleClick = useCallback(() => {
    if (!emotion || emotion.state === 'neutral') return
    const messages = EMOTION_MESSAGES[emotion.state]
    setMessageIndex((prev) => (prev + 1) % messages.length)
  }, [emotion])

  return (
    <div
      className="relative flex items-center h-full gap-2"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 呼吸灯本体 */}
      <button className="flex items-center gap-1.5 px-2 py-1 rounded-full hover:bg-white/5 transition-all group">
        {/* 呼吸灯圆点 */}
        <div className="relative">
          {/* 外圈光晕 */}
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: meta.color }}
            animate={{
              scale: [1, 1.8, 1],
              opacity: [0.4, 0, 0.4],
            }}
            transition={{
              duration: meta.pulseSpeed,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
          {/* 内圈 */}
          <motion.div
            className="w-2.5 h-2.5 rounded-full relative z-10"
            style={{ backgroundColor: meta.color }}
            animate={justChanged ? {
              scale: [1, 1.5, 1],
            } : {
              opacity: [0.7, 1, 0.7],
            }}
            transition={justChanged ? {
              duration: 0.4,
              times: [0, 0.5, 1],
            } : {
              duration: meta.pulseSpeed,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </div>

        {/* 状态文字（状态变化时短暂显示，或悬停时显示） */}
        <AnimatePresence>
          {(justChanged || isHovered) && (
            <motion.span
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="text-[10px] font-medium overflow-hidden whitespace-nowrap"
              style={{ color: meta.color }}
            >
              {meta.emoji} {label}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* 情绪提示消息（悬停或点击时显示） */}
      {emotion && emotion.state !== 'neutral' && (isHovered || justChanged) && (
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

      {/* 悬停详情卡片 */}
      <AnimatePresence>
        {isHovered && emotion && (
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
              {emotion.factors.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {emotion.factors.slice(0, 3).map((f, i) => (
                    <span
                      key={i}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted"
                    >
                      {f.description}
                    </span>
                  ))}
                </div>
              )}

              {/* 建议 */}
              {emotion.suggestions && emotion.suggestions.length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/5">
                  <p className="text-[10px] text-text-muted italic">
                    💡 {emotion.suggestions[0]}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
