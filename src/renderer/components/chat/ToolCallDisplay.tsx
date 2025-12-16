/**
 * Tool Call Display Component
 * 参考 void 编辑器的工具调用显示设计
 */

import { useState, useMemo, useCallback } from 'react'
import {
  ChevronRight,
  File,
  Folder,
  Terminal,
  Search,
  Edit,
  Trash2,
  Plus,
  AlertTriangle,
  Check,
  X,
  Loader2,
  Ban,
  FileText,
  FolderTree,
  Bug,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { ToolMessage, ToolMessageType } from '../../agent/types/chatTypes'
import { ToolCall } from '../../agent/types/toolTypes'
import { LLMToolCall } from '../../types/electron'

// ===== 工具图标映射 =====

import type { LucideIcon } from 'lucide-react'

const TOOL_ICONS: Record<string, LucideIcon> = {
  read_file: FileText,
  list_directory: Folder,
  get_dir_tree: FolderTree,
  search_files: Search,
  search_in_file: Search,
  edit_file: Edit,
  write_file: Edit,
  create_file_or_folder: Plus,
  delete_file_or_folder: Trash2,
  run_command: Terminal,
  open_terminal: Terminal,
  run_in_terminal: Terminal,
  get_terminal_output: Terminal,
  list_terminals: Terminal,
  get_lint_errors: Bug,
}

// ===== 工具名称显示 =====

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  read_file: 'Read File',
  list_directory: 'List Directory',
  get_dir_tree: 'Directory Tree',
  search_files: 'Search Files',
  search_in_file: 'Search in File',
  edit_file: 'Edit File',
  write_file: 'Write File',
  create_file_or_folder: 'Create',
  delete_file_or_folder: 'Delete',
  run_command: 'Run Command',
  open_terminal: 'Open Terminal',
  run_in_terminal: 'Run in Terminal',
  get_terminal_output: 'Terminal Output',
  list_terminals: 'List Terminals',
  get_lint_errors: 'Lint Errors',
}

// ===== 状态指示器 (更小) =====

interface StatusIndicatorProps {
  status: ToolMessageType | 'pending' | 'running'
}

function StatusIndicator({ status }: StatusIndicatorProps) {
  switch (status) {
    case 'running_now':
    case 'running':
    case 'pending':
      return <Loader2 className="w-3 h-3 text-accent animate-spin" />
    case 'success':
      return <CheckCircle2 className="w-3 h-3 text-green-500/80" />
    case 'tool_error':
    case 'invalid_params':
      return <XCircle className="w-3 h-3 text-red-500/80" />
    case 'rejected':
      return <Ban className="w-3 h-3 text-text-muted" />
    case 'tool_request':
      return <div className="w-2 h-2 rounded-full bg-accent animate-pulse shadow-[0_0_5px_rgba(var(--color-accent),0.5)]" />
    default:
      return <div className="w-1.5 h-1.5 rounded-full bg-text-muted/50" />
  }
}

// ===== 工具参数显示 =====

interface ToolParamsProps {
  params: Record<string, unknown>
  toolName: string
}

function ToolParams({ params, toolName }: ToolParamsProps) {
  const displayParams = useMemo(() => {
    const entries = Object.entries(params)
    
    // 特殊处理某些工具的参数显示
    if (toolName === 'edit_file' && params.search_replace_blocks) {
      return entries.filter(([key]) => key !== 'search_replace_blocks')
    }
    
    return entries.slice(0, 3) // 最多显示 3 个参数
  }, [params, toolName])

  if (displayParams.length === 0) return null

  return (
    <div className="text-[10px] text-text-muted/50 truncate font-mono flex items-center gap-2">
      {displayParams.map(([key, value], i) => (
        <span key={key} className="flex items-center gap-1">
          {i > 0 && <span className="text-white/5">|</span>}
          <span className="opacity-70">{key}:</span> 
          <span className="opacity-100 text-text-secondary/70">{typeof value === 'string' ? value.slice(0, 40) : JSON.stringify(value).slice(0, 20)}</span>
        </span>
      ))}
    </div>
  )
}

