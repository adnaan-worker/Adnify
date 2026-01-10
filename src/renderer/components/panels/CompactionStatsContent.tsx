/**
 * 压缩统计面板内容
 * 显示上下文压缩的摘要和统计信息
 */

import { Layers, Trash2, FileText, Hash, ArrowRight, Zap } from 'lucide-react'
import { useAgentStore, selectCompressionStats, selectContextSummary, contextManager, COMPRESSION_LEVELS } from '@/renderer/agent'
import { Button } from '../ui'
import { useCallback, useMemo } from 'react'
import type { CompressionLevel } from '@/renderer/agent/context/types'

interface CompactionStatsContentProps {
  language?: 'zh' | 'en'
}

const LEVEL_COLORS: Record<CompressionLevel, string> = {
  0: 'text-text-muted',
  1: 'text-blue-400',
  2: 'text-green-400',
  3: 'text-orange-400',
  4: 'text-red-400',
}

const LEVEL_BG_COLORS: Record<CompressionLevel, string> = {
  0: 'bg-white/5',
  1: 'bg-blue-500/10 border-blue-500/30',
  2: 'bg-green-500/10 border-green-500/30',
  3: 'bg-orange-500/10 border-orange-500/30',
  4: 'bg-red-500/10 border-red-500/30',
}

