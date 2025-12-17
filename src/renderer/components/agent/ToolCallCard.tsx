/**
 * 工具调用卡片 - Cursor 风格设计
 * 支持流式参数预览、状态指示、结果展示
 */

import { useStore } from '../../store'
import { t } from '../../i18n'
import { useState, useMemo, useEffect } from 'react'
import {
  Check, X, ChevronDown, ChevronRight, Loader2,
  Terminal, Search, FolderOpen, FileText, Edit3,
  Trash2, Eye, Copy, ArrowRight, AlertTriangle
} from 'lucide-react'
import { ToolCall } from '../../agent/core/types'

interface ToolCallCardProps {
  toolCall: ToolCall
  isAwaitingApproval?: boolean
  onApprove?: () => void
  onReject?: () => void
}

// 工具图标映射
const TOOL_ICONS: Record<string, React.ReactNode> = {
  run_command: <Terminal className="w-3.5 h-3.5" />,
  search_files: <Search className="w-3.5 h-3.5" />,
  list_directory: <FolderOpen className="w-3.5 h-3.5" />,
  read_file: <Eye className="w-3.5 h-3.5" />,
  write_file: <Edit3 className="w-3.5 h-3.5" />,
  create_file: <FileText className="w-3.5 h-3.5" />,
  edit_file: <Edit3 className="w-3.5 h-3.5" />,
  delete_file_or_folder: <Trash2 className="w-3.5 h-3.5" />,
}

// 工具标签映射
const TOOL_LABELS: Record<string, string> = {
  run_command: 'Run Command',
  search_files: 'Search Files',
  list_directory: 'List Directory',
  read_file: 'Read File',
  write_file: 'Write File',
  create_file: 'Create File',
  edit_file: 'Edit File',
  delete_file_or_folder: 'Delete',
}

// 工具颜色映射
const TOOL_COLORS: Record<string, string> = {
  run_command: 'text-green-400',
  search_files: 'text-blue-400',
  list_directory: 'text-yellow-400',
  read_file: 'text-cyan-400',
  write_file: 'text-purple-400',
  create_file: 'text-emerald-400',
  edit_file: 'text-orange-400',
  delete_file_or_folder: 'text-red-400',
}

