/**
 * 文件变更卡片组件
 * Cursor 风格的文件变更显示
 */

import { useState, useCallback, useMemo } from 'react'
import {
  ChevronRight,
  ChevronDown,
  FileCode,
  Check,
  X,
  Loader2,
  ExternalLink,
} from 'lucide-react'
import { ToolCall, ToolStatus } from '../../agent/core/types'

interface FileChangeCardProps {
  toolCall: ToolCall
  isAwaitingApproval?: boolean
  onApprove?: () => void
  onReject?: () => void
  onOpenInEditor?: (path: string, oldContent: string, newContent: string) => void
}

export default function FileChangeCard({
  toolCall,
  isAwaitingApproval,
  onApprove,
  onReject,
  onOpenInEditor,
}: FileChangeCardProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const { name, arguments: args, status, error } = toolCall
  const isStreaming = args._streaming === true
  const meta = args._meta as { filePath?: string; oldContent?: string; newContent?: string; linesAdded?: number; linesRemoved?: number; isNewFile?: boolean } | undefined

  // 获取文件路径和内容
  const filePath = (meta?.filePath || args.path || '') as string
  const fileName = filePath.split(/[\\/]/).pop() || filePath
  const oldContent = (meta?.oldContent || args.old_string || '') as string
  const newContent = (meta?.newContent || args.content || args.new_string || '') as string
  const isNewFile = meta?.isNewFile || false

  // 计算行数变化
  const linesAdded = meta?.linesAdded ?? (newContent ? newContent.split('\n').length : 0)
  const linesRemoved = meta?.linesRemoved ?? (oldContent ? oldContent.split('\n').length : 0)

  // 状态样式
  const getStatusStyles = useCallback(() => {
    if (isStreaming) return 'border-blue-500/40 bg-blue-500/5'
    if (status === 'awaiting') return 'border-amber-500/50 bg-amber-500/5'
    if (status === 'running') return 'border-blue-500/40 bg-blue-500/5'
    if (status === 'success') return 'border-green-500/30 bg-green-500/5'
    if (status === 'error') return 'border-red-500/30 bg-red-500/5'
    if (status === 'rejected') return 'border-gray-500/30 bg-gray-500/5'
    return 'border-border-subtle/50 bg-surface/30'
  }, [status, isStreaming])

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

  // 点击卡片展开/收起
  const handleToggle = useCallback(() => {
    if (newContent || oldContent) {
      setIsExpanded(!isExpanded)
    }
  }, [newContent, oldContent, isExpanded])

  // 在编辑器中打开
  const handleOpenInEditor = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (onOpenInEditor && filePath) {
      onOpenInEditor(filePath, oldContent, newContent)
    }
  }, [onOpenInEditor, filePath, oldContent, newContent])

  const hasContent = newContent || oldContent

  return (
    <div className={`rounded-lg border overflow-hidden transition-all ${getStatusStyles()}`}>
      {/* Header */}
      <div
        className={`flex items-center gap-2 px-3 py-2.5 ${hasContent ? 'cursor-pointer hover:bg-white/5' : ''}`}
        onClick={handleToggle}
      >
        {/* 展开图标 */}
        {hasContent && (
          isExpanded
            ? <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
            : <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
        )}

        {/* 文件图标 */}
        <FileCode className={`w-4 h-4 flex-shrink-0 ${
          isStreaming ? 'text-blue-400' :
          status === 'success' ? 'text-green-400' :
          status === 'error' ? 'text-red-400' :
          'text-text-muted'
        }`} />

        {/* 文件名 */}
        <span className={`text-sm font-medium flex-1 truncate ${
          isStreaming ? 'text-blue-300' :
          status === 'success' ? 'text-green-300' :
          status === 'error' ? 'text-red-300' :
          'text-text-primary'
        }`}>
          {fileName || 'Unknown file'}
          {isNewFile && <span className="ml-1.5 text-xs text-green-400">(new)</span>}
        </span>

        {/* 状态图标 */}
        {StatusIcon}

        {/* 行数变化 */}
        {hasContent && !isStreaming && (
          <span className="text-xs font-mono text-text-muted">
            <span className="text-green-400">+{linesAdded}</span>
            {linesRemoved > 0 && (
              <>
                {' '}
                <span className="text-red-400">-{linesRemoved}</span>
              </>
            )}
          </span>
        )}

        {/* 流式指示 */}
        {isStreaming && (
          <span className="text-xs text-blue-400 animate-pulse">streaming...</span>
        )}

        {/* 状态标签 */}
        {status === 'success' && !isStreaming && (
          <span className="text-xs text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">Applied</span>
        )}
        {status === 'rejected' && (
          <span className="text-xs text-gray-400 bg-gray-500/10 px-1.5 py-0.5 rounded">Rejected</span>
        )}
        {status === 'error' && (
          <span className="text-xs text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">Error</span>
        )}

        {/* 在编辑器中打开 */}
        {filePath && !isStreaming && status === 'success' && (
          <button
            onClick={handleOpenInEditor}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="Open diff in editor"
          >
            <ExternalLink className="w-3.5 h-3.5 text-text-muted" />
          </button>
        )}

        {/* 审批按钮 */}
        {isAwaitingApproval && status === 'awaiting' && onApprove && onReject && (
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={(e) => { e.stopPropagation(); onApprove() }}
              className="p-1.5 text-green-400 hover:bg-green-500/20 rounded-md transition-colors"
              title="Accept"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onReject() }}
              className="p-1.5 text-red-400 hover:bg-red-500/20 rounded-md transition-colors"
              title="Reject"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* 代码预览 */}
      {isExpanded && hasContent && (
        <div className="border-t border-border-subtle/30">
          {name === 'edit_file' && oldContent ? (
            // Edit: 显示 diff 预览
            <div className="text-xs font-mono max-h-64 overflow-auto">
              {/* 删除的行 */}
              {oldContent.split('\n').slice(0, 8).map((line, i) => (
                <div key={`old-${i}`} className="px-3 py-0.5 bg-red-500/10 text-red-300/90 flex">
                  <span className="w-6 text-red-500/50 select-none text-right pr-2 flex-shrink-0">{i + 1}</span>
                  <span className="w-3 text-red-500/60 select-none flex-shrink-0">-</span>
                  <span className="flex-1 whitespace-pre overflow-hidden text-ellipsis">{line}</span>
                </div>
              ))}
              {oldContent.split('\n').length > 8 && (
                <div className="px-3 py-1 text-red-400/50 text-center text-[10px] bg-red-500/5">
                  ... {oldContent.split('\n').length - 8} more lines
                </div>
              )}
              {/* 添加的行 */}
              {newContent.split('\n').slice(0, 8).map((line, i) => (
                <div key={`new-${i}`} className="px-3 py-0.5 bg-green-500/10 text-green-300/90 flex">
                  <span className="w-6 text-green-500/50 select-none text-right pr-2 flex-shrink-0">{i + 1}</span>
                  <span className="w-3 text-green-500/60 select-none flex-shrink-0">+</span>
                  <span className="flex-1 whitespace-pre overflow-hidden text-ellipsis">{line}</span>
                </div>
              ))}
              {newContent.split('\n').length > 8 && (
                <div className="px-3 py-1 text-green-400/50 text-center text-[10px] bg-green-500/5">
                  ... {newContent.split('\n').length - 8} more lines
                </div>
              )}
            </div>
          ) : (
            // Write/Create: 显示新内容
            <div className="text-xs font-mono max-h-64 overflow-auto bg-green-500/5">
              {newContent.split('\n').slice(0, 12).map((line, i) => (
                <div key={i} className="px-3 py-0.5 text-green-300/90 flex">
                  <span className="w-6 text-green-500/40 select-none text-right pr-2 flex-shrink-0">{i + 1}</span>
                  <span className="w-3 text-green-500/50 select-none flex-shrink-0">+</span>
                  <span className="flex-1 whitespace-pre overflow-hidden text-ellipsis">{line}</span>
                </div>
              ))}
              {newContent.split('\n').length > 12 && (
                <div className="px-3 py-1 text-green-400/50 text-center text-[10px]">
                  ... {newContent.split('\n').length - 12} more lines
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 错误信息 */}
      {error && (
        <div className="px-3 py-2 text-xs text-red-400 bg-red-500/10 border-t border-red-500/20">
          {error}
        </div>
      )}
    </div>
  )
}
