/**
 * 情绪历史 + 生产力报告，带轮询与 EventBus 订阅
 * 供 EmotionAwarenessPanel 使用
 */

import { useEffect, useState, useMemo } from 'react'
import { EventBus } from '@/renderer/agent/core/EventBus'
import { emotionDetectionEngine } from '@/renderer/agent/services/emotionDetectionEngine'
import type { EmotionHistory } from '@/renderer/agent/types/emotion'

const HISTORY_DURATION_MS = 24 * 60 * 60 * 1000
const POLL_INTERVAL_MS = 10 * 1000

export function useEmotionHistory() {
  const [history, setHistory] = useState<EmotionHistory[]>([])

  useEffect(() => {
    const updateHistory = () => {
      setHistory(emotionDetectionEngine.getHistory(HISTORY_DURATION_MS))
    }
    const unsubscribe = EventBus.on('emotion:changed', updateHistory)
    updateHistory()
    const intervalId = setInterval(updateHistory, POLL_INTERVAL_MS)
    return () => {
      unsubscribe()
      clearInterval(intervalId)
    }
  }, [])

  const productivity = useMemo(
    () => emotionDetectionEngine.getProductivityReport(),
    [history]
  )

  return { history, productivity }
}
