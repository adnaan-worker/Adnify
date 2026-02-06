/**
 * 编辑器情绪提示栏
 * 在编辑器底部显示当前情绪状态和互动提示
 */

import React, { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Zap, Coffee, AlertTriangle, Heart, Brain } from 'lucide-react'
import { EventBus } from '@/renderer/agent/core/EventBus'
import { emotionDetectionEngine } from '@/renderer/agent/services/emotionDetectionEngine'
import type { EmotionState, EmotionDetection } from '@/renderer/agent/types/emotion'
import { useStore } from '@store'
import { t } from '@/renderer/i18n'

const EMOTION_CONFIG: Record<EmotionState, {
  emoji: string
  color: string
  bgColor: string
  icon: React.ReactNode
  messages: string[]
}> = {
  focused: {
    emoji: '⚡',
    color: '#3b82f6',
    bgColor: 'bg-blue-500/10',
    icon: <Zap className="w-4 h-4" />,
    messages: [
      'emotion.editor.focused.1',
      'emotion.editor.focused.2',
      'emotion.editor.focused.3',
    ],
  },
  frustrated: {
    emoji: '😤',
    color: '#f97316',
    bgColor: 'bg-orange-500/10',
    icon: <AlertTriangle className="w-4 h-4" />,
    messages: [
      'emotion.editor.frustrated.1',
      'emotion.editor.frustrated.2',
      'emotion.editor.frustrated.3',
    ],
  },
  tired: {
    emoji: '😴',
    color: '#8b5cf6',
    bgColor: 'bg-purple-500/10',
    icon: <Coffee className="w-4 h-4" />,
    messages: [
      'emotion.editor.tired.1',
      'emotion.editor.tired.2',
      'emotion.editor.tired.3',
    ],
  },
  excited: {
    emoji: '🚀',
    color: '#22c55e',
    bgColor: 'bg-green-500/10',
    icon: <Sparkles className="w-4 h-4" />,
    messages: [
      'emotion.editor.excited.1',
      'emotion.editor.excited.2',
      'emotion.editor.excited.3',
    ],
  },
  bored: {
    emoji: '😐',
    color: '#6b7280',
    bgColor: 'bg-gray-500/10',
    icon: <Brain className="w-4 h-4" />,
    messages: [
      'emotion.editor.bored.1',
      'emotion.editor.bored.2',
      'emotion.editor.bored.3',
    ],
  },
  stressed: {
    emoji: '😰',
    color: '#06b6d4',
    bgColor: 'bg-cyan-500/10',
    icon: <AlertTriangle className="w-4 h-4" />,
    messages: [
      'emotion.editor.stressed.1',
      'emotion.editor.stressed.2',
      'emotion.editor.stressed.3',
    ],
  },
  flow: {
    emoji: '✨',
    color: '#6366f1',
    bgColor: 'bg-indigo-500/10',
    icon: <Sparkles className="w-4 h-4" />,
    messages: [
      'emotion.editor.flow.1',
      'emotion.editor.flow.2',
      'emotion.editor.flow.3',
    ],
  },
  neutral: {
    emoji: '💻',
    color: '#94a3b8',
    bgColor: 'bg-gray-500/5',
    icon: <Heart className="w-4 h-4" />,
    messages: [
      'emotion.editor.neutral.1',
      'emotion.editor.neutral.2',
      'emotion.editor.neutral.3',
    ],
  },
}

export const EmotionEditorBar: React.FC = () => {
  const { language } = useStore()
  const [emotion, setEmotion] = useState<EmotionDetection | null>(null)
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    // 获取初始状态
    const currentState = emotionDetectionEngine.getCurrentState()
    setEmotion(currentState)

    // 订阅情绪变化
    const unsubscribe = EventBus.on('emotion:changed', (event) => {
      setEmotion(event.emotion)
      // 状态变化时重置消息索引
      setCurrentMessageIndex(0)
    })

    return () => unsubscribe()
  }, [])

  // 轮播消息
  useEffect(() => {
    if (!emotion || emotion.state === 'neutral') return

    const config = EMOTION_CONFIG[emotion.state]
    const interval = setInterval(() => {
      setCurrentMessageIndex((prev) => (prev + 1) % config.messages.length)
    }, 8000) // 每8秒切换一次消息

    return () => clearInterval(interval)
  }, [emotion])

  const handleClick = useCallback(() => {
    if (!emotion) return
    const config = EMOTION_CONFIG[emotion.state]
    setCurrentMessageIndex((prev) => (prev + 1) % config.messages.length)
  }, [emotion])

  if (!emotion || emotion.state === 'neutral') {
    return null
  }

  const config = EMOTION_CONFIG[emotion.state]
  const currentMessageKey = config.messages[currentMessageIndex]
  const intensity = emotion.intensity ?? 0.5

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.3 }}
        className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none"
      >
        <div
          className={`
            relative border-t border-white/10
            ${config.bgColor}
            backdrop-blur-sm
            transition-all duration-300
            ${isHovered ? 'bg-opacity-20' : 'bg-opacity-10'}
          `}
          style={{ borderTopColor: `${config.color}30` }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className="px-4 py-2 flex items-center gap-3 pointer-events-auto">
            {/* 情绪图标和状态 */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="text-lg"
              >
                {config.emoji}
              </motion.div>
              <div className="flex flex-col">
                <span
                  className="text-xs font-medium leading-none"
                  style={{ color: config.color }}
                >
                  {t(`emotion.state.${emotion.state}`, language)}
                </span>
                <div className="flex items-center gap-1 mt-0.5">
                  <div
                    className="h-1 rounded-full transition-all"
                    style={{
                      width: `${intensity * 60}px`,
                      backgroundColor: config.color,
                      opacity: 0.6,
                    }}
                  />
                  <span className="text-[9px] text-text-muted">
                    {Math.round(intensity * 100)}%
                  </span>
                </div>
              </div>
            </div>

            {/* 消息提示 */}
            <div
              className="flex-1 min-w-0 cursor-pointer"
              onClick={handleClick}
              title={t('emotion.editor.clickToChange', language)}
            >
              <AnimatePresence mode="wait">
                <motion.p
                  key={currentMessageIndex}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                  className="text-xs text-text-secondary leading-relaxed truncate"
                >
                  {t(currentMessageKey as any, language)}
                </motion.p>
              </AnimatePresence>
            </div>

            {/* 建议按钮 */}
            {emotion.suggestions && emotion.suggestions.length > 0 && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={`
                  flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium
                  transition-colors flex-shrink-0
                  ${config.bgColor} hover:bg-opacity-20
                  border border-white/10 hover:border-white/20
                `}
                style={{ color: config.color }}
                onClick={() => {
                  // 点击可以显示更多建议（未来可以扩展为详细建议面板）
                  if (emotion.suggestions && emotion.suggestions.length > 0) {
                    // 可以通过 toast 或其他方式显示建议
                    console.log('Suggestions:', emotion.suggestions)
                  }
                }}
              >
                {config.icon}
                <span>{t('emotion.editor.viewSuggestions', language)}</span>
              </motion.button>
            )}
          </div>

          {/* 进度条动画 */}
          <motion.div
            className="absolute bottom-0 left-0 h-0.5"
            style={{ backgroundColor: config.color }}
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
