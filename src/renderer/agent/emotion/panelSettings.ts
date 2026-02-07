/**
 * 情绪感知面板设置：localStorage 持久化
 */

export type EmotionPanelSensitivity = 'low' | 'medium' | 'high'

export interface EmotionPanelSettings {
  ambientGlow: boolean
  soundEnabled: boolean
  companionEnabled: boolean
  autoAdapt: boolean
  sensitivity: EmotionPanelSensitivity
}

export const DEFAULT_EMOTION_PANEL_SETTINGS: EmotionPanelSettings = {
  ambientGlow: true,
  soundEnabled: false,
  companionEnabled: true,
  autoAdapt: true,
  sensitivity: 'medium',
}

const EMOTION_SETTINGS_KEY = 'adnify-emotion-panel-settings'

export function loadEmotionPanelSettings(): EmotionPanelSettings {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_EMOTION_PANEL_SETTINGS
    const raw = localStorage.getItem(EMOTION_SETTINGS_KEY)
    if (!raw) return DEFAULT_EMOTION_PANEL_SETTINGS
    const parsed = JSON.parse(raw) as Partial<EmotionPanelSettings>
    return {
      ...DEFAULT_EMOTION_PANEL_SETTINGS,
      ...parsed,
      sensitivity: ['low', 'medium', 'high'].includes(parsed.sensitivity ?? '') ? parsed.sensitivity! : 'medium',
    }
  } catch {
    return DEFAULT_EMOTION_PANEL_SETTINGS
  }
}

export function saveEmotionPanelSettings(settings: EmotionPanelSettings): void {
  try {
    localStorage.setItem(EMOTION_SETTINGS_KEY, JSON.stringify(settings))
  } catch (_) {}
}
