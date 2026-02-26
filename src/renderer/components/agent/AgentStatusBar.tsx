/**
 * Agent 状态栏组件
 * 精致的内嵌式设计 - 与输入框融为一体
 * 
 * 职责：
 * 1. 显示流式状态和等待审批状态
 * 2. 显示文件变更列表（复用 useChangesReview）
 * 3. 提供 Accept/Reject 操作
 */

import { useState, useCallback, useMemo } from 'react'
import {
  X,
  Check,
  ExternalLink,
  Square,
  ChevronDown,
  FileCode,
  FilePlus,
  FileX,
  CheckCheck,
  XCircle,
  FolderOpen,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { getFileName, getDirname } from '@shared/utils/pathUtils'
import type { PendingChange } from '@/renderer/agent/types'

interface AgentStatusBarProps {
  pendingChanges: PendingChange[]
  isStreaming: boolean
  isAwaitingApproval: boolean
  streamingStatus?: string
  onStop?: () => void
  onReviewFile?: (filePath: string) => void
  onAcceptFile?: (filePath: string) => void
  onRejectFile?: (filePath: string) => void
  onUndoAll?: () => void
  onKeepAll?: () => void
}

export default function AgentStatusBar({
  pendingChanges,
  isStreaming,
  isAwaitingApproval,
  streamingStatus,
  onStop,
  onReviewFile,
  onAcceptFile,
  onRejectFile,
  onUndoAll,
  onKeepAll,
}: AgentStatusBarProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  // 计算统计信息
  const stats = useMemo(() => {
    let linesAdded = 0
    let linesRemoved = 0
    pendingChanges.forEach(change => {
      linesAdded += change.linesAdded || 0
      linesRemoved += change.linesRemoved || 0
    })
    return {
      total: pendingChanges.length,
      linesAdded,
      linesRemoved,
    }
  }, [pendingChanges])

  // 按目录分组
  const groupedChanges = useMemo(() => {
    const groups = new Map<string, PendingChange[]>()
    for (const change of pendingChanges) {
      const dir = getDirname(change.filePath) || '.'
      if (!groups.has(dir)) {
        groups.set(dir, [])
      }
      groups.get(dir)!.push(change)
    }
    return groups
  }, [pendingChanges])

  const hasChanges = pendingChanges.length > 0
  const showBar = isStreaming || isAwaitingApproval || hasChanges

  // 切换目录展开
  const toggleDir = useCallback((dir: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dir)) {
        next.delete(dir)
      } else {
        next.add(dir)
      }
      return next
    })
  }, [])

  // 处理接受变更
  const handleAccept = useCallback((e: React.MouseEvent, filePath: string) => {
    e.stopPropagation()
    onAcceptFile?.(filePath)
  }, [onAcceptFile])

  // 处理拒绝变更
  const handleReject = useCallback((e: React.MouseEvent, filePath: string) => {
    e.stopPropagation()
    onRejectFile?.(filePath)
  }, [onRejectFile])

  // 处理查看文件
  const handleReview = useCallback((e: React.MouseEvent, filePath: string) => {
    e.stopPropagation()
    onReviewFile?.(filePath)
  }, [onReviewFile])

  if (!showBar) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="mb-3"
    >
      {/* 主容器 - 与输入框风格统一 */}
      <div className="rounded-2xl border border-border bg-surface/30 backdrop-blur-xl overflow-hidden shadow-sm">
        {/* 流式状态 / 等待审批 */}
        {(isStreaming || isAwaitingApproval) && (
          <div className={`flex items-center justify-between px-4 py-2 ${hasChanges ? 'border-b border-border/50' : ''}`}>
            <div className="flex items-center gap-2.5">
              {isStreaming ? (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  <span className="text-[11px] font-medium text-shimmer">
                    {streamingStatus || 'Processing...'}
                  </span>
                </>
              ) : (
                <>
                  <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                  <span className="text-[11px] font-medium text-amber-400/80">
                    Waiting for approval
                  </span>
                </>
              )}
            </div>

            {/* Stop 按钮 - 仅流式时显示 */}
            {isStreaming && (
              <button
                onClick={onStop}
                className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-text-muted/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
              >
                <Square className="w-2.5 h-2.5 fill-current" />
                <span>Stop</span>
              </button>
            )}
          </div>
        )}

        {/* 文件变更区域 */}
        {hasChanges && (
          <>
            {/* Header - 可折叠 */}
            <div
              className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-surface-hover transition-colors"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              <div className="flex items-center gap-3">
                <motion.div
                  animate={{ rotate: isExpanded ? 0 : -90 }}
                  transition={{ duration: 0.15 }}
                  className="text-text-muted/50"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </motion.div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-text-muted/70">
                    {stats.total} file{stats.total > 1 ? 's' : ''} changed
                  </span>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono">
                    <span className="text-green-400/80">+{stats.linesAdded}</span>
                    <span className="text-red-400/80">-{stats.linesRemoved}</span>
                  </div>
                </div>
              </div>

              {/* 批量操作按钮 */}
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => onUndoAll?.()}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                  title="Reject All"
                >
                  <XCircle className="w-3 h-3" />
                  <span>Reject</span>
                </button>
                <button
                  onClick={() => onKeepAll?.()}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-green-400 bg-green-500/10 hover:bg-green-500/20 rounded-lg transition-all"
                  title="Accept All"
                >
                  <CheckCheck className="w-3 h-3" />
                  <span>Accept</span>
                </button>
              </div>
            </div>

            {/* 文件列表 - 可折叠 */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-border/50 max-h-[200px] overflow-y-auto custom-scrollbar">
                    {Array.from(groupedChanges.entries()).map(([dir, dirChanges]) => (
                      <div key={dir}>
                        {/* 目录头 */}
                        {groupedChanges.size > 1 && (
                          <div
                            className="flex items-center gap-2 px-4 py-1.5 text-[10px] text-text-muted/50 hover:text-text-muted cursor-pointer hover:bg-surface-hover transition-colors"
                            onClick={() => toggleDir(dir)}
                          >
                            {expandedDirs.has(dir) || groupedChanges.size === 1 ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3 -rotate-90" />
                            )}
                            <FolderOpen className="w-3 h-3 text-yellow-500/50" />
                            <span className="font-medium">{dir || '.'}</span>
                            <span className="text-[9px]">({dirChanges.length})</span>
                          </div>
                        )}

                        {/* 文件列表 */}
                        {(expandedDirs.has(dir) || groupedChanges.size === 1) && (
                          <div className={groupedChanges.size > 1 ? 'ml-4' : ''}>
                            {dirChanges.map(change => (
                              <FileChangeRow
                                key={change.filePath}
                                change={change}
                                onAccept={handleAccept}
                                onReject={handleReject}
                                onReview={handleReview}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </motion.div>
  )
}

// 单个文件变更行
interface FileChangeRowProps {
  change: PendingChange
  onAccept: (e: React.MouseEvent, filePath: string) => void
  onReject: (e: React.MouseEvent, filePath: string) => void
  onReview: (e: React.MouseEvent, filePath: string) => void
}

function FileChangeRow({ change, onAccept, onReject, onReview }: FileChangeRowProps) {
  const fileName = getFileName(change.filePath)

  // 变更类型图标
  const TypeIcon = change.changeType === 'create' ? FilePlus
    : change.changeType === 'delete' ? FileX
      : FileCode

  // 变更类型颜色
  const typeColor = change.changeType === 'create' ? 'text-green-400/60'
    : change.changeType === 'delete' ? 'text-red-400/60'
      : 'text-text-muted/60'

  return (
    <div
      className="flex items-center justify-between px-4 py-2 hover:bg-surface-hover cursor-pointer transition-colors group"
      onClick={(e) => onReview(e, change.filePath)}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <TypeIcon className={`w-3.5 h-3.5 ${typeColor} shrink-0 group-hover:text-accent/60 transition-colors`} />
        <div className="min-w-0 flex-1">
          <span className="text-[11px] text-text-muted/80 group-hover:text-text-secondary truncate transition-colors">
            {fileName}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[9px] font-mono opacity-50 group-hover:opacity-80 transition-opacity">
          {change.linesAdded !== undefined && change.linesAdded > 0 && (
            <span className="text-green-400">+{change.linesAdded}</span>
          )}
          {change.linesRemoved !== undefined && change.linesRemoved > 0 && (
            <span className="text-red-400">-{change.linesRemoved}</span>
          )}
        </div>
      </div>

      {/* 单文件操作 - hover 显示 */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => onReview(e, change.filePath)}
          className="p-1 text-text-muted/50 hover:text-accent hover:bg-accent/10 rounded transition-colors"
          title="View Diff"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => onReject(e, change.filePath)}
          className="p-1 text-text-muted/50 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
          title="Discard"
        >
          <X className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => onAccept(e, change.filePath)}
          className="p-1 text-green-400/50 hover:text-green-400 hover:bg-green-500/10 rounded transition-colors"
          title="Accept"
        >
          <Check className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}
