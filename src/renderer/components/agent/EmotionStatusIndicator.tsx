/**
 * StatusBar 情绪指示器
 * 始终可见的小组件：一个呼吸灯 + 悬停展开详情
 * 设计原则：不打扰，但一眼能看到当前状态
 */

import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { EventBus } from '@/renderer/agent/core/EventBus'
import { emotionDetectionEngine } from '@/renderer/agent/services/emotionDetectionEngine'
import type { EmotionState, EmotionDetection } from '@/renderer/agent/types/emotion'
import { useStore } from '@store'
import { t } from '@/renderer/i18n'

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

export const EmotionStatusIndicator: React.FC = () => {
  const { language } = useStore()
  const [emotion, setEmotion] = useState<EmotionDetection | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [justChanged, setJustChanged] = useState(false)

  useEffect(() => {
    // 初始化检测引擎
    emotionDetectionEngine.start()

    const unsubscribe = EventBus.on('emotion:changed', (event) => {
      setEmotion(event.emotion)
      // 状态变化时闪烁提示
      setJustChanged(true)
      setTimeout(() => setJustChanged(false), 3000)
    })

    // 获取初始状态
    setEmotion(emotionDetectionEngine.getCurrentState())

    return () => {
      unsubscribe()
    }
  }, [])

  const state = emotion?.state || 'neutral'
  const meta = EMOTION_META[state]
  const intensity = emotion?.intensity ?? 0.5
  const label = t(meta.translationKey as any, language)

  return (
    <div
      className="relative flex items-center h-full"
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
