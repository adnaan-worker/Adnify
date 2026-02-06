/**
 * 情绪感知面板（侧栏版本）
 * 
 * 职责：只做设置和数据展示
 * - 今日生产力报告
 * - 情绪趋势图
 * - 检测灵敏度/开关/偏好设置
 * 
 * 交互反馈已移到：
 * - StatusBar 呼吸灯（EmotionStatusIndicator）
 * - 编辑器光效（EmotionAmbientGlow）
 * - 智能浮窗（EmotionCompanion）
 */

import React, { useEffect, useState, useMemo } from 'react'
import { 
  Brain, Zap, Activity, Frown, Sun, Eye, EyeOff,
  Volume2, VolumeX, Palette, Clock, TrendingUp
} from 'lucide-react'
import { motion } from 'framer-motion'
import { emotionDetectionEngine } from '@/renderer/agent/services/emotionDetectionEngine'
import { EventBus } from '@/renderer/agent/core/EventBus'
import type { EmotionState, EmotionHistory } from '@/renderer/agent/types/emotion'
import { cn } from '@utils/cn'
import { useStore } from '@store'
import { t, type TranslationKey } from '@/renderer/i18n'

const EMOTION_COLORS: Record<EmotionState, string> = {
  focused: '#3b82f6',
  frustrated: '#f97316',
  tired: '#8b5cf6',
  excited: '#22c55e',
  bored: '#6b7280',
  stressed: '#06b6d4',
  flow: '#6366f1',
  neutral: '#94a3b8',
}

