/**
 * ToolCallCard - 工具调用卡片组件
 * 参考 Cursor 设计，提供紧凑、流畅的工具调用展示
 */

import { useState, memo } from 'react'
import {
  FileText, Terminal, Search, FolderOpen, Trash2,
  ChevronRight, Check, X, Loader2, AlertTriangle,
  Eye, EyeOff, Edit3, FileCode, FolderPlus
} from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { ToolCall, useStore } from '../store'
import { extractPartialString } from '../utils/partialJson'
import { t } from '../i18n'

// ============ Types ============

interface ToolCallCardProps {
  toolCall: ToolCall
  onApprove?: () => void
  onReject?: () => void
  onFileClick?: (filePath: string) => void
}

interface ToolConfig {
  icon: typeof FileText
  label: string
  color: string
  bgColor: string
  isFileEdit?: boolean
  showResult?: boolean
}

// ============ Tool Configuration ============

const TOOL_CONFIG: Record<string, ToolConfig> = {
  read_file: {
    icon: FileText,
    label: 'Read File',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    showResult: true,
  },
  write_file: {
    icon: Edit3,
    label: 'Write File',
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    isFileEdit: true,
  },
  create_file: {
    icon: FileCode,
    label: 'Create File',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    isFileEdit: true,
  },
  edit_file: {
    icon: Edit3,
    label: 'Edit File',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    isFileEdit: true,
  },
  delete_file: {
    icon: Trash2,
    label: 'Delete File',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    isFileEdit: true,
  },
  list_directory: {
    icon: FolderOpen,
    label: 'List Directory',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    showResult: true,
  },
  create_directory: {
    icon: FolderPlus,
    label: 'Create Directory',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
  },
  search_files: {
    icon: Search,
    label: 'Search Files',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    showResult: true,
  },
  run_terminal: {
    icon: Terminal,
    label: 'Run Command',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    showResult: true,
  },
  execute_command: {
    icon: Terminal,
    label: 'Execute Command',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    showResult: true,
  },
}

// ============ Helper Functions ============

function extractFilePath(args: Record<string, unknown>): string | null {
  return (args.path || args.file_path || args.filePath || args.directory) as string | null
}

function extractCommand(args: Record<string, unknown>): string | null {
  return (args.command || args.cmd) as string | null
}

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

// ============ Sub Components ============

function StatusIndicator({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
    case 'success':
      return <Check className="w-3.5 h-3.5 text-green-400" />
    case 'error':
      return <X className="w-3.5 h-3.5 text-red-400" />
    case 'awaiting_user':
      return <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
    case 'rejected':
      return <X className="w-3.5 h-3.5 text-text-muted" />
    default:
      return <div className="w-3.5 h-3.5 rounded-full bg-text-muted/30" />
  }
}

