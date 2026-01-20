/**
 * 检查点面板
 * 显示检查点历史，支持回滚操作
 * 
 * 数据来源：AgentStore.messageCheckpoints（消息级别的检查点）
 */

import { useState, useCallback, memo } from 'react'
import { History, RotateCcw, ChevronDown, ChevronUp, FileText, MessageSquare, X, Loader2 } from 'lucide-react'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { MessageCheckpoint } from '@/renderer/agent/types'
import { getFileName } from '@shared/utils/pathUtils'

interface CheckpointItemProps {
  checkpoint: MessageCheckpoint
  isCurrent: boolean
  onRollback: () => void
}

const CheckpointItem = memo(function CheckpointItem({
  checkpoint,
  isCurrent,
  onRollback,
}: CheckpointItemProps) {
  const [expanded, setExpanded] = useState(false)
  const fileCount = Object.keys(checkpoint.fileSnapshots).length

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div className="relative pl-4 group/item">
      {/* Timeline Line */}
      <div className="absolute left-[7px] top-0 bottom-0 w-[2px] bg-border-subtle group-last/item:bottom-auto group-last/item:h-4" />
      {/* Timeline Dot */}
      <div className={`
        absolute left-[3px] top-3.5 w-2.5 h-2.5 rounded-full border-2 transition-colors z-10
        ${isCurrent ? 'bg-accent border-accent shadow-[0_0_8px_rgba(var(--accent),0.5)]' : 'bg-surface border-text-muted/30 group-hover/item:border-text-muted'}
      `} />

      <div
        className={`
          ml-2 mb-2 rounded-lg transition-all duration-200 cursor-pointer border border-transparent
          ${isCurrent
            ? 'bg-accent/5 border-accent/20'
            : 'hover:bg-surface-hover hover:border-border-subtle'
          }
        `}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-3 p-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-medium truncate ${isCurrent ? 'text-accent' : 'text-text-primary'}`}>
                {checkpoint.description}
              </span>
              <span className="text-[10px] text-text-muted font-mono opacity-80">
                {formatTime(checkpoint.timestamp)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-text-secondary">
              <span className="flex items-center gap-1">
                <FileText className="w-3 h-3 opacity-70" />
                {fileCount} files
              </span>
              {isCurrent && (
                <span className="px-1.5 py-px rounded bg-accent/10 text-accent font-bold">Current</span>
              )}
            </div>
          </div>
          
          <div className="flex flex-col gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
            {!isCurrent && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onRollback()
                }}
                className="p-1 rounded hover:bg-surface-active text-text-muted hover:text-amber-400 transition-colors"
                title="Rollback"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
            )}
          </div>
        </div>

        {expanded && fileCount > 0 && (
          <div className="px-3 pb-3 pt-0 animate-slide-down">
            <div className="h-px bg-border-subtle/50 mb-2" />
            <div className="space-y-1 pl-1">
              {Object.keys(checkpoint.fileSnapshots).map((path) => (
                <div key={path} className="flex items-center gap-2 text-[10px] text-text-secondary">
                  <FileText className="w-3 h-3 opacity-50" />
                  <span className="truncate hover:text-text-primary transition-colors">{getFileName(path)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

interface CheckpointPanelProps {
  onClose?: () => void
}

export default function CheckpointPanel({ onClose }: CheckpointPanelProps) {
  // ... (store hooks remain the same)
  const messageCheckpoints = useAgentStore(state => state.messageCheckpoints)
  const restoreToCheckpoint = useAgentStore(state => state.restoreToCheckpoint)
  const addAssistantMessage = useAgentStore(state => state.addAssistantMessage)
  const appendToAssistant = useAgentStore(state => state.appendToAssistant)
  const finalizeAssistant = useAgentStore(state => state.finalizeAssistant)
  
  const [isRollingBack, setIsRollingBack] = useState(false)

  // 辅助函数：添加完整的助手消息
  const showMessage = useCallback((text: string) => {
    const id = addAssistantMessage()
    if (id) {
      appendToAssistant(id, text)
      finalizeAssistant(id)
    }
  }, [addAssistantMessage, appendToAssistant, finalizeAssistant])

  const handleRollback = useCallback(async (checkpoint: MessageCheckpoint) => {
    if (isRollingBack) return

    setIsRollingBack(true)
    try {
      const result = await restoreToCheckpoint(checkpoint.id)

      if (result.success) {
        showMessage(
          `✅ Rolled back to checkpoint: "${checkpoint.description}"\nRestored ${result.restoredFiles.length} file(s).`
        )
      } else {
        showMessage(
          `⚠️ Rollback completed with errors:\n${result.errors.join('\n')}`
        )
      }
    } catch (error: unknown) {
      const err = error as { message?: string }
      showMessage(
        `❌ Rollback failed: ${err.message}`
      )
    } finally {
      setIsRollingBack(false)
    }
  }, [isRollingBack, restoreToCheckpoint, showMessage])

  if (messageCheckpoints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center opacity-60">
        <div className="w-12 h-12 bg-surface/50 rounded-full flex items-center justify-center mb-3 border border-border shadow-sm">
          <History className="w-6 h-6 text-text-muted" />
        </div>
        <p className="text-xs font-medium text-text-secondary">No checkpoints yet</p>
        <p className="text-[10px] text-text-muted mt-1 max-w-[200px]">
          Checkpoints are created automatically when you send messages.
        </p>
      </div>
    )
  }

  // 最新的检查点是当前检查点
  const currentCheckpointId = messageCheckpoints[messageCheckpoints.length - 1]?.id

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-border bg-background-secondary/95 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider opacity-80">
            History
          </span>
          <span className="px-1.5 py-0.5 rounded-full bg-surface-active text-[10px] font-mono text-text-muted">
            {messageCheckpoints.length}
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-active transition-colors text-text-muted hover:text-text-primary"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* List - Timeline */}
      <div className="flex-1 overflow-auto p-2 pt-4">
        {[...messageCheckpoints].reverse().map((checkpoint) => (
          <CheckpointItem
            key={checkpoint.id}
            checkpoint={checkpoint}
            isCurrent={checkpoint.id === currentCheckpointId}
            onRollback={() => handleRollback(checkpoint)}
          />
        ))}
      </div>

      {/* Footer */}
      {isRollingBack && (
        <div className="px-3 py-2 border-t border-border bg-surface/50 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-xs text-text-secondary animate-pulse">
            <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
            Restoring checkpoint...
          </div>
        </div>
      )}
    </div>
  )
}
