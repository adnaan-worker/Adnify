/**
 * 上下文压缩状态指示器
 * 升级版：磨砂玻璃面板，胶囊设计
 */

import { useState, useCallback, useMemo } from 'react'
import { Minimize2, ChevronDown, Trash2, Layers } from 'lucide-react'
import { useAgentStore, selectCompressionStats, contextManager, COMPRESSION_LEVELS } from '@/renderer/agent'
import { motion, AnimatePresence } from 'framer-motion'
import type { CompressionLevel } from '@/renderer/agent/context/types'

interface ContextCompactionIndicatorProps {
  language?: 'zh' | 'en'
}

const LEVEL_COLORS: Record<CompressionLevel, string> = {
  0: 'text-text-muted',
  1: 'text-blue-400',
  2: 'text-green-400',
  3: 'text-orange-400',
  4: 'text-red-400',
}

export default function ContextCompactionIndicator({
  language = 'en',
}: ContextCompactionIndicatorProps) {
  const setContextSummary = useAgentStore(state => state.setContextSummary)
  const compressionStats = useAgentStore(selectCompressionStats)
  
  const [isExpanded, setIsExpanded] = useState(false)

  const summary = useMemo(() => contextManager.getSummary(), [compressionStats])
  const currentLevel = compressionStats?.level ?? 0
  const levelConfig = COMPRESSION_LEVELS[currentLevel]

  const handleClearSummary = useCallback(() => {
    contextManager.clear()
    setContextSummary(null)
  }, [setContextSummary])

  if (!compressionStats || currentLevel === 0) {
    return null
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-bold ${LEVEL_COLORS[currentLevel]} hover:bg-emerald-500/20 transition-all shadow-lg shadow-emerald-500/5 active:scale-95`}
      >
        <Layers className="w-3 h-3" />
        <span>L{currentLevel}</span>
        {compressionStats.savedPercent > 0 && (
          <span className="text-[10px] opacity-70">-{compressionStats.savedPercent}%</span>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="absolute top-full left-0 mt-2 w-80 p-5 rounded-2xl bg-background/90 backdrop-blur-2xl border border-border shadow-2xl z-50 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-accent/10 text-accent">
                  <Minimize2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-text-primary tracking-tight">
                    Level {currentLevel}
                  </h4>
                  <span className="text-[10px] text-text-muted">{levelConfig.description}</span>
                </div>
              </div>
              <button
                onClick={handleClearSummary}
                className="p-1.5 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 压缩统计 */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-lg bg-black/20">
                <div className="text-[10px] text-text-muted uppercase">Original</div>
                <div className="text-sm font-mono text-text-primary">
                  {compressionStats.originalTokens >= 1000 
                    ? `${(compressionStats.originalTokens / 1000).toFixed(1)}k` 
                    : compressionStats.originalTokens}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-black/20">
                <div className="text-[10px] text-text-muted uppercase">Final</div>
                <div className="text-sm font-mono text-text-primary">
                  {compressionStats.finalTokens >= 1000 
                    ? `${(compressionStats.finalTokens / 1000).toFixed(1)}k` 
                    : compressionStats.finalTokens}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-black/20">
                <div className="text-[10px] text-text-muted uppercase">Saved</div>
                <div className="text-sm font-mono text-green-400">
                  {compressionStats.savedPercent}%
                </div>
              </div>
            </div>

            {/* 摘要内容 */}
            {summary && (
              <div className="bg-black/20 p-4 rounded-xl border border-border shadow-inner max-h-48 overflow-y-auto custom-scrollbar">
                <div className="text-[10px] text-text-muted uppercase mb-1">Objective</div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  {summary.objective}
                </p>
                {summary.completedSteps.length > 0 && (
                  <>
                    <div className="text-[10px] text-text-muted uppercase mt-2 mb-1">Completed</div>
                    <ul className="text-xs text-text-secondary list-disc list-inside">
                      {summary.completedSteps.slice(-3).map((step, i) => (
                        <li key={i} className="truncate">{step}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* 轮次信息 */}
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-text-muted opacity-50 px-1">
              <span>
                {language === 'zh' 
                  ? `保留 ${compressionStats.keptTurns} 轮`
                  : `${compressionStats.keptTurns} turns kept`}
              </span>
              {compressionStats.compactedTurns > 0 && (
                <span>
                  {language === 'zh' 
                    ? `压缩 ${compressionStats.compactedTurns} 轮`
                    : `${compressionStats.compactedTurns} compacted`}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function CompactionProgressBar({
  language = 'en',
}: {
  language?: 'zh' | 'en'
}) {
  const isCompacting = useAgentStore(state => state.isCompacting)

  if (!isCompacting) return null

  return (
    <div className="px-4 py-2.5 bg-accent/5 border-b border-border flex items-center justify-center animate-fade-in">
      <div className="flex items-center gap-3 bg-background/50 px-4 py-1.5 rounded-full border border-accent/20 shadow-sm">
        <div className="w-3.5 h-3.5 relative">
          <div className="absolute inset-0 border-2 border-accent/20 rounded-full" />
          <div className="absolute inset-0 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
        <span className="text-[11px] font-bold text-accent uppercase tracking-widest">
          {language === 'zh' ? '正在智能整理对话...' : 'Compacting Context...'}
        </span>
      </div>
    </div>
  )
}
