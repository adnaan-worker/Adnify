/**
 * 工具调用卡片组件
 * 用于显示非文件操作的工具调用（如 read_file, search_files 等）
 */

import { useState, useCallback, useMemo } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  Check,
  X,
} from 'lucide-react'
import { ToolCall } from '../../agent/core/types'
import { TOOL_DISPLAY_NAMES } from '../../agent/core/ToolExecutor'

interface ToolCallCardProps {
  toolCall: ToolCall
  isAwaitingApproval?: boolean
  onApprove?: () => void
  onReject?: () => void
}

export default function ToolCallCard({
  toolCall,
  isAwaitingApproval,
  onApprove,
  onReject,
}: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const { name, arguments: args, status, result, error } = toolCall
  const isStreaming = args._streaming === true

  // 获取显示名称
  const displayName = TOOL_DISPLAY_NAMES[name] || name

  // 获取主要描述（如文件路径、命令等）
  const primaryDesc = useMemo(() => {
    if (args.path) return String(args.path).split(/[\\/]/).pop()
    if (args.command) return String(args.command).slice(0, 50)
    if (args.pattern) return `"${String(args.pattern).slice(0, 30)}"`
    return null
  }, [args])

  // 状态图标
  const StatusIcon = useMemo(() => {
    if (isStreaming || status === 'running' || status === 'pending') {
      return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
    }
    if (status === 'success') {
      return <div className="w-2 h-2 rounded-full bg-green-500" />
    }
    if (status === 'error') {
      return <div className="w-2 h-2 rounded-full bg-red-500" />
    }
    if (status === 'awaiting') {
      return <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
    }
    if (status === 'rejected') {
      return <div className="w-2 h-2 rounded-full bg-gray-500" />
    }
    return <div className="w-2 h-2 rounded-full bg-gray-400" />
  }, [status, isStreaming])

  const hasResult = result && status === 'success'

  const handleToggle = useCallback(() => {
    if (hasResult) {
      setIsExpanded(!isExpanded)
    }
  }, [hasResult, isExpanded])

  return (
    <div className={`
      rounded-md border transition-all
      ${isStreaming ? 'border-blue-500/30 bg-blue-500/5' : 'border-border-subtle/30 bg-surface/20'}
      ${hasResult ? 'hover:bg-white/5' : ''}
    `}>
      <div
        className={`flex items-center gap-2 px-3 py-2 ${hasResult ? 'cursor-pointer' : ''}`}
        onClick={handleToggle}
      >
        {/* 状态图标 */}
        {StatusIcon}

        {/* 工具名称 */}
        <span className={`text-xs font-medium ${
          isStreaming ? 'text-blue-400' :
          status === 'success' ? 'text-green-400' :
          status === 'error' ? 'text-red-400' :
          'text-text-muted'
        }`}>
          {displayName}
        </span>

        {/* 主要描述 */}
        {primaryDesc && (
          <span className="text-xs text-text-muted/70 truncate max-w-[200px] font-mono">
            {primaryDesc}
          </span>
        )}

        <div className="flex-1" />

        {/* 流式指示 */}
        {isStreaming && (
          <span className="text-xs text-blue-400 animate-pulse">running...</span>
        )}

        {/* 错误标签 */}
        {status === 'error' && (
          <span className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">Error</span>
        )}

        {/* 审批按钮 */}
        {isAwaitingApproval && status === 'awaiting' && onApprove && onReject && (
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onApprove() }}
              className="p-1.5 text-green-400 hover:bg-green-500/20 rounded-md transition-colors"
              title="Accept"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onReject() }}
              className="p-1.5 text-red-400 hover:bg-red-500/20 rounded-md transition-colors"
              title="Reject"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 展开图标 */}
        {hasResult && (
          isExpanded
            ? <ChevronDown className="w-3.5 h-3.5 text-text-muted/50" />
            : <ChevronRight className="w-3.5 h-3.5 text-text-muted/50" />
        )}
      </div>

      {/* 结果展开 */}
      {isExpanded && hasResult && (
        <div className="px-3 pb-2 border-t border-border-subtle/30 pt-2">
          <pre className={`text-[10px] ${error ? 'text-red-400' : 'text-text-muted'} bg-black/20 rounded p-2 overflow-auto max-h-40 font-mono whitespace-pre-wrap`}>
            {result.slice(0, 1500)}{result.length > 1500 ? '\n...(truncated)' : ''}
          </pre>
        </div>
      )}

      {/* 错误信息 */}
      {error && !isExpanded && (
        <div className="px-3 pb-2 text-[10px] text-red-400 truncate">
          {error}
        </div>
      )}
    </div>
  )
}
