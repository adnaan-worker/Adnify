/**
 * Global Changes Panel
 * Cursor 风格的底部状态栏 - 简洁显示文件数量和操作按钮
 */

import { useMemo } from 'react'
import {
  Check,
  X,
  FileText,
  Loader2,
  Square,
} from 'lucide-react'
import { AssistantMessage } from '../../agent/core/types'

// ===== 类型定义 =====

interface PendingFileChange {
  path: string
  fileName: string
  toolCallId: string
  status: 'pending' | 'running' | 'awaiting'
  toolName: string
}

interface GlobalChangesPanelProps {
  messages: any[]
  isStreaming: boolean
  isAwaitingApproval: boolean
  streamingStatus?: string  // 'Planning next moves', 'Writing code', etc.
  onApprove: () => void
  onReject: () => void
  onAbort: () => void
  onFileClick?: (path: string) => void
}

// ===== 主组件 =====

export default function GlobalChangesPanel({
  messages,
  isStreaming,
  isAwaitingApproval,
  streamingStatus,
  onApprove,
  onReject,
  onAbort,
}: GlobalChangesPanelProps) {
  // 从消息中提取待处理的写入操作，按文件合并
  const pendingChanges = useMemo(() => {
    const fileMap = new Map<string, PendingFileChange>()
    const writeTools = ['edit_file', 'write_file', 'create_file_or_folder', 'delete_file_or_folder']

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue
      const assistantMsg = msg as AssistantMessage
      if (!assistantMsg.toolCalls) continue

      for (const tc of assistantMsg.toolCalls) {
        // 只处理写入类工具
        if (!writeTools.includes(tc.name)) continue

        const path = tc.rawParams?.path ? String(tc.rawParams.path) : undefined
        if (!path) continue

        // 检查状态 - 只处理待审批或进行中的
        const status = tc.status as string
        const isPending = status === 'tool_request' || status === 'pending' || status === 'running_now'

        if (!isPending) {
          // 如果这个文件之前有待审批的，现在完成了，从 map 中移除
          if (fileMap.has(path)) {
            fileMap.delete(path)
          }
          continue
        }

        const newStatus: 'pending' | 'running' | 'awaiting' =
          status === 'tool_request' ? 'awaiting' :
            status === 'running_now' ? 'running' : 'pending'

        // 按文件路径合并，保留最新的状态
        fileMap.set(path, {
          path,
          fileName: path.split(/[\\/]/).pop() || path,
          toolCallId: tc.id,
          status: newStatus,
          toolName: tc.name,
        })
      }
    }

    return Array.from(fileMap.values())
  }, [messages])

  // 统计
  const awaitingCount = pendingChanges.filter(c => c.status === 'awaiting').length
  const runningCount = pendingChanges.filter(c => c.status === 'running' || c.status === 'pending').length
  const totalPending = pendingChanges.length

  // 如果没有任何状态需要显示，不渲染
  if (!isStreaming && totalPending === 0) return null

  return (
    <div className="mx-4 mb-2 flex items-center justify-between gap-3 animate-fade-in">
      {/* 左侧：状态信息 */}
      <div className="flex items-center gap-3 text-sm">
        {/* 流式状态 */}
        {isStreaming && (
          <div className="flex items-center gap-2 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin text-accent" />
            <span>{streamingStatus || 'Thinking...'}</span>
          </div>
        )}

        {/* 文件变更计数 */}
        {totalPending > 0 && (
          <div className="flex items-center gap-1.5 text-text-secondary">
            <FileText className="w-4 h-4 opacity-70" />
            <span className="opacity-90">
              {totalPending} File{totalPending !== 1 ? 's' : ''}
            </span>
            {runningCount > 0 && (
              <span className="text-accent text-xs opacity-80">
                ({runningCount} writing)
              </span>
            )}
          </div>
        )}
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-2">
        {/* 流式时显示 Stop 按钮 */}
        {isStreaming && (
          <button
            onClick={onAbort}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-primary hover:bg-white/10 border border-white/5 rounded-md transition-colors"
          >
            <Square className="w-3 h-3" />
            Stop
          </button>
        )}

        {/* 有待审批时显示 Review 按钮 */}
        {!isStreaming && awaitingCount > 0 && isAwaitingApproval && (
          <>
            <button
              onClick={onReject}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 border border-white/5 rounded-md transition-colors"
            >
              <X className="w-3 h-3" />
              Reject
            </button>
            <button
              onClick={onApprove}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent/80 text-white hover:bg-accent border border-transparent rounded-md transition-colors shadow-sm shadow-accent/20"
            >
              <Check className="w-3 h-3" />
              Accept
            </button>
          </>
        )}
      </div>
    </div>
  )
}