// ===== 工具结果显示 =====

interface ToolResultProps {
  content: string
  isError?: boolean
}

function ToolResult({ content, isError }: ToolResultProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const lines = content.split('\n')
  const shouldTruncate = lines.length > 8 || content.length > 400

  const displayContent = useMemo(() => {
    if (!shouldTruncate || isExpanded) return content
    return lines.slice(0, 8).join('\n') + (lines.length > 8 ? '\n...' : '')
  }, [content, lines, shouldTruncate, isExpanded])

  return (
    <div className={`mt-2 text-xs ${isError ? 'text-red-400' : 'text-text-secondary'} animate-fade-in pl-6`}>
      <div className="relative group">
        <pre className="whitespace-pre-wrap font-mono bg-black/20 rounded-md p-3 overflow-x-auto max-h-60 overflow-y-auto text-[10px] leading-relaxed border border-white/5 selection:bg-white/10">
            {displayContent}
        </pre>
        {shouldTruncate && (
            <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="absolute bottom-2 right-2 px-2 py-0.5 text-[10px] bg-surface/80 backdrop-blur border border-white/10 rounded-full hover:text-accent transition-all shadow-sm opacity-0 group-hover:opacity-100"
            >
            {isExpanded ? 'Collapse' : 'Expand'}
            </button>
        )}
      </div>
    </div>
  )
}

// ===== 审批按钮 =====

interface ApprovalButtonsProps {
  onApprove: () => void
  onReject: () => void
}

function ApprovalButtons({ onApprove, onReject }: ApprovalButtonsProps) {
  return (
    <div className="flex items-center gap-2 mt-2 pl-8 animate-fade-in">
      <button
        onClick={onApprove}
        className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 rounded-full transition-all"
      >
        <Check className="w-3 h-3" />
        Approve
      </button>
      <button
        onClick={onReject}
        className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 rounded-full transition-all"
      >
        <X className="w-3 h-3" />
        Reject
      </button>
    </div>
  )
}

// ===== 主组件 (极简模式) =====

interface ToolCallDisplayProps {
  toolCall: ToolCall | ToolMessage | LLMToolCall
  onApprove?: () => void
  onReject?: () => void
  onFileClick?: (path: string) => void
}

