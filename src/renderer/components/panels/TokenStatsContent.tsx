/**
 * Token 统计面板内容
 * 只显示会话的 Token 使用详情（费用统计）
 * 上下文管理由 CompactionStatsContent 负责
 */

import { Coins, Zap } from 'lucide-react'
import { TokenUsage } from '@renderer/agent/types'

interface TokenStatsContentProps {
  totalUsage: TokenUsage
  lastUsage?: TokenUsage
  language?: 'zh' | 'en'
}

export default function TokenStatsContent({
  totalUsage,
  lastUsage,
  language = 'en',
}: TokenStatsContentProps) {
  const formatNumber = (n: number) => n.toLocaleString()
  const formatK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString()

  return (
    <div className="p-4 space-y-4">
      {/* 总计卡片 */}
      <div className="p-4 rounded-xl border bg-accent/10 border-accent/30">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-accent/20">
              <Coins className="w-4 h-4 text-accent" />
            </div>
            <span className="text-sm font-medium text-text-primary">
              {language === 'zh' ? '会话累计' : 'Session Total'}
            </span>
          </div>
          <span className="text-2xl font-bold font-mono text-accent">
            {formatK(totalUsage.totalTokens)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-2 rounded-lg bg-black/20">
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">
              {language === 'zh' ? '输入' : 'Prompt'}
            </div>
            <div className="text-sm font-mono text-text-primary">
              {formatNumber(totalUsage.promptTokens)}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-black/20">
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">
              {language === 'zh' ? '输出' : 'Completion'}
            </div>
            <div className="text-sm font-mono text-text-primary">
              {formatNumber(totalUsage.completionTokens)}
            </div>
          </div>
        </div>
      </div>

      {/* 最近请求 */}
      {lastUsage && (
        <div className="p-3 rounded-xl bg-surface-hover border border-border-subtle">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-medium text-text-secondary">
              {language === 'zh' ? '最近一次请求' : 'Last Request'}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">
              {language === 'zh' ? '输入' : 'In'}: <span className="font-mono text-text-primary">{formatNumber(lastUsage.promptTokens)}</span>
            </span>
            <span className="text-text-muted">
              {language === 'zh' ? '输出' : 'Out'}: <span className="font-mono text-text-primary">{formatNumber(lastUsage.completionTokens)}</span>
            </span>
          </div>
        </div>
      )}

      {/* 说明文字 */}
      <div className="text-[10px] text-text-muted text-center">
        {language === 'zh' 
          ? '此统计为 API 返回的 Token 使用量，用于费用估算'
          : 'Token usage from API responses, for cost estimation'}
      </div>
    </div>
  )
}