function ToolResultViewer({ 
  toolName, 
  result, 
  error 
}: { 
  toolName: string
  result: string
  error?: string 
}) {
  if (error) {
    return (
      <div className="text-xs text-red-300">
        <span className="font-medium">Error: </span>
        {error}
      </div>
    )
  }

  // 尝试解析 JSON
  let parsed: unknown = null
  try {
    parsed = JSON.parse(result)
  } catch {
    // 不是 JSON，显示原始文本
  }

  if (parsed && typeof parsed === 'object') {
    return (
      <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap max-h-48 overflow-auto custom-scrollbar">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    )
  }

  // 对于文件内容，使用代码高亮
  if (toolName === 'read_file' && result.length > 0) {
    return (
      <div className="max-h-48 overflow-auto custom-scrollbar">
        <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap">
          {result.slice(0, 2000)}
          {result.length > 2000 && '\n... (truncated)'}
        </pre>
      </div>
    )
  }

  return (
    <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap max-h-48 overflow-auto custom-scrollbar">
      {result.slice(0, 1000)}
      {result.length > 1000 && '... (truncated)'}
    </pre>
  )
}

interface EditBlock {
  search: string
  replace: string
}

function EditBlockDiff({ search, replace }: EditBlock) {
  return (
    <div className="rounded border border-border-subtle overflow-hidden text-xs font-mono">
      <div className="bg-red-500/10 px-2 py-1 border-b border-border-subtle">
        <span className="text-red-400">- </span>
        <span className="text-text-secondary whitespace-pre-wrap">{search.slice(0, 200)}</span>
      </div>
      <div className="bg-green-500/10 px-2 py-1">
        <span className="text-green-400">+ </span>
        <span className="text-text-secondary whitespace-pre-wrap">{replace.slice(0, 200)}</span>
      </div>
    </div>
  )
}

// ============ Main Component ============

export default memo(function ToolCallCard({
  toolCall,
  onApprove,
  onReject,
  onFileClick
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const { language } = useStore()
  
  const config = TOOL_CONFIG[toolCall.name] || { 
    icon: Terminal, 
    label: toolCall.name, 
    color: 'text-text-muted',
    bgColor: 'bg-surface-active'
  }
  const Icon = config.icon
  const isFileEdit = config.isFileEdit
  const isAwaiting = toolCall.status === 'awaiting_user'
  const isRunning = toolCall.status === 'running'
  const hasResult = !!(toolCall.result || toolCall.error)

  // 提取关键信息
  const filePath = extractFilePath(toolCall.arguments)
  const command = extractCommand(toolCall.arguments)
  
  // 尝试从 buffer 或 arguments 中提取代码内容
  const rawCode = toolCall.argsBuffer 
    ? extractPartialString(toolCall.argsBuffer, ['code', 'file_content', 'content', 'text'])
    : (toolCall.arguments.code || toolCall.arguments.file_content || toolCall.arguments.content) as string | undefined

  const fileName = filePath ? getFileName(filePath) : null
  
  // 提取编辑块（用于 edit_file）
  const editBlocks: EditBlock[] = []
  if (toolCall.name === 'edit_file' && toolCall.arguments.edits) {
    const edits = toolCall.arguments.edits as Array<{ old_text?: string; new_text?: string }>
    edits.forEach(edit => {
      if (edit.old_text && edit.new_text) {
        editBlocks.push({ search: edit.old_text, replace: edit.new_text })
      }
    })
  }

  // 卡片样式
  const cardStyles = isAwaiting
    ? 'border-yellow-500/30 bg-yellow-500/5'
    : toolCall.status === 'error'
    ? 'border-red-500/20 bg-red-500/5'
    : toolCall.status === 'success'
    ? 'border-green-500/20 bg-surface'
    : 'border-border-subtle bg-surface'

  const toggleExpand = () => setExpanded(!expanded)
  const toggleResult = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowResult(!showResult)
  }

  const handleFileClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (filePath && onFileClick) {
      onFileClick(filePath)
    }
  }

  return (
    <div className={`
      group rounded-md border transition-all duration-300 overflow-hidden text-sm my-1
      ${cardStyles}
    `}>
      {/* 主行 - 紧凑显示 */}
      <div 
        className="flex items-center gap-3 px-3 py-2 cursor-pointer select-none min-h-[36px]"
        onClick={toggleExpand}
      >
        <StatusIndicator status={toolCall.status} />
        
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`flex items-center gap-1.5 font-medium ${config.color}`}>
            <Icon className="w-3.5 h-3.5" />
            {config.label}
          </span>
          
          {isFileEdit && fileName && (
            <div className="flex items-center gap-1 text-text-secondary truncate">
              <span className="opacity-40">/</span>
              <span 
                className="hover:text-accent hover:underline cursor-pointer transition-colors truncate"
                onClick={handleFileClick}
                title={filePath || ''}
              >
                {fileName}
              </span>
            </div>
          )}
          
          {!isFileEdit && fileName && (
            <span className="text-text-secondary truncate opacity-80">
              {fileName}
            </span>
          )}
          
          {command && (
            <code className="text-xs font-mono text-text-muted bg-black/20 px-1.5 py-0.5 rounded truncate max-w-[200px]">
              {command}
            </code>
          )}
        </div>
        
        <div className="flex items-center gap-3 ml-auto flex-shrink-0">
          {hasResult && config.showResult && (
            <button
              onClick={toggleResult}
              className={`p-1 rounded hover:bg-surface-active transition-colors ${showResult ? 'text-accent' : 'text-text-muted'}`}
            >
              {showResult ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
          <ChevronRight className={`
            w-3.5 h-3.5 text-text-muted transition-transform duration-200
            ${expanded ? 'rotate-90' : ''}
          `} />
        </div>
      </div>

      {/* 审批按钮区域 */}
      {isAwaiting && onApprove && onReject && (
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-t border-yellow-500/20 bg-yellow-500/5">
          <div className="flex items-center gap-2 text-xs text-yellow-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="font-medium">{t('needConfirmation', language)}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onReject() }}
              className="px-3 py-1.5 text-xs rounded-md bg-surface hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-all border border-transparent hover:border-red-500/30"
            >
              {t('reject', language)}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onApprove() }}
              className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-all font-medium shadow-sm hover:shadow-glow"
            >
              {t('allowExecute', language)}
            </button>
          </div>
        </div>
      )}

      {/* 展开内容 - 智能预览 */}
      {expanded && (
        <div className="px-3 py-2.5 border-t border-border-subtle/30 bg-[#0d0d0d] animate-slide-in">
          {/* 如果有代码内容，显示高亮代码块 */}
          {rawCode ? (
            <div className="relative group/code rounded-md overflow-hidden border border-border-subtle/50">
              <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5">
                <span className="text-[10px] text-text-muted font-mono uppercase">
                  {fileName ? fileName : t('codePreview', language)}
                </span>
                {toolCall.argsBuffer && isRunning && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    <span className="text-[10px] text-accent font-medium">{t('writing', language)}</span>
                  </div>
                )}
              </div>
              <SyntaxHighlighter
                style={vscDarkPlus}
                language={fileName?.split('.').pop() || 'typescript'}
                PreTag="div"
                className="!bg-transparent !p-3 !m-0 !text-xs custom-scrollbar"
                customStyle={{ background: 'transparent', margin: 0 }}
                wrapLines={true}
                wrapLongLines={true} 
                showLineNumbers={true}
                lineNumberStyle={{ minWidth: '2em', paddingRight: '1em', color: '#555' }}
              >
                {rawCode}
              </SyntaxHighlighter>
            </div>
          ) : (
            // 否则显示原始 JSON
            <div className="space-y-2">
              {toolCall.argsBuffer && isRunning && (
                <div className="flex items-center gap-2 text-[10px] text-accent animate-pulse mb-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>{t('receivingData', language)}</span>
                </div>
              )}
              <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">{t('rawArguments', language)}</div>
              <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap max-h-32 overflow-auto custom-scrollbar opacity-70">
                {toolCall.argsBuffer || JSON.stringify(toolCall.arguments, null, 2)}
              </pre>
            </div>
          )}

          {editBlocks.length > 0 && !rawCode && (
            <div className="mt-4">
              <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">{t('proposedChanges', language)}</div>
              <div className="space-y-2">
                {editBlocks.map((block, i) => (
                  <EditBlockDiff key={i} search={block.search} replace={block.replace} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 结果显示 */}
      {showResult && hasResult && (
        <div className="border-t border-border-subtle/30 bg-black/10 animate-slide-in">
          <div className="px-3 py-2">
            <ToolResultViewer 
              toolName={toolCall.name} 
              result={toolCall.result || ''} 
              error={toolCall.error}
            />
          </div>
        </div>
      )}
      
      {/* 错误简略 */}
      {toolCall.error && !showResult && (
        <div className="px-3 py-2 border-t border-red-500/20 bg-red-500/5">
          <p className="text-xs text-red-300 line-clamp-2">{toolCall.error}</p>
        </div>
      )}
    </div>
  )
})
