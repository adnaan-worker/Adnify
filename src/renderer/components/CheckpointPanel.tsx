/**
 * 检查点面板
 * 显示检查点历史，支持回滚操作
 */

import { useState, useCallback, memo } from 'react'
import { History, RotateCcw, ChevronDown, ChevronUp, FileText, MessageSquare, Wrench, X } from 'lucide-react'
import { useStore } from '@/renderer/store'
import { useAgentStore } from '@/renderer/agent/core/AgentStore'
import { checkpointService } from '@/renderer/agent/checkpointService'
import { getFileName } from '@/renderer/utils/pathUtils'

// Checkpoint 类型定义
interface Checkpoint {
  id: string
  type: 'user_message' | 'tool_edit'
  description: string
  timestamp: number
  snapshots: Record<string, { content: string }>
}

interface CheckpointItemProps {
  checkpoint: Checkpoint
  isCurrent: boolean
  onRollback: () => void
}

const CheckpointItem = memo(function CheckpointItem({
  checkpoint,
  isCurrent,
  onRollback,
}: CheckpointItemProps) {
  const [expanded, setExpanded] = useState(false)
  const fileCount = Object.keys(checkpoint.snapshots).length

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const TypeIcon = checkpoint.type === 'user_message' ? MessageSquare : Wrench

  return (
    <div
      className={`
        border rounded-lg overflow-hidden transition-colors
        ${isCurrent
          ? 'border-editor-accent bg-editor-accent/10'
          : 'border-editor-border bg-editor-bg/50 hover:bg-editor-hover/50'
        }
      `}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <TypeIcon className={`w-4 h-4 ${isCurrent ? 'text-editor-accent' : 'text-editor-text-muted'}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-editor-text truncate">
            {checkpoint.description}
          </div>
          <div className="text-xs text-editor-text-muted">
            {formatTime(checkpoint.timestamp)} • {fileCount} file(s)
          </div>
        </div>
        {isCurrent && (
          <span className="px-2 py-0.5 text-xs bg-editor-accent text-white rounded">
            Current
          </span>
        )}
        {!isCurrent && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRollback()
            }}
            className="p-1.5 rounded hover:bg-editor-hover transition-colors"
            title="Rollback to this checkpoint"
          >
            <RotateCcw className="w-4 h-4 text-editor-text-muted hover:text-editor-accent" />
          </button>
        )}
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-editor-text-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-editor-text-muted" />
        )}
      </div>

      {expanded && fileCount > 0 && (
        <div className="px-3 pb-2 border-t border-editor-border/50">
          <div className="text-xs text-editor-text-muted mt-2 mb-1">Saved files:</div>
          <div className="space-y-1">
            {Object.keys(checkpoint.snapshots).map((path) => (
              <div
                key={path}
                className="flex items-center gap-2 text-xs text-editor-text"
              >
                <FileText className="w-3 h-3 text-editor-text-muted" />
                <span className="truncate">{getFileName(path)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

interface CheckpointPanelProps {
  onClose?: () => void
}

export default function CheckpointPanel({ onClose }: CheckpointPanelProps) {
  const { checkpoints, currentCheckpointIdx, setCurrentCheckpointIdx } = useStore()
  const addAssistantMessage = useAgentStore(state => state.addAssistantMessage)
  const appendToAssistant = useAgentStore(state => state.appendToAssistant)
  const finalizeAssistant = useAgentStore(state => state.finalizeAssistant)
  const [isRollingBack, setIsRollingBack] = useState(false)
  
  // 辅助函数：添加完整的助手消息
  const showMessage = (text: string) => {
    const id = addAssistantMessage()
    if (id) {
      appendToAssistant(id, text)
      finalizeAssistant(id)
    }
  }

  const handleRollback = useCallback(async (checkpoint: Checkpoint) => {
    if (isRollingBack) return

    setIsRollingBack(true)
    try {
      const result = await checkpointService.rollbackTo(checkpoint.id)

      if (result.success) {
        showMessage(
          `✅ Rolled back to checkpoint: "${checkpoint.description}"\nRestored ${result.restoredFiles.length} file(s).`
        )

        // 更新当前检查点索引
        const idx = checkpoints.findIndex(c => c.id === checkpoint.id)
        if (idx !== -1) {
          setCurrentCheckpointIdx(idx)
        }
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
  }, [isRollingBack, checkpoints, addAssistantMessage, setCurrentCheckpointIdx])

  if (checkpoints.length === 0) {
    return (
      <div className="p-4 text-center text-editor-text-muted">
        <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No checkpoints yet</p>
        <p className="text-xs mt-1">Checkpoints are created automatically when you send messages or edit files.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-editor-border">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-editor-accent" />
          <span className="text-sm font-medium text-editor-text">
            Checkpoints
          </span>
          <span className="text-xs text-editor-text-muted">
            ({checkpoints.length})
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-editor-hover transition-colors"
          >
            <X className="w-4 h-4 text-editor-text-muted" />
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto p-2 space-y-2">
        {[...checkpoints].reverse().map((checkpoint, idx) => {
          const actualIdx = checkpoints.length - 1 - idx
          return (
            <CheckpointItem
              key={checkpoint.id}
              checkpoint={checkpoint}
              isCurrent={actualIdx === currentCheckpointIdx}
              onRollback={() => handleRollback(checkpoint)}
            />
          )
        })}
      </div>

      {/* Footer */}
      {isRollingBack && (
        <div className="px-3 py-2 border-t border-editor-border bg-editor-bg/50">
          <div className="flex items-center gap-2 text-sm text-editor-text-muted">
            <div className="w-4 h-4 border-2 border-editor-accent border-t-transparent rounded-full animate-spin" />
            Rolling back...
          </div>
        </div>
      )}
    </div>
  )
}