export const EmotionAwarenessPanel: React.FC = () => {
  const { language } = useStore()
  const [history, setHistory] = useState<EmotionHistory[]>([])
  const [settings, setSettings] = useState({
    ambientGlow: true,
    soundEnabled: false,
    companionEnabled: true,
    autoAdapt: true,
    sensitivity: 'medium' as 'low' | 'medium' | 'high',
  })

  useEffect(() => {
    // 注意：emotionAdapter 和 emotionDetectionEngine 都在应用级别初始化
    // 这里只负责订阅数据更新和显示

    const updateHistory = () => {
      setHistory(emotionDetectionEngine.getHistory(24 * 60 * 60 * 1000))
    }

    // 订阅情绪变化事件
    const unsubscribe = EventBus.on('emotion:changed', updateHistory)

    // 初始加载
    updateHistory()

    // 每 10 秒拉一次 history，让 Focus Time 等数据及时刷新
    const intervalId = setInterval(updateHistory, 10 * 1000)

    return () => {
      unsubscribe()
      clearInterval(intervalId)
    }
  }, [])

  // 使用 useMemo 让 productivity 随 history 更新而重新计算
  const productivity = useMemo(() => {
    return emotionDetectionEngine.getProductivityReport()
  }, [history])

  // 拐点标记：从 history 推断「连续长时间某状态」「Flow/专注被打断」等，让用户知道「该干嘛」
  const inflectionPoints = useMemo(() => computeInflectionPoints(history), [history])

  const toggleSetting = (key: keyof typeof settings) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 头部 */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-accent" />
          <h2 className="text-sm font-medium text-text-primary">{t('emotion.title', language)}</h2>
        </div>
        <p className="text-xs text-text-muted mt-1">{t('emotion.desc', language)}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* === 今日概览 === */}
        <div className="p-4">
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
            {t('emotion.todayOverview', language)}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label={t('emotion.focusTime', language)}
              value={`${Math.round(productivity.focusTime)}m`}
              icon={<Zap className="w-3.5 h-3.5" />}
              color="#3b82f6"
            />
            <StatCard
              label={t('emotion.flowSessions', language)}
              value={productivity.flowSessions}
              icon={<Activity className="w-3.5 h-3.5" />}
              color="#6366f1"
            />
            <StatCard
              label={t('emotion.frustrationEpisodes', language)}
              value={productivity.frustrationEpisodes}
              icon={<Frown className="w-3.5 h-3.5" />}
              color="#f97316"
            />
            <StatCard
              label={t('emotion.mostProductiveHour', language)}
              value={`${productivity.mostProductiveHour}:00`}
              icon={<Clock className="w-3.5 h-3.5" />}
              color="#eab308"
            />
          </div>
        </div>

        {/* === 情绪趋势 === */}
        <div className="px-4 pb-4">
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" />
            {t('emotion.trend', language)}
          </h3>
          <EmotionTimeline history={history} inflectionPoints={inflectionPoints} />
        </div>

        {/* === 设置 === */}
        <div className="px-4 pb-4 border-t border-border pt-4">
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
            {t('emotion.preferences', language)}
          </h3>
          <div className="space-y-3">
            <SettingToggle
              icon={<Palette className="w-3.5 h-3.5" />}
              label={t('emotion.ambientGlow', language)}
              description={t('emotion.ambientGlowDesc', language)}
              enabled={settings.ambientGlow}
              onToggle={() => toggleSetting('ambientGlow')}
            />
            <SettingToggle
              icon={settings.companionEnabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              label={t('emotion.companion', language)}
              description={t('emotion.companionDesc', language)}
              enabled={settings.companionEnabled}
              onToggle={() => toggleSetting('companionEnabled')}
            />
            <SettingToggle
              icon={settings.soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              label={t('emotion.soundEffects', language)}
              description={t('emotion.soundEffectsDesc', language)}
              enabled={settings.soundEnabled}
              onToggle={() => toggleSetting('soundEnabled')}
            />
            <SettingToggle
              icon={<Sun className="w-3.5 h-3.5" />}
              label={t('emotion.autoAdapt', language)}
              description={t('emotion.autoAdaptDesc', language)}
              enabled={settings.autoAdapt}
              onToggle={() => toggleSetting('autoAdapt')}
            />

            {/* 灵敏度 */}
            <div className="flex items-center justify-between py-1">
              <span className="text-xs text-text-secondary">{t('emotion.sensitivity', language)}</span>
              <div className="flex items-center gap-1">
                {(['low', 'medium', 'high'] as const).map(level => (
                  <button
                    key={level}
                    onClick={() => setSettings(prev => ({ ...prev, sensitivity: level }))}
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] transition-colors",
                      settings.sensitivity === level
                        ? 'bg-accent/15 text-accent'
                        : 'text-text-muted hover:bg-white/5'
                    )}
                  >
                    {level === 'low' ? t('emotion.sensitivityLow', language) : level === 'medium' ? t('emotion.sensitivityMedium', language) : t('emotion.sensitivityHigh', language)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// === 子组件 ===

const StatCard: React.FC<{
  label: string
  value: string | number
  icon: React.ReactNode
  color: string
}> = ({ label, value, icon, color }) => (
  <div className="p-3 bg-surface/50 rounded-lg border border-white/5">
    <div className="flex items-center gap-1.5 mb-1.5" style={{ color }}>
      {icon}
      <span className="text-[10px] font-medium text-text-muted">{label}</span>
    </div>
    <p className="text-lg font-semibold text-text-primary leading-none">{value}</p>
  </div>
)

const SettingToggle: React.FC<{
  icon: React.ReactNode
  label: string
  description: string
  enabled: boolean
  onToggle: () => void
}> = ({ icon, label, description, enabled, onToggle }) => (
  <button
    onClick={onToggle}
    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors group"
  >
    <div className={cn(
      "text-text-muted group-hover:text-text-primary transition-colors",
      enabled && "text-accent"
    )}>
      {icon}
    </div>
    <div className="flex-1 text-left">
      <p className="text-xs text-text-primary">{label}</p>
      <p className="text-[10px] text-text-muted">{description}</p>
    </div>
    <div className={cn(
      "w-8 h-4 rounded-full transition-colors relative",
      enabled ? 'bg-accent' : 'bg-surface-active'
    )}>
      <motion.div
        animate={{ x: enabled ? 16 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="w-3 h-3 rounded-full bg-white absolute top-0.5"
      />
    </div>
  </button>
)

/** 拐点类型：用于在时间轴上标记「这里发生了什么」 */
export type InflectionPoint =
  | { type: 'prolonged'; timestamp: number; state: EmotionState; durationMin: number }
  | { type: 'interrupted'; timestamp: number; fromState: EmotionState; toState: EmotionState }
  | { type: 'intervention'; timestamp: number }

const PROLONGED_THRESHOLD_MS = 12 * 60 * 1000  // 连续 12 分钟同状态算「拐点」
const FLOW_STATES: EmotionState[] = ['flow', 'focused']
const NEGATIVE_STATES: EmotionState[] = ['frustrated', 'stressed', 'tired']

function computeInflectionPoints(history: EmotionHistory[]): InflectionPoint[] {
  if (history.length < 2) return []
  const points: InflectionPoint[] = []
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp)

  // 1. 连续长时间同一状态（如连续 12 分钟 Frustrated）：每个长跑只标一个拐点
  let runStart = sorted[0].timestamp
  let runState = sorted[0].state
  for (let i = 1; i < sorted.length; i++) {
    const h = sorted[i]
    if (h.state === runState) {
      const duration = h.timestamp - runStart
      if (duration >= PROLONGED_THRESHOLD_MS) {
        const durationMin = Math.round(duration / 60000)
        points.push({ type: 'prolonged', timestamp: runStart + duration / 2, state: runState, durationMin })
        runStart = h.timestamp // 推进，同一跑段不再重复标记
      }
    } else {
      runStart = h.timestamp
      runState = h.state
    }
  }

  // 2. Flow/专注 被打断：flow|focused → frustrated|stressed|tired
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (FLOW_STATES.includes(prev.state) && NEGATIVE_STATES.includes(curr.state)) {
      points.push({ type: 'interrupted', timestamp: curr.timestamp, fromState: prev.state, toState: curr.state })
    }
  }

  return points
}

const EmotionTimeline: React.FC<{ history: EmotionHistory[]; inflectionPoints: InflectionPoint[] }> = ({ history, inflectionPoints }) => {
  const { language } = useStore()
  // 按30分钟窗口聚合，最近12小时
  const timelineData = useMemo(() => {
    const now = Date.now()
    const windowSize = 30 * 60 * 1000 // 30分钟
    const windowCount = 24 // 12小时
    
    const windows: Array<{
      time: number
      dominant: EmotionState
      intensity: number
      count: number
    }> = []

    for (let i = windowCount - 1; i >= 0; i--) {
      const windowEnd = now - i * windowSize
      const windowStart = windowEnd - windowSize
      
      const items = history.filter(h => h.timestamp >= windowStart && h.timestamp < windowEnd)
      
      if (items.length === 0) {
        windows.push({ time: windowEnd, dominant: 'neutral', intensity: 0, count: 0 })
        continue
      }

      // 找出主导情绪
      const stateCounts: Record<string, number> = {}
      let totalIntensity = 0
      items.forEach(item => {
        stateCounts[item.state] = (stateCounts[item.state] || 0) + 1
        totalIntensity += item.intensity
      })
      
      const dominant = Object.entries(stateCounts)
        .sort(([, a], [, b]) => b - a)[0][0] as EmotionState

      windows.push({
        time: windowEnd,
        dominant,
        intensity: totalIntensity / items.length,
        count: items.length,
      })
    }

    return windows
  }, [history])

  // 拐点按 30 分钟窗口归到对应柱子：timelineData[0]=12h前，timelineData[23]=现在
  const windowSizeMs = 30 * 60 * 1000
  const latestTime = timelineData.length > 0 ? timelineData[timelineData.length - 1].time : Date.now()
  const inflectionsByWindow = useMemo(() => {
    const map: Record<number, InflectionPoint[]> = {}
    const len = timelineData.length
    inflectionPoints.forEach((ip) => {
      const age = latestTime - ip.timestamp
      const idx = len - 1 - Math.floor(age / windowSizeMs)
      if (idx >= 0 && idx < len) {
        if (!map[idx]) map[idx] = []
        map[idx].push(ip)
      }
    })
    return map
  }, [inflectionPoints, timelineData, latestTime])

  if (history.length === 0) {
    return (
      <div className="h-20 flex items-center justify-center text-text-muted text-xs">
        {t('emotion.noData', language)}
      </div>
    )
  }

  const stateLabelKey = (s: EmotionState): TranslationKey => `emotion.state.${s}` as TranslationKey
  const renderInflectionTooltip = (ip: InflectionPoint) => {
    if (ip.type === 'prolonged') {
      const stateLabel = t(stateLabelKey(ip.state), language)
      return t('emotion.inflection.prolonged', language, { duration: ip.durationMin, stateLabel })
    }
    if (ip.type === 'interrupted') return t('emotion.inflection.flowInterrupted', language)
    return t('emotion.inflection.systemIntervention', language)
  }

  return (
    <div className="space-y-1">
      {/* 拐点标记行：小点 + tooltip */}
      <div className="flex gap-0.5 h-4 items-center justify-start">
        {timelineData.map((_, i) => {
          const inflections = inflectionsByWindow[i] || []
          if (inflections.length === 0) return <div key={i} className="flex-1" />
          return (
            <div key={i} className="flex-1 flex justify-center relative group/marker">
              <div
                className="w-1.5 h-1.5 rounded-full bg-amber-400/90 shrink-0 cursor-help"
                title={inflections.map(renderInflectionTooltip).join('\n')}
              />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/marker:block z-20 pointer-events-none">
                <div className="bg-background-secondary border border-white/10 rounded px-2 py-1.5 text-[9px] text-text-secondary shadow-lg max-w-[180px]">
                  {inflections.map((ip, j) => (
                    <div key={j}>{renderInflectionTooltip(ip)}</div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {/* 时间轴条形图 */}
      <div className="flex gap-0.5 h-8 items-end">
        {timelineData.map((window, i) => {
          const color = EMOTION_COLORS[window.dominant]
          const height = window.count === 0 ? 4 : Math.max(8, window.intensity * 32)
          
          return (
            <motion.div
              key={i}
              className="flex-1 rounded-t group relative cursor-default"
              style={{
                backgroundColor: window.count === 0 ? 'rgba(255,255,255,0.03)' : color,
                opacity: window.count === 0 ? 1 : 0.4 + window.intensity * 0.6,
              }}
              initial={{ height: 0 }}
              animate={{ height }}
              transition={{ duration: 0.3, delay: i * 0.02 }}
            >
              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
                <div className="bg-background-secondary border border-white/10 rounded px-2 py-1 text-[9px] text-text-secondary whitespace-nowrap shadow-lg">
                  {new Date(window.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {window.count > 0 && (
                    <span className="ml-1" style={{ color }}>
                      {window.dominant}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* 时间标签 */}
      <div className="flex justify-between text-[9px] text-text-muted px-0.5">
        <span>{t('emotion.timeAgo12h', language)}</span>
        <span>{t('emotion.timeAgo6h', language)}</span>
        <span>{t('emotion.timeNow', language)}</span>
      </div>

      {/* 图例 */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {(['focused', 'flow', 'frustrated', 'tired', 'stressed'] as EmotionState[]).map(state => (
          <div key={state} className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: EMOTION_COLORS[state] }} />
            <span className="text-[9px] text-text-muted">
              {state === 'focused' ? t('emotion.state.focused', language) :
               state === 'flow' ? t('emotion.state.flow', language) :
               state === 'frustrated' ? t('emotion.state.frustrated', language) :
               state === 'tired' ? t('emotion.state.tired', language) : t('emotion.state.stressed', language)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default EmotionAwarenessPanel
