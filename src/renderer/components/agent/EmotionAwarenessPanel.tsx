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

import React, { useState, useMemo } from 'react'
import { 
  Brain, Zap, Activity, Frown, Sun, Eye, EyeOff,
  Volume2, VolumeX, Palette, Clock, TrendingUp, Play, ChevronDown, ChevronRight
} from 'lucide-react'
import { motion } from 'framer-motion'
import type { EmotionState, EmotionHistory } from '@/renderer/agent/types/emotion'
import { cn } from '@utils/cn'
import { useStore } from '@store'
import { t, type TranslationKey } from '@/renderer/i18n'
import { useEmotionHistory } from '@/renderer/hooks/useEmotionHistory'
import {
  EMOTION_COLORS,
  loadEmotionPanelSettings,
  saveEmotionPanelSettings,
  computeInflectionPoints,
  type InflectionPoint,
} from '@/renderer/agent/emotion'

export const EmotionAwarenessPanel: React.FC = () => {
  const { language } = useStore()
  const { history, productivity } = useEmotionHistory()
  const [settings, setSettings] = useState(loadEmotionPanelSettings)

  const inflectionPoints = useMemo(() => computeInflectionPoints(history), [history])

  // 第一次打开 = 假面板：无数据或数据不足 15 分钟，只展示欢迎 + 骨架 + 灰态趋势 + 折叠设置
  const WELCOME_DATA_SPAN_MS = 15 * 60 * 1000
  const hasEnoughData = useMemo(() => {
    if (history.length === 0) return false
    const oldest = Math.min(...history.map(h => h.timestamp))
    return Date.now() - oldest >= WELCOME_DATA_SPAN_MS
  }, [history])
  const isWelcomeState = !hasEnoughData

  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [welcomeDismissed, setWelcomeDismissed] = useState(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem('adnify-emotion-welcome-dismissed') === '1'
  )

  const handleStartWorking = () => {
    setWelcomeDismissed(true)
    try {
      localStorage.setItem('adnify-emotion-welcome-dismissed', '1')
    } catch (_) {}
  }

  const toggleSetting = (key: keyof typeof settings) => {
    setSettings(prev => {
      const next = { ...prev, [key]: !prev[key] }
      saveEmotionPanelSettings(next)
      return next
    })
  }

  const setSensitivity = (sensitivity: 'low' | 'medium' | 'high') => {
    setSettings(prev => {
      const next = { ...prev, sensitivity }
      saveEmotionPanelSettings(next)
      return next
    })
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
        {isWelcomeState ? (
          /* ========== 假面板：第一次打开 或 已点「开始工作」但数据未满 15 分钟 ========== */
          <>
            {/* Today Overview → 欢迎块（点击「开始正常工作」后收起） */}
            <div className="p-4">
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
                {t('emotion.todayOverview', language)}
              </h3>
              {!welcomeDismissed && (
                <div className="rounded-lg border border-border bg-surface/30 p-4 space-y-3">
                  <h4 className="text-sm font-medium text-text-primary">
                    {t('emotion.welcome.title', language)}
                  </h4>
                  <p className="text-xs text-text-muted leading-relaxed">
                    {t('emotion.welcome.subtitle', language)}
                  </p>
                  <div className="pt-1">
                    <p className="text-[10px] text-text-muted mb-2">
                      {t('emotion.welcome.ctaHint', language)}
                    </p>
                    <button
                      type="button"
                      onClick={handleStartWorking}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition-colors"
                    >
                      <Play className="w-3 h-3" />
                      {t('emotion.welcome.cta', language)}
                    </button>
                  </div>
                </div>
              )}
              {/* 卡片 → Skeleton */}
              <div className="grid grid-cols-2 gap-2 mt-3">
                {[1, 2, 3, 4].map((i) => (
                  <StatCardSkeleton key={i} />
                ))}
              </div>
            </div>

            {/* Emotion Trend → 灰态占位 */}
            <div className="px-4 pb-4">
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <TrendingUp className="w-3 h-3" />
                {t('emotion.trend', language)}
              </h3>
              <div className="h-20 rounded-lg border border-border bg-surface/20 flex items-center justify-center">
                <p className="text-[10px] text-text-muted">
                  {t('emotion.welcome.trendPlaceholder', language)}
                </p>
              </div>
            </div>

            {/* Preferences → 折叠 */}
            <div className="px-4 pb-4 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setPreferencesOpen((o) => !o)}
                className="w-full flex items-center justify-between text-left py-1 text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
              >
                {t('emotion.preferences', language)}
                {preferencesOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              {preferencesOpen && (
                <div className="space-y-3 mt-3">
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
                    onClick={() => setSensitivity(level)}
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
              )}
            </div>
            </>
          ) : (
            /* ========== 完整面板：已有约 15 分钟数据 ========== */
            <>
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
                    value={productivity.mostProductiveHour >= 0 ? `${productivity.mostProductiveHour}:00` : '—'}
                    icon={<Clock className="w-3.5 h-3.5" />}
                    color="#eab308"
                  />
                </div>
              </div>

              <div className="px-4 pb-4">
                <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <TrendingUp className="w-3 h-3" />
                  {t('emotion.trend', language)}
                </h3>
                <EmotionTimeline history={history} inflectionPoints={inflectionPoints} />
              </div>

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
                  <div className="flex items-center justify-between py-1">
                    <span className="text-xs text-text-secondary">{t('emotion.sensitivity', language)}</span>
                    <div className="flex items-center gap-1">
                      {(['low', 'medium', 'high'] as const).map(level => (
                        <button
                          key={level}
                          onClick={() => setSensitivity(level)}
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
            </>
          )}
      </div>
    </div>
  )
}

// === 子组件 ===

const StatCardSkeleton: React.FC = () => (
  <div className="p-3 bg-surface/30 rounded-lg border border-white/5 animate-pulse">
    <div className="flex items-center gap-1.5 mb-1.5">
      <div className="w-3.5 h-3.5 rounded bg-white/10" />
      <div className="h-3 w-16 rounded bg-white/10" />
    </div>
    <div className="h-5 w-10 rounded bg-white/10" />
  </div>
)

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
