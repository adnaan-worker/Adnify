/**
 * 工具调用卡片 - 简化版
 * 支持流式参数预览、状态指示、结果展示
 */

import { useState, useMemo, useEffect, memo } from 'react'
import {
    Check,
    X,
    ChevronDown,
    Loader2,
    Terminal,
    Search,
    Copy,
    AlertTriangle,
    FileCode,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { ToolCall } from '@renderer/agent/types'
import { JsonHighlight } from '@utils/jsonHighlight'
import { terminalManager } from '@/renderer/services/TerminalManager'
import { RichContentRenderer } from './RichContentRenderer'
import InlineDiffPreview from './InlineDiffPreview'
import { getFileName } from '@shared/utils/pathUtils'
import { CodeSkeleton } from '../ui/Loading'

interface ToolCallCardProps {
    toolCall: ToolCall
    isAwaitingApproval?: boolean
    onApprove?: () => void
    onReject?: () => void
    /** 默认展开状态 */
    defaultExpanded?: boolean
}

// 工具标签映射
const TOOL_LABELS: Record<string, string> = {
    // 读取类
    read_file: 'Read File',
    read_multiple_files: 'Read Files',
    list_directory: 'List Directory',
    get_dir_tree: 'Directory Tree',
    // 搜索类
    search_files: 'Search Files',
    codebase_search: 'Semantic Search',
    // 编辑类
    edit_file: 'Edit File',
    replace_file_content: 'Replace Lines',
    write_file: 'Write File',
    create_file: 'Create File',
    create_file_or_folder: 'Create',
    delete_file_or_folder: 'Delete',
    // 终端
    run_command: 'Run Command',
    // LSP
    get_lint_errors: 'Lint Errors',
    find_references: 'Find References',
    go_to_definition: 'Go to Definition',
    get_hover_info: 'Hover Info',
    get_document_symbols: 'Document Symbols',
    // 网络
    web_search: 'Web Search',
    read_url: 'Read URL',
    // 交互
    ask_user: 'Ask User',
    remember: 'Remember Fact',
    // UI/UX
    uiux_search: 'UI/UX Search',
    uiux_recommend: 'UI/UX Recommend',
}

const ToolCallCard = memo(function ToolCallCard({
    toolCall,
    isAwaitingApproval,
    onApprove,
    onReject,
    defaultExpanded = false,
}: ToolCallCardProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded)
    const { language, setTerminalVisible } = useStore()

    const args = (toolCall.arguments || {}) as Record<string, unknown>
    const isStreaming = args._streaming === true
    const isRunning = toolCall.status === 'running' || toolCall.status === 'pending'
    const isSuccess = toolCall.status === 'success'
    const isError = toolCall.status === 'error'
    const isRejected = toolCall.status === 'rejected'

    // 运行中自动展开
    useEffect(() => {
        if (isRunning || isStreaming) {
            setIsExpanded(true)
        }
    }, [isRunning, isStreaming])

    // 获取简短描述
    const description = useMemo(() => {
        const name = toolCall.name
        // 终端命令
        if (name === 'run_command') {
            return args.command as string
        }
        // 文件路径类工具
        if ([
            'read_file', 'write_file', 'create_file', 'edit_file',
            'create_file_or_folder', 'delete_file_or_folder',
            'replace_file_content', 'get_lint_errors',
            'find_references', 'go_to_definition', 'get_hover_info', 'get_document_symbols'
        ].includes(name)) {
            const path = args.path as string
            return path ? getFileName(path) : ''
        }
        // 多文件读取
        if (name === 'read_multiple_files') {
            const paths = args.paths as string[]
            return paths?.length ? `${paths.length} files` : ''
        }
        // 目录类
        if (name === 'list_directory' || name === 'get_dir_tree') {
            const path = args.path as string
            return path ? getFileName(path) || '.' : '.'
        }
        // 搜索类
        if (name === 'search_files') {
            const pattern = (args.pattern || args.query) as string
            return pattern ? `"${pattern}"` : ''
        }
        if (name === 'codebase_search' || name === 'web_search' || name === 'uiux_search') {
            const query = args.query as string
            return query ? `"${query}"` : ''
        }
        // URL
        if (name === 'read_url') {
            const url = args.url as string
            return url ? new URL(url).hostname : ''
        }
        // Plan
        if (name === 'ask_user') {
            const question = args.question as string
            return question ? question.slice(0, 30) + (question.length > 30 ? '...' : '') : ''
        }
        return ''
    }, [toolCall.name, args])

    const handleCopyResult = () => {
        if (toolCall.result) {
            navigator.clipboard.writeText(toolCall.result)
        }
    }

    // 渲染预览内容
    const renderPreview = () => {
        const name = toolCall.name

        // 运行中显示骨架屏
        if (isRunning && !toolCall.result && Object.keys(args).filter(k => !k.startsWith('_')).length === 0) {
            return (
                <div className="bg-surface/50 rounded-md border border-border overflow-hidden">
                    <div className="min-h-[100px] opacity-60">
                        <CodeSkeleton lines={3} />
                    </div>
                </div>
            )
        }

        // 终端命令
        if (name === 'run_command') {
            const cmd = args.command as string
            return (
                <div className="bg-surface-active/30 rounded-md border border-border overflow-hidden font-mono text-xs">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-surface/50 border-b border-border">
                        <span className="text-text-muted flex items-center gap-2">
                            <Terminal className="w-3 h-3" />
                            Terminal
                        </span>
                        {isSuccess && (
                            <button
                                onClick={async e => {
                                    e.stopPropagation()
                                    const cwd = (toolCall as any).meta?.cwd || (args.cwd as string) || ''
                                    setTerminalVisible(true)
                                    const state = terminalManager.getState()
                                    let terminalId = state.activeId
                                    if (!terminalId) {
                                        terminalId = await terminalManager.createTerminal({ cwd, name: 'Terminal' })
                                    }
                                    terminalManager.writeToTerminal(terminalId, cmd)
                                    terminalManager.focusTerminal(terminalId)
                                }}
                                className="text-[10px] px-1.5 py-0.5 bg-accent/10 hover:bg-accent/20 rounded text-accent transition-colors"
                            >
                                Open
                            </button>
                        )}
                    </div>
                    <div className="p-3 text-text-secondary overflow-x-auto custom-scrollbar">
                        <div className="flex gap-2">
                            <span className="text-accent select-none">$</span>
                            <span className="text-text-primary">{cmd}</span>
                        </div>
                        {toolCall.result && (
                            <div className="mt-2 text-text-muted opacity-80 whitespace-pre-wrap break-all border-t border-border/50 pt-2">
                                {toolCall.result.slice(0, 500)}
                                {toolCall.result.length > 500 && <span className="opacity-50">... (truncated)</span>}
                            </div>
                        )}
                    </div>
                </div>
            )
        }

        // 搜索类工具（统一样式）
        if (['search_files', 'codebase_search', 'web_search', 'uiux_search'].includes(name)) {
            const query = (args.pattern || args.query) as string
            const searchType = name === 'codebase_search' ? 'Semantic'
                : name === 'web_search' ? 'Web'
                    : name === 'uiux_search' ? 'UI/UX'
                        : 'Files'
            return (
                <div className="bg-surface/50 rounded-md border border-border overflow-hidden">
                    <div className="px-3 py-2 border-b border-border flex items-center gap-2 text-xs text-text-muted">
                        <Search className="w-3 h-3" />
                        <span className="text-text-muted/60">{searchType}:</span>
                        <span className="text-text-primary font-medium truncate">"{query}"</span>
                    </div>
                    {toolCall.result && (
                        <div className="max-h-48 overflow-y-auto custom-scrollbar p-1">
                            <JsonHighlight data={toolCall.result} className="p-2" maxHeight="max-h-48" maxLength={3000} />
                        </div>
                    )}
                </div>
            )
        }

        // 目录类工具
        if (['list_directory', 'get_dir_tree'].includes(name)) {
            const path = args.path as string
            const displayName = getFileName(path) || path || '.'
            return (
                <div className="bg-surface/50 rounded-md border border-border overflow-hidden">
                    <div className="px-3 py-2 border-b border-border flex items-center gap-2 text-xs text-text-muted">
                        <FileCode className="w-3 h-3" />
                        <span className="text-text-primary font-medium" title={path}>{displayName}</span>
                    </div>
                    {toolCall.result && (
                        <div className="max-h-64 overflow-y-auto custom-scrollbar p-3 font-mono text-xs text-text-secondary whitespace-pre">
                            {toolCall.result.slice(0, 3000)}
                            {toolCall.result.length > 3000 && <span className="opacity-50">... (truncated)</span>}
                        </div>
                    )}
                </div>
            )
        }

        // 文件编辑类工具（带 diff 预览）
        if (['edit_file', 'write_file', 'create_file', 'replace_file_content'].includes(name)) {
            const filePath = (args.path as string) || ''
            const MAX_CHARS = 5000
            const rawNew = ((args.content || args.new_string || '') as string)
            const rawOld = ((args.old_string || '') as string)
            const newContent = rawNew.slice(0, MAX_CHARS)
            const oldContent = rawOld.slice(0, MAX_CHARS)
            const isTruncated = rawNew.length > MAX_CHARS || rawOld.length > MAX_CHARS

            if (newContent || isStreaming) {
                return (
                    <div className="bg-surface/50 rounded-md border border-border overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-surface/30 border-b border-border">
                            <span className="text-text-muted flex items-center gap-2 text-xs">
                                <FileCode className="w-3 h-3" />
                                <span className="font-medium text-text-primary">{getFileName(filePath)}</span>
                                {isStreaming && (
                                    <span className="text-accent text-[10px] flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                                        Writing...
                                    </span>
                                )}
                                {isTruncated && !isStreaming && <span className="text-amber-500 text-[10px]">(truncated)</span>}
                            </span>
                        </div>
                        <div className="max-h-64 overflow-auto custom-scrollbar">
                            <InlineDiffPreview
                                oldContent={oldContent}
                                newContent={newContent}
                                filePath={filePath}
                                isStreaming={isStreaming}
                                maxLines={30}
                            />
                        </div>
                        {toolCall.result && !isStreaming && (
                            <div className="px-3 py-2 border-t border-border text-xs text-text-muted">{toolCall.result.slice(0, 200)}</div>
                        )}
                    </div>
                )
            }
        }

        // 文件/文件夹创建删除（简洁显示）
        if (['create_file_or_folder', 'delete_file_or_folder'].includes(name)) {
            const path = args.path as string | undefined
            const isDelete = name === 'delete_file_or_folder'
            const isFolder = path?.endsWith('/')
            const displayName = path ? (getFileName(path) || path) : '<no path>'
            return (
                <div className={`bg-surface/50 rounded-md border overflow-hidden ${isDelete ? 'border-status-error/30' : 'border-border'}`}>
                    <div className="px-3 py-2 flex items-center gap-2 text-xs">
                        <FileCode className={`w-3 h-3 ${isDelete ? 'text-status-error' : 'text-status-success'}`} />
                        <span className={`font-medium ${isDelete ? 'text-status-error' : 'text-status-success'}`}>
                            {isDelete ? 'Delete' : 'Create'} {isFolder ? 'folder' : 'file'}:
                        </span>
                        <span className="text-text-primary font-mono truncate" title={path}>{displayName}</span>
                    </div>
                    {toolCall.result && (
                        <div className="px-3 py-2 border-t border-border text-xs text-text-muted">
                            {toolCall.result.slice(0, 200)}
                        </div>
                    )}
                </div>
            )
        }

        // 读取文件（显示文件内容预览）
        if (['read_file', 'read_multiple_files'].includes(name)) {
            const filePath = name === 'read_file' ? (args.path as string | undefined) : undefined
            const displayName = name === 'read_file'
                ? (filePath ? getFileName(filePath) : '<no path>')
                : `${(args.paths as string[])?.length || 0} files`
            return (
                <div className="bg-surface/50 rounded-md border border-border overflow-hidden">
                    <div className="px-3 py-2 border-b border-border flex items-center gap-2 text-xs text-text-muted">
                        <FileCode className="w-3 h-3" />
                        <span className="text-text-primary font-medium" title={filePath}>{displayName}</span>
                    </div>
                    {toolCall.result && (
                        <div className="max-h-48 overflow-y-auto custom-scrollbar p-3 font-mono text-xs text-text-secondary whitespace-pre-wrap">
                            {toolCall.result.slice(0, 2000)}
                            {toolCall.result.length > 2000 && <span className="opacity-50">... (truncated)</span>}
                        </div>
                    )}
                </div>
            )
        }

        // URL 读取
        if (name === 'read_url') {
            const url = args.url as string | undefined
            let hostname = ''
            if (url) {
                try { hostname = new URL(url).hostname } catch { hostname = url }
            } else {
                hostname = '<no url>'
            }
            return (
                <div className="bg-surface/50 rounded-md border border-border overflow-hidden">
                    <div className="px-3 py-2 border-b border-border flex items-center gap-2 text-xs text-text-muted">
                        <Search className="w-3 h-3" />
                        <span className="text-text-primary font-medium truncate">{hostname}</span>
                    </div>
                    {toolCall.result && (
                        <div className="max-h-48 overflow-y-auto custom-scrollbar p-3 text-xs text-text-secondary">
                            {toolCall.result.slice(0, 2000)}
                            {toolCall.result.length > 2000 && <span className="opacity-50">... (truncated)</span>}
                        </div>
                    )}
                </div>
            )
        }

        // LSP 工具（简洁显示）
        if (['get_lint_errors', 'find_references', 'go_to_definition', 'get_hover_info', 'get_document_symbols'].includes(name)) {
            const path = args.path as string | undefined
            const line = args.line as number | undefined
            const displayName = path ? getFileName(path) : '<no path>'
            return (
                <div className="bg-surface/50 rounded-md border border-border overflow-hidden">
                    <div className="px-3 py-2 border-b border-border flex items-center gap-2 text-xs text-text-muted">
                        <FileCode className="w-3 h-3" />
                        <span className="text-text-primary font-medium">{displayName}</span>
                        {line && <span className="text-text-muted/60">:{line}</span>}
                    </div>
                    {toolCall.result && (
                        <div className="max-h-48 overflow-y-auto custom-scrollbar p-2">
                            <JsonHighlight data={toolCall.result} maxHeight="max-h-48" maxLength={2000} />
                        </div>
                    )}
                </div>
            )
        }

        // 默认：显示参数和结果
        const hasArgs = Object.keys(args).filter(k => !k.startsWith('_')).length > 0
        return (
            <div className="space-y-2">
                {hasArgs && (
                    <div className="bg-surface/50 rounded-md border border-border p-2">
                        <JsonHighlight
                            data={Object.fromEntries(Object.entries(args).filter(([k]) => !k.startsWith('_')))}
                            maxHeight="max-h-32"
                            maxLength={1500}
                        />
                    </div>
                )}
                {toolCall.richContent && toolCall.richContent.length > 0 && (
                    <RichContentRenderer content={toolCall.richContent} maxHeight="max-h-64" />
                )}
                {toolCall.result && (!toolCall.richContent || toolCall.richContent.length === 0) && (
                    <div className="bg-surface/50 rounded-md border border-border overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-surface/30 border-b border-border">
                            <span className="text-[10px] text-text-muted uppercase tracking-wider font-medium">Result</span>
                            <button
                                onClick={e => {
                                    e.stopPropagation()
                                    handleCopyResult()
                                }}
                                className="p-1 hover:bg-surface-hover rounded text-text-muted hover:text-text-primary transition-colors"
                            >
                                <Copy className="w-3 h-3" />
                            </button>
                        </div>
                        <div className="max-h-48 overflow-auto custom-scrollbar p-2">
                            <JsonHighlight data={toolCall.result} maxHeight="max-h-48" maxLength={3000} />
                        </div>
                    </div>
                )}
            </div>
        )
    }

    // 卡片样式
    const cardStyle = useMemo(() => {
        if (isAwaitingApproval) return 'border-yellow-500/30 bg-yellow-500/5'
        if (isError) return 'border-red-500/20 bg-red-500/5'
        if (isStreaming || isRunning) return 'border-accent/30 bg-accent/5'
        return 'border-border bg-surface/30 hover:bg-surface/50'
    }, [isAwaitingApproval, isError, isStreaming, isRunning])

    return (
        <div className={`group my-1 rounded-xl border overflow-hidden ${cardStyle} animate-slide-in-right ${isRunning ? 'animate-pulse-subtle' : ''}`}>
            {/* Header */}
            <div className="flex items-center gap-3 px-3 py-2 cursor-pointer select-none" onClick={() => setIsExpanded(!isExpanded)}>
                {/* Status Icon */}
                <div className="shrink-0">
                    {isStreaming || isRunning ? (
                        <Loader2 className="w-4 h-4 text-accent animate-spin" />
                    ) : isSuccess ? (
                        <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 text-green-400" />
                        </div>
                    ) : isError ? (
                        <div className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center">
                            <X className="w-2.5 h-2.5 text-red-400" />
                        </div>
                    ) : isRejected ? (
                        <div className="w-4 h-4 rounded-full bg-yellow-500/20 flex items-center justify-center">
                            <X className="w-2.5 h-2.5 text-yellow-400" />
                        </div>
                    ) : (
                        <div className="w-4 h-4 rounded-full border border-text-muted/30" />
                    )}
                </div>

                {/* Title & Description */}
                <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
                    <span
                        className={`text-sm font-medium whitespace-nowrap ${isStreaming || isRunning ? 'text-accent' : 'text-text-secondary'}`}
                    >
                        {TOOL_LABELS[toolCall.name] || toolCall.name}
                    </span>
                    {description ? (
                        <>
                            <span className="text-text-muted/30">|</span>
                            <span className="text-xs truncate font-mono text-text-muted">{description}</span>
                        </>
                    ) : (isStreaming || isRunning) && (
                        <span className="text-xs text-text-muted/50 italic animate-pulse">Processing...</span>
                    )}
                </div>

                {/* Expand Toggle */}
                <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.15 }} className="shrink-0 text-text-muted/50">
                    <ChevronDown className="w-4 h-4" />
                </motion.div>
            </div>

            {/* Expanded Content (CSS Grid Transition) */}
            <div
                className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
                <div className="overflow-hidden">
                    <div className="px-3 pb-3">
                        {renderPreview()}
                        {toolCall.error && (
                            <div className="mt-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-md">
                                <div className="flex items-center gap-2 text-red-400 text-xs font-medium mb-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    Error
                                </div>
                                <p className="text-[11px] text-red-300 font-mono break-all">{toolCall.error}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Approval Actions */}
            {isAwaitingApproval && (
                <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-yellow-500/10 bg-yellow-500/5">
                    <button
                        onClick={onReject}
                        className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all"
                    >
                        {t('toolReject', language)}
                    </button>
                    <button
                        onClick={onApprove}
                        className="px-3 py-1.5 text-xs font-medium bg-accent text-white hover:bg-accent-hover rounded-md transition-all"
                    >
                        {t('toolApprove', language)}
                    </button>
                </div>
            )}
        </div>
    )
},
    (prevProps, nextProps) => {
        // 名称变化时必须重新渲染
        if (prevProps.toolCall.name !== nextProps.toolCall.name) {
            return false
        }

        const prevArgs = prevProps.toolCall.arguments as Record<string, unknown>
        const nextArgs = nextProps.toolCall.arguments as Record<string, unknown>
        const prevStreaming = prevArgs?._streaming
        const nextStreaming = nextArgs?._streaming

        // 流式传输中，检查关键参数是否变化
        if (prevStreaming || nextStreaming) {
            // 检查 path 等关键字段是否变化
            if (prevArgs?.path !== nextArgs?.path) return false
            if (prevArgs?.command !== nextArgs?.command) return false
            if (prevArgs?.query !== nextArgs?.query) return false
            if (prevArgs?.pattern !== nextArgs?.pattern) return false
            return prevProps.toolCall.id === nextProps.toolCall.id && prevStreaming === nextStreaming
        }

        return (
            prevProps.toolCall.id === nextProps.toolCall.id &&
            prevProps.toolCall.status === nextProps.toolCall.status &&
            prevProps.isAwaitingApproval === nextProps.isAwaitingApproval &&
            prevProps.toolCall.result === nextProps.toolCall.result &&
            prevProps.defaultExpanded === nextProps.defaultExpanded
        )
    })

export default ToolCallCard
