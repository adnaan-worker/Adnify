/**
 * 上下文统计显示组件
 */
import { Database, History, FileText, Code } from 'lucide-react'
import { ContextStats } from '@/renderer/agent'
import { Language } from '@renderer/i18n'

interface ChatContextStatsProps {
  stats: ContextStats
  language: Language
  compact?: boolean
}

export default function ChatContextStats({ stats, language, compact = false }: ChatContextStatsProps) {
  const usagePercent = stats.totalChars / stats.maxChars

  if (compact) {
    return (
      <div className="flex items-center gap-3 text-[10px] text-text-muted select-none">
        {/* 上下文使用量 */}
        <div
          className="flex items-center gap-1.5"
          title={language === 'zh' ? `上下文使用量: ${(stats.totalChars / 1000).toFixed(1)}K / ${(stats.maxChars / 1000).toFixed(0)}K` : `Context usage: ${(stats.totalChars / 1000).toFixed(1)}K / ${(stats.maxChars / 1000).toFixed(0)}K`}
        >
          <Database className="w-3 h-3" />
          <div className="w-12 h-1 bg-text-primary/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${usagePercent > 0.95
                ? 'bg-status-error shadow-[0_0_5px_rgba(var(--status-error),0.5)]'
                : usagePercent > 0.8
                  ? 'bg-status-warning'
                  : 'bg-accent shadow-[0_0_5px_rgba(var(--accent),0.5)]'
                }`}
              style={{ width: `${Math.min(100, usagePercent * 100)}%` }}
            />
          </div>
        </div>

        {/* 历史消息 */}
        <div
          className="flex items-center gap-1"
          title={language === 'zh' ? `历史消息: ${stats.messageCount} / ${stats.maxMessages}` : `History messages: ${stats.messageCount} / ${stats.maxMessages}`}
        >
          <History className="w-3 h-3" />
          <span className="font-medium">{stats.messageCount}</span>
        </div>

        {/* 上下文文件 */}
        {stats.fileCount > 0 && (
          <div
            className="flex items-center gap-1"
            title={language === 'zh' ? `上下文文件: ${stats.fileCount} / ${stats.maxFiles}` : `Context files: ${stats.fileCount} / ${stats.maxFiles}`}
          >
            <FileText className="w-3 h-3" />
            <span className="font-medium">{stats.fileCount}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 py-1.5 border-b border-border bg-transparent flex items-center gap-4 text-[10px] text-text-muted animate-fade-in select-none">
      {/* 上下文使用量 */}
      <div
        className="flex items-center gap-1.5"
        title={language === 'zh' ? '上下文使用量' : 'Context usage'}
      >
        <Database className="w-3 h-3" />
        <span className="font-medium">
          {(stats.totalChars / 1000).toFixed(1)}K / {(stats.maxChars / 1000).toFixed(0)}K
        </span>
        <div className="w-16 h-1 bg-text-primary/10 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 shadow-[0_0_5px_rgba(var(--accent),0.5)] ${usagePercent > 0.95
              ? 'bg-status-error'
              : usagePercent > 0.8
                ? 'bg-status-warning'
                : 'bg-accent'
              }`}
            style={{ width: `${Math.min(100, usagePercent * 100)}%` }}
          />
        </div>
      </div>

      {/* 历史消息 */}
      <div
        className="flex items-center gap-1.5"
        title={language === 'zh' ? '历史消息' : 'History messages'}
      >
        <History className="w-3 h-3" />
        <span className="font-medium">
          {stats.messageCount} / {stats.maxMessages}
        </span>
      </div>

      {/* 上下文文件 */}
      {stats.fileCount > 0 && (
        <div
          className="flex items-center gap-1.5"
          title={language === 'zh' ? '上下文文件' : 'Context files'}
        >
          <FileText className="w-3 h-3" />
          <span className="font-medium">
            {stats.fileCount} / {stats.maxFiles}
          </span>
        </div>
      )}

      {/* 语义搜索结果 */}
      {stats.semanticResultCount > 0 && (
        <div
          className="flex items-center gap-1.5"
          title={language === 'zh' ? '语义搜索结果' : 'Semantic results'}
        >
          <Code className="w-3 h-3" />
          <span className="font-medium">{stats.semanticResultCount}</span>
        </div>
      )}
    </div>
  )
}
