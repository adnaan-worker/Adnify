/**
 * 订阅当前情绪状态（emotion:changed + getCurrentState）
 * 供 StatusBar、AmbientGlow、StateNotice、EditorBar 等使用
 */

import { useEffect, useState } from 'react'
import { EventBus } from '@/renderer/agent/core/EventBus'
import { emotionDetectionEngine } from '@/renderer/agent/services/emotionDetectionEngine'
import type { EmotionDetection } from '@/renderer/agent/types/emotion'

export function useEmotionState(): EmotionDetection | null {
  const [emotion, setEmotion] = useState<EmotionDetection | null>(() =>
    emotionDetectionEngine.getCurrentState()
  )

  useEffect(() => {
    const unsubscribe = EventBus.on('emotion:changed', (event) => {
      if (event.emotion) setEmotion(event.emotion)
    })
    setEmotion(emotionDetectionEngine.getCurrentState())
    return () => unsubscribe()
  }, [])

  return emotion
}