export default function CompactionStatsContent({
  language = 'en',
}: CompactionStatsContentProps) {
  const compressionStats = useAgentStore(selectCompressionStats)
  const setCompressionStats = useAgentStore(state => state.setCompressionStats)
  const setHandoffRequired = useAgentStore(state => state.setHandoffRequired)
  const setHandoffDocument = useAgentStore(state => state.setHandoffDocument)
  const handoffDocument = useAgentStore(state => state.handoffDocument)
  const handoffRequired = useAgentStore(state => state.handoffRequired)

  const currentLevel = compressionStats?.level ?? 0
  const levelConfig = COMPRESSION_LEVELS[currentLevel]

  const handleClear = useCallback(() => {
    contextManager.clear()
    setCompressionStats(null)
    // 同时重置 handoff 状态
    setHandoffRequired(false)
    setHandoffDocument(null)
  }, [setCompressionStats, setHandoffRequired, setHandoffDocument])

  // 优先使用 store 中的 contextSummary（从 handoff 过来的），否则使用 contextManager 的摘要
  const contextSummary = useAgentStore(selectContextSummary)
  const summary = useMemo(() => contextSummary || contextManager.getSummary(), [compressionStats, contextSummary])

  return (
    <div className="p-4 space-y-4">
      {/* 压缩级别指示器 */}
      <div className={`p-4 rounded-xl border ${LEVEL_BG_COLORS[currentLevel]}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-lg ${currentLevel > 0 ? LEVEL_BG_COLORS[currentLevel] : 'bg-white/5'}`}>
              <Layers className={`w-4 h-4 ${LEVEL_COLORS[currentLevel]}`} />
            </div>
            <div>
              <span className={`text-sm font-medium ${LEVEL_COLORS[currentLevel]}`}>
                Level {currentLevel}
              </span>
              <span className="text-xs text-text-muted ml-2">
                {levelConfig.description}
              </span>
            </div>
          </div>
          
          {/* 操作按钮 */}
          {compressionStats && compressionStats.level > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClear}
              className="h-7 w-7 hover:bg-red-500/10 hover:text-red-400"
              title={language === 'zh' ? '重置' : 'Reset'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>

        {/* 压缩级别进度条 */}
        <div className="flex items-center gap-1 mb-3">
          {[0, 1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className={`flex-1 h-1.5 rounded-full transition-all ${
                level <= currentLevel 
                  ? level === 4 ? 'bg-red-400' : level === 3 ? 'bg-orange-400' : level === 2 ? 'bg-green-400' : level === 1 ? 'bg-blue-400' : 'bg-white/20'
                  : 'bg-white/10'
              }`}
            />
          ))}
        </div>

        {/* 统计信息 */}
        {compressionStats && (
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2 rounded-lg bg-black/20">
              <div className="flex items-center gap-1 text-[10px] text-text-muted uppercase tracking-wider mb-1">
                <Hash className="w-3 h-3" />
                {language === 'zh' ? '原始' : 'Original'}
              </div>
              <div className="text-sm font-mono text-text-primary">
                {compressionStats.originalTokens >= 1000 
                  ? `${(compressionStats.originalTokens / 1000).toFixed(1)}k` 
                  : compressionStats.originalTokens}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-black/20">
              <div className="flex items-center gap-1 text-[10px] text-text-muted uppercase tracking-wider mb-1">
                <Zap className="w-3 h-3" />
                {language === 'zh' ? '压缩后' : 'Final'}
              </div>
              <div className="text-sm font-mono text-text-primary">
                {compressionStats.finalTokens >= 1000 
                  ? `${(compressionStats.finalTokens / 1000).toFixed(1)}k` 
                  : compressionStats.finalTokens}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-black/20">
              <div className="flex items-center gap-1 text-[10px] text-text-muted uppercase tracking-wider mb-1">
                <FileText className="w-3 h-3" />
                {language === 'zh' ? '节省' : 'Saved'}
              </div>
              <div className={`text-sm font-mono ${compressionStats.savedPercent > 0 ? 'text-green-400' : 'text-text-primary'}`}>
                {compressionStats.savedPercent}%
              </div>
            </div>
          </div>
        )}

        {/* 轮次信息 */}
        {compressionStats && (compressionStats.keptTurns > 0 || compressionStats.compactedTurns > 0) && (
          <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
            <span>{language === 'zh' ? '保留' : 'Kept'}: {compressionStats.keptTurns} {language === 'zh' ? '轮' : 'turns'}</span>
            {compressionStats.compactedTurns > 0 && (
              <>
                <ArrowRight className="w-3 h-3" />
                <span>{language === 'zh' ? '压缩' : 'Compacted'}: {compressionStats.compactedTurns} {language === 'zh' ? '轮' : 'turns'}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Handoff 提示 - L4 过渡由 StatusBar 自动处理 */}
      {handoffDocument && handoffRequired && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span className="text-sm font-medium text-red-400">
              {language === 'zh' ? '上下文已满，需要创建新会话' : 'Context full, new session required'}
            </span>
          </div>
        </div>
      )}

      {/* 摘要内容 */}
      {summary ? (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wider">
            {language === 'zh' ? '任务摘要' : 'Task Summary'}
          </h4>
          <div className="max-h-40 overflow-y-auto custom-scrollbar p-3 rounded-xl bg-black/20 border border-border-subtle space-y-2">
            <div>
              <span className="text-[10px] text-text-muted uppercase">
                {language === 'zh' ? '目标' : 'Objective'}:
              </span>
              <p className="text-xs text-text-secondary">{summary.objective}</p>
            </div>
            {summary.completedSteps.length > 0 && (
              <div>
                <span className="text-[10px] text-text-muted uppercase">
                  {language === 'zh' ? '已完成' : 'Completed'}:
                </span>
                <ul className="text-xs text-text-secondary list-disc list-inside">
                  {summary.completedSteps.slice(-3).map((step, i) => (
                    <li key={i} className="truncate">{step}</li>
                  ))}
                </ul>
              </div>
            )}
            {summary.fileChanges.length > 0 && (
              <div>
                <span className="text-[10px] text-text-muted uppercase">
                  {language === 'zh' ? '文件变更' : 'File Changes'}:
                </span>
                <ul className="text-xs text-text-secondary">
                  {summary.fileChanges.slice(-3).map((f, i) => (
                    <li key={i} className="truncate">
                      <span className={`${f.action === 'create' ? 'text-green-400' : f.action === 'delete' ? 'text-red-400' : 'text-yellow-400'}`}>
                        [{f.action}]
                      </span> {f.path}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-4 text-text-muted text-xs">
          {language === 'zh' 
            ? '对话尚未压缩。当上下文超过阈值时会自动压缩。'
            : 'Conversation not yet compacted. Will auto-compact when context exceeds threshold.'
          }
        </div>
      )}

      {/* 压缩级别说明 */}
      <div className="text-[10px] text-text-muted space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-12 text-blue-400">L1</span>
          <span>{language === 'zh' ? '智能截断工具输出' : 'Smart truncation of tool outputs'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-12 text-green-400">L2</span>
          <span>{language === 'zh' ? '滑动窗口 + 摘要' : 'Sliding window + summary'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-12 text-orange-400">L3</span>
          <span>{language === 'zh' ? '深度压缩' : 'Deep compression'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-12 text-red-400">L4</span>
          <span>{language === 'zh' ? '会话交接' : 'Session handoff'}</span>
        </div>
      </div>
    </div>
  )
}
