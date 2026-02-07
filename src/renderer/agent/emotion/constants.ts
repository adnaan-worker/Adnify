/**
 * 情绪感知 UI 共享常量
 * 供 StatusBar、Panel、Notice、AmbientGlow、Visualization 等使用
 */

import type { EmotionState } from '../types/emotion'

/** 各状态对应的颜色（条形图、图例、拐点等） */
export const EMOTION_COLORS: Record<EmotionState, string> = {
  focused: '#3b82f6',
  frustrated: '#f97316',
  tired: '#8b5cf6',
  excited: '#22c55e',
  bored: '#6b7280',
  stressed: '#06b6d4',
  flow: '#6366f1',
  neutral: '#94a3b8',
}

/** 各状态元信息：颜色、emoji、呼吸速度、i18n key（StatusBar / Notice 等） */
export const EMOTION_META: Record<EmotionState, {
  color: string
  emoji: string
  pulseSpeed: number
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

/** StatusBar 轮播消息的 i18n key（每状态 3 条） */
export const EMOTION_STATUS_MESSAGE_KEYS: Record<EmotionState, string[]> = {
  focused: ['emotion.status.focused.1', 'emotion.status.focused.2', 'emotion.status.focused.3'],
  frustrated: ['emotion.status.frustrated.1', 'emotion.status.frustrated.2', 'emotion.status.frustrated.3'],
  tired: ['emotion.status.tired.1', 'emotion.status.tired.2', 'emotion.status.tired.3'],
  excited: ['emotion.status.excited.1', 'emotion.status.excited.2', 'emotion.status.excited.3'],
  bored: ['emotion.status.bored.1', 'emotion.status.bored.2', 'emotion.status.bored.3'],
  stressed: ['emotion.status.stressed.1', 'emotion.status.stressed.2', 'emotion.status.stressed.3'],
  flow: ['emotion.status.flow.1', 'emotion.status.flow.2', 'emotion.status.flow.3'],
  neutral: ['emotion.status.neutral.1', 'emotion.status.neutral.2', 'emotion.status.neutral.3'],
}
