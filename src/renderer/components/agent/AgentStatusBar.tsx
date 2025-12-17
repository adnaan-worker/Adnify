/**
 * Agent 状态栏组件
 * Cursor 风格的底部状态栏
 * 显示：文件数量 | Undo | Keep | Review
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight, FileCode } from 'lucide-react'
import { PendingChange } from '../../agent/core/types'

interface AgentStatusBarProps {
  pendingChanges: PendingChange[]
  isStreaming: boolean
  isAwaitingApproval: boolean
  streamingStatus?: string
  onStop?: () => void
  onReview?: () => void
  onUndo?: () => void
  onKeep?: () => void
}

export default function AgentStatusBar({
  pendingChanges,
  isStreaming,
  isAwaitingApproval,
  streamingStatus,
  onStop,
  onReview,
  onUndo,
  onKeep,
}: AgentStatusBarProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const hasChanges = pendingChanges.length > 0
  const showBar = isStreaming || isAwaitingApproval || hasChanges

  if (!showBar) return null

  return (
    <div className="border-t border-border-subtle bg-surface/30">
      {/* 文件列表（可展开） */}
      {hasChanges && (
        <div className="border-b border-border-subtle/50">
          {/* 文件列表头部 */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center gap-2 px-4 py-2 hover:bg-surface/50 transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-text-muted" />
            ) : (
              <ChevronRight className="w-4 h-4 text-text-muted" />
            )}
            <span className="text-sm text-text-secondary">
              {pendingChanges.length} File{pendingChanges.length > 1 ? 's' : ''}
            </span>
          </button>

          {/* 展开的文件列表 */}
          {isExpanded && (
            <div className="px-4 pb-2 space-y-1">
              {pendingChanges.map((change) => {
                const fileName = change.filePath.split(/[\\/]/).pop() || change.filePath
                return (
                  <div
                    key={change.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface/50 transition-colors"
                  >
                    <FileCode className="w-4 h-4 text-accent flex-shrink-0" />
                    <span className="text-sm text-text-primary flex-1 truncate">{fileName}</span>
                    <span className="text-xs font-mono text-text-muted">
                      <span className="text-green-400">+{change.linesAdded}</span>
                      {change.linesRemoved > 0 && (
                        <span className="text-red-400 ml-1">-{change.linesRemoved}</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 操作栏 */}
      <div className="flex items-center justify-between px-4 py-2">
        {/* 左侧：状态信息 */}
        <div className="flex items-center gap-2">
          {/* 流式状态 */}
          {isStreaming && streamingStatus && (
            <span className="text-xs text-text-muted animate-pulse">
              {streamingStatus}
            </span>
          )}

          {/* 等待审批状态 */}
          {isAwaitingApproval && (
            <span className="text-xs text-amber-400">
              Waiting for approval...
            </span>
          )}
        </div>

        {/* 右侧：操作按钮 */}
        <div className="flex items-center gap-2">
          {/* Undo All 按钮 - 撤销所有更改 */}
          {hasChanges && !isStreaming && (
            <button
              onClick={onUndo}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
              title="Undo all changes and restore original files"
            >
              Undo All
            </button>
          )}

          {/* Accept All 按钮 - 接受所有更改（清除撤销历史） */}
          {hasChanges && !isStreaming && (
            <button
              onClick={onKeep}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-green-400 hover:bg-green-500/10 rounded transition-colors"
              title="Accept all changes (files are already saved, this clears undo history)"
            >
              Accept All
            </button>
          )}

          {/* Review 按钮 */}
          {hasChanges && !isStreaming && (
            <button
              onClick={onReview}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded transition-colors"
              title="Review all changes in diff view"
            >
              Review
            </button>
          )}

          {/* Stop 按钮 */}
          {isStreaming && (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-primary bg-surface-active hover:bg-surface-hover rounded transition-colors"
              title="Stop the current operation"
            >
              Stop
              <span className="text-[10px] text-text-muted">Ctrl+Shift+⌫</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
