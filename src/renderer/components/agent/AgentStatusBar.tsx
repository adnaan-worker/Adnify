/**
 * Agent 状态栏组件
 * Cursor 风格的底部状态栏 - 扁平化设计
 * 支持折叠、单条文件预览、接受、拒绝
 */

import { useState } from 'react'
import { X, Check, ExternalLink, Square, ChevronDown, ChevronRight } from 'lucide-react'
import { PendingChange } from '../../agent/core/types'

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

  const hasChanges = pendingChanges.length > 0
  const showBar = isStreaming || isAwaitingApproval || hasChanges

  if (!showBar) return null

  return (
    <div className="border-t border-white/5 bg-black/20 backdrop-blur-md">
      {/* 顶部操作栏：文件标签 + 全局操作 */}
      {hasChanges && (
        <div className="flex items-center justify-between px-2.5 py-1">
          {/* 左侧：折叠按钮 + 文件标签 */}
          <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-0.5 text-text-muted hover:text-text-primary transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
            {pendingChanges.slice(0, 3).map((change) => {
              const fileName = change.filePath.split(/[\\/]/).pop() || change.filePath
              return (
                <button
                  key={change.id}
                  onClick={() => onReviewFile?.(change.filePath)}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary hover:bg-white/5 rounded transition-colors whitespace-nowrap"
                  title={change.filePath}
                >
                  {fileName}
                </button>
              )
            })}
            {pendingChanges.length > 3 && (
              <span className="text-[10px] text-text-muted px-1">
                +{pendingChanges.length - 3}
              </span>
            )}
          </div>

          {/* 右侧：全局操作 */}
          <div className="flex items-center gap-1 ml-2 flex-shrink-0">
            <button
              onClick={onUndoAll}
              className="px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text-primary hover:bg-white/5 rounded transition-colors"
            >
              Undo
            </button>
            <button
              onClick={onKeepAll}
              className="px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text-primary hover:bg-white/5 rounded transition-colors"
            >
              Keep
            </button>
            <button
              onClick={() => onReviewFile?.(pendingChanges[0]?.filePath)}
              className="px-2 py-0.5 text-[10px] font-medium text-white bg-accent/80 hover:bg-accent rounded transition-colors shadow-sm shadow-accent/20"
            >
              Review
            </button>
          </div>
        </div>
      )}

      {/* 文件列表 - 可折叠 */}
      {hasChanges && isExpanded && (
        <div className="max-h-32 overflow-y-auto border-t border-white/5 custom-scrollbar">
          {pendingChanges.map((change) => {
            const fileName = change.filePath.split(/[\\/]/).pop() || change.filePath
            return (
              <div
                key={change.id}
                className="group flex items-center gap-2 px-2.5 py-0.5 hover:bg-white/5 transition-colors"
              >
                {/* 文件图标 + 名称 */}
                <span className="text-accent text-xs opacity-80">{'<>'}</span>
                <span className="text-[11px] text-text-primary flex-1 truncate opacity-90">
                  {fileName}
                </span>

                {/* 行数变化 */}
                <span className="text-[10px] font-mono opacity-70">
                  <span className="text-green-400">+{change.linesAdded}</span>
                  {change.linesRemoved > 0 && (
                    <span className="text-red-400 ml-1">-{change.linesRemoved}</span>
                  )}
                </span>

                {/* 单条操作按钮 - hover 时显示 */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onRejectFile?.(change.filePath)}
                    className="p-0.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                    title="Reject this change"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => onAcceptFile?.(change.filePath)}
                    className="p-0.5 text-text-muted hover:text-green-400 hover:bg-green-500/10 rounded transition-colors"
                    title="Accept this change"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => onReviewFile?.(change.filePath)}
                    className="p-0.5 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors"
                    title="Review in diff view"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 流式状态 / 等待审批状态 */}
      {(isStreaming || isAwaitingApproval) && (
        <div className="flex items-center justify-between px-2.5 py-1 border-t border-white/5 bg-white/[0.02]">
          <span className="text-[10px] text-text-muted flex items-center gap-2">
            {isStreaming && (
              <>
                <div className="w-1 h-1 bg-accent rounded-full animate-pulse" />
                {streamingStatus}
              </>
            )}
            {isAwaitingApproval && !isStreaming && (
              <span className="text-amber-400 flex items-center gap-1.5">
                <div className="w-1 h-1 bg-amber-400 rounded-full animate-pulse" />
                Waiting for approval...
              </span>
            )}
          </span>
          {isStreaming && (
            <button
              onClick={onStop}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text-primary hover:bg-white/10 rounded transition-colors"
            >
              <Square className="w-2.5 h-2.5" />
              Stop
            </button>
          )}
        </div>
      )}
    </div>
  )
}