export function ToolCallDisplay({
  toolCall,
  onApprove,
  onReject,
  onFileClick,
}: ToolCallDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // 判断是 ToolCall 还是 ToolMessage
  const isToolMessage = 'role' in toolCall && toolCall.role === 'tool'
  
  const name = toolCall.name
  const params = isToolMessage
    ? (toolCall as ToolMessage).params || (toolCall as ToolMessage).rawParams
    : (toolCall as ToolCall).arguments
  const status: ToolMessageType | 'pending' | 'running' = isToolMessage
    ? (toolCall as ToolMessage).type
    : (toolCall as ToolCall).status === 'running'
    ? 'running'
    : (toolCall as ToolCall).status === 'success'
    ? 'success'
    : (toolCall as ToolCall).status === 'error'
    ? 'tool_error'
    : (toolCall as ToolCall).status === 'tool_request'
    ? 'tool_request'
    : 'pending'
  const content = isToolMessage
    ? (toolCall as ToolMessage).content
    : (toolCall as ToolCall).result || ''
  const error = !isToolMessage ? (toolCall as ToolCall).error : undefined

  const Icon = TOOL_ICONS[name] || File
  const displayName = TOOL_DISPLAY_NAMES[name] || name

  // 获取主要描述（如文件路径）
  const primaryDesc = useMemo(() => {
    if (params.path) return String(params.path).split(/[\\/]/).pop()
    if (params.command) return String(params.command).slice(0, 50)
    if (params.name) return String(params.name)
    return null
  }, [params])

  // 是否需要审批
  const needsApproval = status === 'tool_request' && onApprove && onReject

  // 是否有结果可显示
  const hasResult = content && status !== 'tool_request' && status !== 'running_now'
  const isError = status === 'tool_error' || status === 'invalid_params'

  // 点击文件路径
  const handleFileClick = useCallback(() => {
    if (params.path && onFileClick) {
      onFileClick(String(params.path))
    }
  }, [params.path, onFileClick])

  return (
    <div className={`
      group relative rounded-md transition-all duration-200 border border-transparent
      ${hasResult || needsApproval ? 'hover:bg-white/5' : ''}
      ${isExpanded ? 'bg-white/5 border-white/5 pb-2 my-2' : ''}
    `}>
      {/* Header - Compact Line */}
      <div
        className={`flex items-center gap-3 px-2 py-1.5 flex-nowrap ${hasResult ? 'cursor-pointer' : ''}`}
        onClick={() => hasResult && setIsExpanded(!isExpanded)}
      >
        {/* Status Indicator (Left) */}
        <div className="flex items-center justify-center w-3 h-3 shrink-0">
           <StatusIndicator status={status} />
        </div>

        {/* Tool Name & Desc Container */}
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
             <span className={`text-[10px] font-medium transition-colors whitespace-nowrap ${status === 'running_now' ? 'text-accent' : 'text-text-muted group-hover:text-text-secondary'}`}>
               {displayName}
             </span>
             
             {/* Primary Description (Inline) */}
             {primaryDesc && (
               <span 
                 className={`text-[10px] text-text-muted/60 truncate max-w-[200px] ${params.path && onFileClick ? 'hover:text-accent cursor-pointer underline decoration-dotted underline-offset-2' : ''}`}
                 onClick={(e) => {
                    if (params.path && onFileClick) {
                      e.stopPropagation()
                      handleFileClick()
                    }
                 }}
               >
                 {primaryDesc}
               </span>
             )}
             
             {/* Params (Inline if collapsed) */}
             {!isExpanded && !needsApproval && (
                <div className="hidden sm:block overflow-hidden opacity-0 group-hover:opacity-40 transition-opacity">
                   <ToolParams params={params} toolName={name} />
                </div>
             )}
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 shrink-0">
            {error && (
              <span className="text-[9px] text-red-400 bg-red-500/10 px-1 py-0 rounded border border-red-500/20">
                Error
              </span>
            )}
            
            {/* Chevron */}
            {hasResult && (
              <ChevronRight
                className={`w-3 h-3 text-text-muted/20 transition-transform duration-200 ${isExpanded ? 'rotate-90 text-text-primary' : 'group-hover:text-text-secondary'}`}
              />
            )}
        </div>
      </div>

      {/* Approval Buttons */}
      {needsApproval && (
        <div className="px-2 pb-2">
          <ApprovalButtons onApprove={onApprove} onReject={onReject} />
        </div>
      )}

      {/* Expanded Content */}
      {isExpanded && hasResult && (
        <div className="px-2 pr-2">
          <ToolResult content={content} isError={isError} />
        </div>
      )}
    </div>
  )
}

// ===== 工具调用列表 =====

interface ToolCallListProps {
  toolCalls: (ToolCall | ToolMessage | LLMToolCall)[]
  pendingToolId?: string
  onApprove?: () => void
  onReject?: () => void
  onFileClick?: (path: string) => void
}

export function ToolCallList({
  toolCalls,
  pendingToolId,
  onApprove,
  onReject,
  onFileClick,
}: ToolCallListProps) {
  if (toolCalls.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {toolCalls.map((tc) => {
        const id = 'id' in tc ? tc.id : ''
        const isPending = id === pendingToolId

        return (
          <ToolCallDisplay
            key={id}
            toolCall={tc}
            onApprove={isPending ? onApprove : undefined}
            onReject={isPending ? onReject : undefined}
            onFileClick={onFileClick}
          />
        )
      })}
    </div>
  )
}

export default ToolCallDisplay
