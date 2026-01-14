/**
 * 上下文统计面板（合并版）
 * 
 * 整合 Token 使用统计 + 上下文压缩状态
 * 显示：使用进度、压缩等级、Token 详情、摘要
 */

import { Layers, Coins, Zap, AlertTriangle, ChevronRight } from 'lucide-react'
import { useAgentStore, selectCompressionStats, selectContextSummary } from '@/renderer/agent'
import { useMemo } from 'react'
import type { CompressionLevel } from '@/renderer/agent/context/types'
import type { TokenUsage } from '@renderer/agent/types'

interface ContextStatsContentProps {
  totalUsage: TokenUsage
  lastUsage?: TokenUsage
  language?: 'zh' | 'en'
}

const LEVEL_COLORS: Record<CompressionLevel, string> = {
  0: 'text-emerald-400',
  1: 'text-blue-400',
  2: 'text-yellow-400',
  3: 'text-orange-400',
  4: 'text-red-400',
}

const LEVEL_BG: Record<CompressionLevel, string> = {
  0: 'bg-emerald-400',
  1: 'bg-blue-400',
  2: 'bg-yellow-400',
  3: 'bg-orange-400',
  4: 'bg-red-400',
}

export default function ContextStatsContent({
  totalUsage,
  lastUsage,
  language = 'en',
}: ContextStatsContentProps) {
  const compressionStats = useAgentStore(selectCompressionStats)
  const contextSummary = useAgentStore(selectContextSummary)
  const handoffRequired = useAgentStore(state => state.handoffRequired)

  const currentLevel = (compressionStats?.level ?? 0) as CompressionLevel
  const ratio = compressionStats?.ratio ?? 0
  const contextLimit = compressionStats?.contextLimit ?? 128000
  const inputTokens = compressionStats?.inputTokens ?? 0

  const levelNames = {
    0: language === 'zh' ? '完整' : 'Full',
    1: language === 'zh' ? '截断' : 'Truncate',
    2: language === 'zh' ? '滑窗' : 'Window',
    3: language === 'zh' ? '深压' : 'Deep',
    4: language === 'zh' ? '交接' : 'Handoff',
  }

  const formatK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString()
  const formatNumber = (n: number) => n.toLocaleString()

  // 进度条颜色
  const progressColor = useMemo(() => {
    if (ratio >= 0.95) return 'bg-red-500'
    if (ratio >= 0.85) return 'bg-orange-500'
    if (ratio >= 0.7) return 'bg-yellow-500'
    return 'bg-emerald-500'
  }, [ratio])

  return (
    <div className="flex flex-col h-full bg-background/50 backdrop-blur-xl select-none">
      {/* 顶部：上下文使用进度 */}
      <div className="p-4 border-b border-border/40">
        {/* 主进度条 */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-text-muted" />
              <span className="text-xs font-medium text-text-secondary">
                {language === 'zh' ? '上下文使用' : 'Context Usage'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold font-mono ${LEVEL_COLORS[currentLevel]}`}>
                {Math.round(ratio * 100)}%
              </span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${LEVEL_BG[currentLevel]}/20 ${LEVEL_COLORS[currentLevel]}`}>
                L{currentLevel}
              </span>
            </div>
          </div>
          
          {/* 进度条 */}
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div 
              className={`h-full ${progressColor} transition-all duration-500 rounded-full`}
              style={{ width: `${Math.min(ratio * 100, 100)}%` }}
            />
          </div>
          
          {/* 刻度标记 */}
          <div className="flex justify-between mt-1 text-[9px] text-text-muted/50 font-mono">
            <span>0</span>
            <span className="text-yellow-500/50">70%</span>
            <span className="text-orange-500/50">85%</span>
            <span className="text-red-500/50">95%</span>
            <span>{formatK(contextLimit)}</span>
          </div>
        </div>

        {/* Token 详情 */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-lg bg-black/20">
            <div className="text-[9px] text-text-muted uppercase">
              {language === 'zh' ? '当前输入' : 'Input'}
            </div>
            <div className="text-sm font-mono font-bold text-text-primary">
              {formatK(inputTokens)}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-black/20">
            <div className="text-[9px] text-text-muted uppercase">
              {language === 'zh' ? '上下文限制' : 'Limit'}
            </div>
            <div className="text-sm font-mono font-bold text-text-secondary">
              {formatK(contextLimit)}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-black/20">
            <div className="text-[9px] text-text-muted uppercase">
              {language === 'zh' ? '压缩等级' : 'Level'}
            </div>
            <div className={`text-sm font-mono font-bold ${LEVEL_COLORS[currentLevel]}`}>
              {levelNames[currentLevel]}
            </div>
          </div>
        </div>
      </div>

      {/* 中间：费用统计（会话累计消耗） */}
      <div className="p-4 border-b border-border/40">
        <div className="flex items-center gap-2 mb-3">
          <Coins className="w-4 h-4 text-accent" />
          <span className="text-xs font-medium text-text-secondary">
            {language === 'zh' ? '费用统计' : 'Cost Stats'}
          </span>
          <span className="ml-auto text-lg font-bold font-mono text-accent">
            {formatK(totalUsage.totalTokens)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between p-2 rounded-lg bg-black/20">
            <span className="text-[10px] text-text-muted">
              {language === 'zh' ? '累计输入' : 'Total In'}
            </span>
            <span className="text-xs font-mono text-text-primary">
              {formatNumber(totalUsage.promptTokens)}
            </span>
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-black/20">
            <span className="text-[10px] text-text-muted">
              {language === 'zh' ? '累计输出' : 'Total Out'}
            </span>
            <span className="text-xs font-mono text-text-primary">
              {formatNumber(totalUsage.completionTokens)}
            </span>
          </div>
        </div>

        {/* 最近请求 */}
        {lastUsage && (
          <div className="mt-2 flex items-center justify-between text-[10px] text-text-muted">
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {language === 'zh' ? '最近一次' : 'Last request'}
            </span>
            <span>
              {formatK(lastUsage.promptTokens)} <ChevronRight className="w-3 h-3 inline" /> {formatK(lastUsage.completionTokens)}
            </span>
          </div>
        )}
      </div>

      {/* 底部：警告或摘要 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {/* Handoff 警告 */}
        {handoffRequired && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex gap-3 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold text-red-400 mb-0.5">
                {language === 'zh' ? '上下文已满' : 'Context Full'}
              </h4>
              <p className="text-[10px] text-red-400/70">
                {language === 'zh' 
                  ? '请开始新会话继续' 
                  : 'Please start a new session'}
              </p>
            </div>
          </div>
        )}

        {/* 压缩等级说明 */}
        <div className="space-y-2">
          <div className="text-[9px] text-text-muted uppercase tracking-wider mb-2">
            {language === 'zh' ? '压缩策略' : 'Compression Strategy'}
          </div>
          {([0, 1, 2, 3, 4] as CompressionLevel[]).map((level) => (
            <div 
              key={level} 
              className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                level === currentLevel ? 'bg-white/5 ring-1 ring-white/10' : 'opacity-50'
              }`}
            >
              <span className={`text-[9px] font-bold font-mono w-6 ${LEVEL_COLORS[level]}`}>
                L{level}
              </span>
              <span className="text-[10px] text-text-secondary flex-1">
                {level === 0 && (language === 'zh' ? '保留全部消息' : 'Keep all messages')}
                {level === 1 && (language === 'zh' ? '截断工具参数' : 'Truncate tool args')}
                {level === 2 && (language === 'zh' ? '清理旧工具结果' : 'Clear old results')}
                {level === 3 && (language === 'zh' ? '深度压缩 + 摘要' : 'Deep compress + summary')}
                {level === 4 && (language === 'zh' ? '需要新会话' : 'New session needed')}
              </span>
              {level === currentLevel && (
                <span className={`w-1.5 h-1.5 rounded-full ${LEVEL_BG[level]}`} />
              )}
            </div>
          ))}
        </div>

        {/* 摘要 */}
        {contextSummary && (
          <div className="mt-4 p-3 rounded-xl bg-surface/30 border border-border/40">
            <div className="text-[9px] text-accent font-bold uppercase tracking-wider mb-1">
              {language === 'zh' ? '当前任务' : 'Current Task'}
            </div>
            <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-3">
              {contextSummary.objective}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
