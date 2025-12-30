/**
 * 工具调用卡片 - Cursor 风格设计
 * 支持流式参数预览、状态指示、结果展示、代码高亮
 */

import { useState, useMemo, useEffect, memo } from 'react'
import {
  Check, X, ChevronDown, ChevronRight, Loader2,
  Terminal, Search, Copy, AlertTriangle
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { ToolCall } from '@renderer/agent/types'
import { JsonHighlight } from '@utils/jsonHighlight'
import { terminalManager } from '@/renderer/services/TerminalManager'

interface ToolCallCardProps {
  toolCall: ToolCall
  isAwaitingApproval?: boolean
  onApprove?: () => void
  onReject?: () => void
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
  web_search: 'Web Search',
  read_url: 'Read URL',
  ask_user: 'Ask User',
}

const ToolCallCard = memo(function ToolCallCard({
  toolCall,
  isAwaitingApproval,
  onApprove,
  onReject,
}: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { language, setTerminalVisible } = useStore()

  const args = toolCall.arguments as Record<string, unknown>
  const isStreaming = args._streaming === true
  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending'
  const isSuccess = toolCall.status === 'success'
  const isError = toolCall.status === 'error'
  const isRejected = toolCall.status === 'rejected'

  // 自动展开 logic
  useEffect(() => {
    // 只有在运行中或者是特定类型的工具才自动展开
    if (isRunning || isStreaming) {
      setIsExpanded(true)
    }
  }, [isRunning, isStreaming])

  // 延迟渲染逻辑：动画期间不渲染重型内容
  const [showContent, setShowContent] = useState(false)
  useEffect(() => {
      let timer: NodeJS.Timeout
      if (isExpanded) {
          // 展开时：延迟显示内容，等待动画完成
          timer = setTimeout(() => setShowContent(true), 100)
      } else {
          // 收起时：立即隐藏内容，防止重绘
          setShowContent(false)
      }
      return () => clearTimeout(timer)
  }, [isExpanded])

  // 获取简短描述
  const description = useMemo(() => {
    const name = toolCall.name
    if (name === 'run_command') {
      const cmd = args.command as string
      return cmd
    }
    if (name === 'read_file' || name === 'write_file' || name === 'create_file' || name === 'edit_file') {
      const path = args.path as string
      return path?.split(/[\\/]/).pop() || path
    }
    if (name === 'search_files') {
      const pattern = (args.pattern || args.query) as string
      return pattern ? `"${pattern}"` : ''
    }
    if (name === 'list_directory') {
      const path = args.path as string
      return path?.split(/[\\/]/).pop() || path || '.'
    }
    if (name === 'web_search') {
      const query = args.query as string
      return query ? `"${query}"` : ''
    }
    return ''
  }, [toolCall.name, args])

  const handleCopyResult = () => {
    if (toolCall.result) {
      navigator.clipboard.writeText(toolCall.result)
    }
  }

  // 渲染 Skeleton 占位符
  const renderSkeleton = () => (
      <div className="min-h-[160px] p-4 opacity-60 select-none flex flex-col gap-4">
          {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-3 items-center">
                  <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-2">
                      <div 
                        className="h-2.5 bg-white/20 rounded-sm animate-pulse" 
                        style={{ 
                            width: `${Math.max(30, 90 - (i * 15))}%`, 
                            animationDelay: `${i * 100}ms` 
                        }} 
                      />
                  </div>
              </div>
          ))}
      </div>
  )

  // 渲染不同类型的预览内容
  const renderPreview = () => {
    // 动画期间（showContent 为 false）显示 Skeleton，无论状态如何，保证展开动画流畅
    if (!showContent) {
        return <div className="bg-black/20 rounded-md border border-white/5 overflow-hidden">{renderSkeleton()}</div>
    }

    const name = toolCall.name

    // 1. 终端命令预览
    if (name === 'run_command') {
      const cmd = args.command as string
      return (
        <div className="bg-black/40 rounded-md border border-white/5 overflow-hidden font-mono text-xs shadow-inner">
          <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5">
            <span className="text-text-muted flex items-center gap-2">
              <Terminal className="w-3 h-3" />
              Terminal
            </span>
            {isSuccess && (
              <button
                onClick={async (e) => {
                  e.stopPropagation()
                  const cwd = (toolCall as any).meta?.cwd || args.cwd as string || ''
                  setTerminalVisible(true)
                  // 创建新终端并写入命令（不自动执行）
                  const state = terminalManager.getState()
                  let terminalId = state.activeId
                  if (!terminalId) {
                    terminalId = await terminalManager.createTerminal({ cwd, name: 'Terminal' })
                  }
                  terminalManager.writeToTerminal(terminalId, cmd)
                  terminalManager.focusTerminal(terminalId)
                }}
                className="text-[10px] px-1.5 py-0.5 bg-white/5 hover:bg-white/10 rounded text-text-muted hover:text-accent transition-colors"
              >
                Open
              </button>
            )}
          </div>
          <div className="p-3 text-text-secondary overflow-x-auto custom-scrollbar">
            <div className="flex gap-2">
              <span className="text-accent select-none">$</span>
              <span className="text-green-400">{cmd}</span>
            </div>
            {toolCall.result && (
              <div className="mt-2 text-text-muted opacity-80 whitespace-pre-wrap break-all border-t border-white/5 pt-2">
                {toolCall.result.slice(0, 500)}
                {toolCall.result.length > 500 && <span className="opacity-50">... (truncated)</span>}
              </div>
            )}
          </div>
        </div>
      )
    }

    // 2. 文件搜索预览
    if (name === 'search_files' || name === 'web_search') {
      return (
        <div className="bg-black/20 rounded-md border border-white/5 overflow-hidden shadow-inner">
          <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 text-xs text-text-muted">
            <Search className="w-3 h-3" />
            <span>Query: <span className="text-text-primary font-medium">{(args.pattern || args.query) as string}</span></span>
          </div>
          {toolCall.result && (
            <div className="max-h-48 overflow-y-auto custom-scrollbar p-1">
              <JsonHighlight
                data={toolCall.result}
                className="p-2"
                maxHeight="max-h-48"
                maxLength={3000}
              />
            </div>
          )}
        </div>
      )
    }

    // 3. 默认通用预览
    return (
      <div className="space-y-2">
        {/* 参数 */}
        {Object.keys(args).filter(k => !k.startsWith('_')).length > 0 && (
          <div className="bg-black/20 rounded-md border border-white/5 p-2 shadow-inner">
            <JsonHighlight
              data={Object.fromEntries(Object.entries(args).filter(([k]) => !k.startsWith('_')))}
              maxHeight="max-h-32"
              maxLength={1500}
            />
          </div>
        )}

        {/* 结果 */}
        {toolCall.result && (
          <div className="bg-black/20 rounded-md border border-white/5 overflow-hidden shadow-inner">
            <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5">
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-medium">Result</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleCopyResult() }}
                className="p-1 hover:bg-white/10 rounded text-text-muted hover:text-text-primary transition-colors"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
            <div className="max-h-48 overflow-auto custom-scrollbar p-2">
              <JsonHighlight
                data={toolCall.result}
                maxHeight="max-h-48"
                maxLength={3000}
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  // 计算卡片样式
  const cardStyle = useMemo(() => {
    if (isAwaitingApproval) return 'border-yellow-500/30 bg-yellow-500/5 shadow-[0_0_15px_-3px_rgba(234,179,8,0.1)]'
    if (isError) return 'border-red-500/20 bg-red-500/5 shadow-[0_0_15px_-3px_rgba(239,68,68,0.1)]'
    if (isStreaming || isRunning) return 'border-accent/30 bg-accent/5 shadow-[0_0_15px_-3px_rgba(var(--accent)/0.15)]'
    return 'border-white/5 bg-surface/30 backdrop-blur-sm hover:bg-surface/50 hover:border-white/10 hover:shadow-lg hover:shadow-black/20'
  }, [isAwaitingApproval, isError, isStreaming, isRunning])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }} // smooth easeOut
      className={`
        group my-2 rounded-xl border transition-colors duration-300 overflow-hidden
        ${cardStyle}
      `}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none relative"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Active Indicator Line for Running Tools */}
        {(isStreaming || isRunning) && (
          <motion.div
            layoutId="active-indicator"
            className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent"
          />
        )}

        {/* Status Icon */}
        <div className="shrink-0 relative z-10">
          {isStreaming || isRunning ? (
            <div className="relative">
              <div className="absolute inset-0 bg-accent/20 rounded-full animate-ping" />
              <Loader2 className="w-4 h-4 text-accent animate-spin relative z-10" />
            </div>
          ) : isSuccess ? (
            <div className="w-5 h-5 rounded-full bg-green-500/10 flex items-center justify-center border border-green-500/20">
              <Check className="w-3 h-3 text-green-400" />
            </div>
          ) : isError ? (
            <div className="w-5 h-5 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
              <X className="w-3 h-3 text-red-400" />
            </div>
          ) : isRejected ? (
            <div className="w-5 h-5 rounded-full bg-yellow-500/10 flex items-center justify-center border border-yellow-500/20">
              <X className="w-3 h-3 text-yellow-400" />
            </div>
          ) : (
            <div className="w-5 h-5 rounded-full border border-text-muted/30" />
          )}
        </div>

        {/* Title & Description */}
        <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
          <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary transition-colors whitespace-nowrap">
            {TOOL_LABELS[toolCall.name] || toolCall.name}
          </span>

          {description && (
            <motion.div 
              initial={{ opacity: 0, x: -5 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2 overflow-hidden"
            >
              <span className="text-text-muted/20">|</span>
              <span className="text-xs text-text-muted truncate font-mono opacity-70">
                {description}
              </span>
            </motion.div>
          )}
        </div>

        {/* Expand Toggle */}
        <motion.div 
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 text-text-muted/50 group-hover:text-text-muted transition-colors"
        >
          <ChevronDown className="w-4 h-4" />
        </motion.div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            layout
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-0">
              <div> {/* Indent to align with text start */}
                {renderPreview()}

                {/* Error Message */}
                {toolCall.error && (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-md"
                  >
                    <div className="flex items-center gap-2 text-red-400 text-xs font-medium mb-1">
                      <AlertTriangle className="w-3 h-3" />
                      Error
                    </div>
                    <p className="text-[11px] text-red-300 font-mono break-all">{toolCall.error}</p>
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Approval Actions */}
      {isAwaitingApproval && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-yellow-500/10 bg-yellow-500/5">
          <button
            onClick={onReject}
            className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all active:scale-95"
          >
            {t('toolReject', language)}
          </button>
          <button
            onClick={onApprove}
            className="px-3 py-1.5 text-xs font-medium bg-accent text-white hover:bg-accent-hover rounded-md transition-all shadow-sm shadow-accent/20 active:scale-95 hover:shadow-accent/40"
          >
            {t('toolApprove', language)}
          </button>
        </div>
      )}
    </motion.div>
  )
}, (prevProps, nextProps) => {
  return (
    prevProps.toolCall.id === nextProps.toolCall.id &&
    prevProps.toolCall.status === nextProps.toolCall.status &&
    prevProps.toolCall.name === nextProps.toolCall.name &&
    prevProps.isAwaitingApproval === nextProps.isAwaitingApproval &&
    JSON.stringify(prevProps.toolCall.arguments) === JSON.stringify(nextProps.toolCall.arguments) &&
    prevProps.toolCall.result === nextProps.toolCall.result
  )
})

export default ToolCallCard
