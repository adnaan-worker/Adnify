/**
 * 情绪状态变化通知条
 *
 * 当情绪状态发生明显转变时（如 focused → frustrated），
 * 在编辑器区域顶部滑入一条简洁的提示，4 秒后自动消失。
 *
 * 特点：
 *  - 只在状态真正变化时出现（同状态强度变化不触发）
 *  - 展示：旧状态 → 新状态 + 一句话原因
 *  - 不遮挡编辑内容（absolute + pointer-events-none 主体）
 *  - 有 LLM 推理时显示更智能的原因文案
 *  - neutral 状态转入不通知（太频繁）
 */

import React, { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { EventBus } from '@/renderer/agent/core/EventBus'
import type { EmotionState, EmotionDetection } from '@/renderer/agent/types/emotion'
import { useStore } from '@store'
import { t } from '@/renderer/i18n'
import { EMOTION_META } from '@/renderer/agent/emotion'

// 最短通知间隔
const MIN_NOTICE_INTERVAL = 30_000  // 30 秒
const NOTICE_DURATION = 4500        // 4.5 秒显示

interface NoticeData {
  fromState: EmotionState
  toState: EmotionState
  reason: string
  color: string
}

export const EmotionStateNotice: React.FC = () => {
  const { language } = useStore()
  const [notice, setNotice] = useState<NoticeData | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const prevStateRef = useRef<EmotionState>('neutral')
  const lastNoticeTimeRef = useRef(Date.now())
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null)
  const fadeTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const unsubscribe = EventBus.on('emotion:changed', (event) => {
      const detection: EmotionDetection = event.emotion
      if (!detection) return

      const prevState = prevStateRef.current
      const newState = detection.state

      // 更新记录
      prevStateRef.current = newState

      // 状态没变，不通知
      if (prevState === newState) return

      // 转入 neutral 不通知（太平凡）
      if (newState === 'neutral') return

      // 首次从 neutral 离开也不通知（刚启动）
      if (prevState === 'neutral' && Date.now() - lastNoticeTimeRef.current < 60_000) return

      // 冷却检查
      if (Date.now() - lastNoticeTimeRef.current < MIN_NOTICE_INTERVAL) return

      // 构建原因文案
      const reason = buildReason(detection, prevState, newState)

      const toMeta = EMOTION_META[newState]

      setNotice({
        fromState: prevState,
        toState: newState,
        reason,
        color: toMeta.color,
      })
      setIsVisible(true)
      lastNoticeTimeRef.current = Date.now()

      // 自动消失
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
      dismissTimerRef.current = setTimeout(() => {
        setIsVisible(false)
        fadeTimerRef.current = setTimeout(() => setNotice(null), 400)
      }, NOTICE_DURATION)
    })

    return () => {
      unsubscribe()
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [])

  if (!notice) return null

  const from = EMOTION_META[notice.fromState]
  const to = EMOTION_META[notice.toState]
  const fromLabel = t(from.translationKey as any, language)
  const toLabel = t(to.translationKey as any, language)

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="absolute top-3 left-1/2 -translate-x-1/2 z-[100] pointer-events-auto"
        >
          <div
            className="flex items-center gap-3 px-4 py-2.5 rounded-xl
              bg-background-secondary/90 backdrop-blur-xl
              border border-white/10 shadow-xl"
            style={{ borderColor: `${notice.color}30` }}
          >
            {/* 状态转变图标 */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-base">{from.emoji}</span>
              <svg className="w-3.5 h-3.5 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-base">{to.emoji}</span>
            </div>

            {/* 文字 */}
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium" style={{ color: notice.color }}>
                  {toLabel}
                </span>
                <span className="text-[10px] text-text-muted">
                  {fromLabel} → {toLabel}
                </span>
              </div>
              <p className="text-[11px] text-text-secondary leading-snug truncate max-w-[280px]">
                {notice.reason}
              </p>
            </div>

            {/* 进度条 */}
            <motion.div
              className="absolute bottom-0 left-0 h-[2px] rounded-b-xl"
              style={{ backgroundColor: notice.color }}
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: NOTICE_DURATION / 1000, ease: 'linear' }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * 构建状态变化原因文案
 * 优先用上下文建议，没有的话用影响因子拼接
 */
function buildReason(
  detection: EmotionDetection,
  _prevState: EmotionState,
  newState: EmotionState,
): string {
  // 有上下文建议直接用
  if (detection.suggestions && detection.suggestions.length > 0) {
    return detection.suggestions[0]
  }

  // 根据影响因子拼接
  const topFactor = detection.factors
    .filter(f => f.value > 0.3)
    .sort((a, b) => b.weight * b.value - a.weight * a.value)[0]

  if (topFactor) {
    return topFactor.description
  }

  // 兜底
  const fallbacks: Partial<Record<EmotionState, string>> = {
    focused: '进入专注状态，保持节奏',
    frustrated: '遇到了一些困难',
    tired: '工作时间较长了',
    excited: '状态很好，效率很高',
    stressed: '任务负载较重',
    flow: '深度沉浸中',
    bored: '工作内容缺少变化',
  }
  return fallbacks[newState] || '状态有所变化'
}