export default function ToolCallCard({
  toolCall,
  isAwaitingApproval,
  onApprove,
  onReject,
}: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { language } = useStore()

  const args = toolCall.arguments as Record<string, unknown>
  const isStreaming = args._streaming === true
  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending'
  const isSuccess = toolCall.status === 'success'
  const isError = toolCall.status === 'error'
  const isRejected = toolCall.status === 'rejected'

  // 自动展开 logic: 当工具正在运行、流式传输中或刚成功，且是编辑类操作时，自动展开
  useEffect(() => {
    if ((isRunning || isStreaming || isSuccess) && (toolCall.name === 'edit_file' || toolCall.name === 'write_file' || toolCall.name === 'create_file')) {
      setIsExpanded(true)
    }
  }, [isRunning, isStreaming, isSuccess, toolCall.name])

  // 获取主要的代码内容参数
  const codeContent = useMemo(() => {
    if (!args) return null
    return (args.code || args.content || args.search_replace_blocks || args.replacement || args.source) as string
  }, [args])

  // 获取简短描述
  const description = useMemo(() => {
    const name = toolCall.name
    if (name === 'run_command') {
      const cmd = args.command as string
      return cmd?.length > 60 ? cmd.slice(0, 60) + '...' : cmd
    }
    if (name === 'read_file' || name === 'write_file' || name === 'create_file' || name === 'edit_file') {
      const path = args.path as string
      return path?.split(/[\\/]/).pop() || path
    }
    if (name === 'search_files') return `"${args.query}"`
    if (name === 'list_directory') {
      const path = args.path as string
      return path?.split(/[\\/]/).pop() || path || '.'
    }
    if (name === 'delete_file_or_folder') {
      const path = args.path as string
      return path?.split(/[\\/]/).pop() || path
    }
    return ''
  }, [toolCall.name, args])

  // 复制结果到剪贴板
  const handleCopyResult = () => {
    if (toolCall.result) {
      navigator.clipboard.writeText(toolCall.result)
    }
  }

  // 状态指示器
  const StatusIndicator = () => {
    if (isStreaming) {
      return (
        <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-accent/10 rounded-full border border-accent/20">
          <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
          <span className="text-[9px] font-medium text-accent uppercase tracking-wider">{t('toolStreaming', language)}</span>
        </div>
      )
    }
    if (isRunning) {
      return (
        <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-accent/10 rounded-full border border-accent/20">
          <Loader2 className="w-2.5 h-2.5 text-accent animate-spin" />
          <span className="text-[9px] font-medium text-accent uppercase tracking-wider">Running</span>
        </div>
      )
    }
    if (isSuccess) {
      return <Check className="w-3.5 h-3.5 text-green-400" />
    }
    if (isError) {
      return <X className="w-3.5 h-3.5 text-red-400" />
    }
    if (isRejected) {
      return <X className="w-3.5 h-3.5 text-yellow-400" />
    }
    return null
  }

  return (
    <div className={`my-1 rounded border overflow-hidden transition-all duration-200 ${isAwaitingApproval
      ? 'border-yellow-500/30 bg-yellow-500/5 shadow-[0_0_15px_-3px_rgba(234,179,8,0.1)]'
      : isError
        ? 'border-red-500/20 bg-red-500/5'
        : 'border-white/5 bg-surface/40 backdrop-blur-sm hover:bg-surface/60 shadow-sm'
      }`}>
      {/* 头部 */}
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer select-none group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className={`p-1 rounded bg-white/5 border border-white/5 ${TOOL_COLORS[toolCall.name] || 'text-text-muted'} group-hover:bg-white/10 transition-colors`}>
          {TOOL_ICONS[toolCall.name] || <span className="text-[10px]">⚡</span>}
        </div>

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[11px] font-medium text-text-secondary group-hover:text-text-primary transition-colors">
            {TOOL_LABELS[toolCall.name] || toolCall.name}
          </span>

          {description && (
            <div className="flex items-center gap-1 min-w-0">
              <ArrowRight className="w-3 h-3 text-text-muted/50" />
              <span className="text-[10px] text-text-muted truncate font-mono opacity-70 group-hover:opacity-100 transition-opacity">
                {description}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <StatusIndicator />
          <button className="p-0.5 hover:bg-white/10 rounded transition-colors text-text-muted">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      {/* 展开的详情 */}
      {isExpanded && (
        <div className="border-t border-white/5 bg-black/5 animate-slide-down">

          {/* 代码预览 (Streaming Args) */}
          {codeContent && (
            <div className="border-b border-white/5">
              <div className="flex items-center justify-between px-2.5 py-1 bg-white/[0.02]">
                <span className="text-[9px] text-text-muted uppercase tracking-wider opacity-70 flex items-center gap-1">
                  <Edit3 className="w-2.5 h-2.5" />
                  {isStreaming || isRunning ? 'Generating Code...' : 'Code Change'}
                </span>
              </div>
              <div className="max-h-60 overflow-auto custom-scrollbar px-2.5 py-2">
                <pre className="text-[10px] font-mono text-text-secondary whitespace-pre-wrap break-all pl-2 border-l-2 border-accent/30">
                  {codeContent}
                  {(isStreaming || isRunning) && (
                    <span className="inline-block w-1.5 h-3 bg-accent ml-1 animate-pulse align-middle" />
                  )}
                </pre>
              </div>
            </div>
          )}

          {/* 其他参数预览 */}
          {Object.keys(args).filter(k => !k.startsWith('_') && k !== 'code' && k !== 'content' && k !== 'replacement' && k !== 'source').length > 0 && (
            <div className="px-2.5 py-1.5">
              <div className="text-[9px] text-text-muted uppercase tracking-wider mb-1.5 opacity-70 flex items-center gap-1">
                <Terminal className="w-2.5 h-2.5" />
                {t('toolArguments', language)}
              </div>
              <div className="space-y-1 pl-2 border-l border-white/10">
                {Object.entries(args)
                  .filter(([key]) => !key.startsWith('_') && key !== 'code' && key !== 'content' && key !== 'replacement' && key !== 'source')
                  .map(([key, value]) => (
                    <div key={key} className="flex gap-2 text-[11px]">
                      <span className="text-text-muted shrink-0 w-16 text-right opacity-60">{key}:</span>
                      <span className="text-text-secondary font-mono break-all">
                        {typeof value === 'string'
                          ? value
                          : JSON.stringify(value)
                        }
                      </span>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {/* 结果 */}
          {toolCall.result && (
            <div className="border-t border-white/5">
              <div className="flex items-center justify-between px-2.5 py-1 bg-white/[0.02]">
                <span className="text-[9px] text-text-muted uppercase tracking-wider opacity-70 flex items-center gap-1">
                  <FileText className="w-2.5 h-2.5" />
                  {t('toolResult', language)}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopyResult() }}
                  className="p-0.5 hover:bg-white/10 rounded text-text-muted hover:text-text-primary transition-colors"
                  title="Copy result"
                >
                  <Copy className="w-2.5 h-2.5" />
                </button>
              </div>
              <div className="max-h-40 overflow-auto custom-scrollbar px-2.5 pb-1.5 pt-1">
                <pre className="text-[10px] font-mono text-text-muted whitespace-pre-wrap break-all pl-2 border-l border-white/10">
                  {toolCall.result.slice(0, 500)}
                  {toolCall.result.length > 500 && '\n... (truncated)'}
                </pre>
              </div>
            </div>
          )}

          {/* 错误信息 */}
          {toolCall.error && (
            <div className="px-2.5 py-1.5 bg-red-500/5 border-t border-red-500/10">
              <div className="text-[9px] text-red-400 uppercase tracking-wider mb-0.5 flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5" />
                {t('toolError', language)}
              </div>
              <p className="text-[10px] text-red-300 font-mono pl-2 border-l border-red-500/20">{toolCall.error}</p>
            </div>
          )}
        </div>
      )}

      {/* 审批按钮 */}
      {isAwaitingApproval && (
        <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-yellow-500/20 bg-yellow-500/5">
          <span className="text-[11px] text-yellow-400 font-medium flex items-center gap-1.5">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            {t('toolWaitingApproval', language)}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onReject}
              className="px-2 py-0.5 text-[10px] text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
            >
              {t('toolReject', language)}
            </button>
            <button
              onClick={onApprove}
              className="px-2 py-0.5 text-[10px] bg-accent text-white hover:bg-accent-hover rounded transition-colors shadow-sm shadow-accent/20"
            >
              {t('toolApprove', language)}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
