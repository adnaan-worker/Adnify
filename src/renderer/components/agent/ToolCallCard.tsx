/**
 * 工具调用卡片 - 简化版
 * 支持流式参数预览、状态指示、结果展示
 */

import { useState, useMemo, useEffect, memo } from 'react'
import {
    Check,
    X,
    ChevronDown,
    Search,
    Copy,
    AlertTriangle,
    FileCode,
    Terminal,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { ToolCall } from '@renderer/agent/types'
import { JsonHighlight } from '@utils/jsonHighlight'
import { terminalManager } from '@/renderer/services/TerminalManager'
import { RichContentRenderer } from './RichContentRenderer'
import InlineDiffPreview from './InlineDiffPreview'
import { getFileName } from '@shared/utils/pathUtils'
import { TextWithFileLinks } from '../common/TextWithFileLinks'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { themeManager } from '../../config/themeConfig'

const guessLanguage = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    const map: Record<string, string> = {
        js: 'javascript', jsx: 'javascript',
        ts: 'typescript', tsx: 'typescript',
        json: 'json', css: 'css', html: 'html', md: 'markdown',
        py: 'python', rs: 'rust', go: 'go', sh: 'bash',
        yml: 'yaml', yaml: 'yaml', xml: 'xml'
    }
    return map[ext] || 'typescript'
}

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
    // 搜索类
    search_files: 'Search Files',
    codebase_search: 'Semantic Search',
    // 编辑类
    edit_file: 'Edit File',
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
    const { language, setTerminalVisible, currentTheme } = useStore()

    // 合并 arguments 与 streamingState.partialArgs，实现流式参数实时展示
    const args = useMemo(() => ({
        ...(toolCall.arguments || {}),
        ...(toolCall.streamingState?.partialArgs || {}),
    }), [toolCall.arguments, toolCall.streamingState?.partialArgs]) as Record<string, unknown>

    const { status } = toolCall
    const isSuccess = status === 'success'
    const isError = status === 'error'
    const isRejected = status === 'rejected'
    const isRunning = status === 'running' || status === 'pending'

    // 是否正在流式输出（强制在非终态时才允许，防止残留字段导致一直 loading）
    const isFinalState = isSuccess || isError || isRejected
    const isStreaming = !isFinalState && (!!toolCall.streamingState?.isStreaming || args._streaming === true)

    // 运行中自动展开
    useEffect(() => {
        if (isRunning || isStreaming) {
            setIsExpanded(true)
        }
    }, [isRunning, isStreaming])

    // 获取动态状态文本 (替换原有的重复文件名逻辑)
    const statusText = useMemo(() => {
        const name = toolCall.name
        const status = toolCall.status
        const isRunning = status === 'running' || status === 'pending' || isStreaming
        const isSuccess = status === 'success'
        const isError = status === 'error'

        const formatPath = (p: string | unknown) => p ? getFileName(p as string) : ''

        // 终端
        if (name === 'run_command') {
            const cmd = args.command as string
            if (!cmd) return isRunning ? 'Preparing cmd...' : ''
            if (isRunning) return `Executing ${cmd}`
            if (isSuccess) return `Executed ${cmd}`
            if (isError) return `Command failed: ${cmd}`
            return cmd
        }

        // 读取多文件
        if (name === 'read_multiple_files') {
            const paths = args.paths
            if (Array.isArray(paths)) {
                const count = paths.length
                const preview = paths.slice(0, 3).map(p => `"${getFileName(p)}"`).join(', ') + (count > 3 ? '...' : '')
                if (isRunning) return `Reading [${preview}]...`
                if (isSuccess) return `Read [${preview}]`
                if (isError) return `Failed to read files`
                return `Reading [${preview}]`
            }
            if (typeof paths === 'string') {
                if (isRunning) return `Reading ${paths}...`
                if (isSuccess) return `Read ${paths}`
                if (isError) return `Failed to read ${paths}`
                return `Reading ${paths}`
            }
            return `Reading files`
        }

        // 读取单文件或目录
        if (['read_file', 'list_directory'].includes(name)) {
            const target = formatPath(args.path)
            if (!target) return isRunning ? 'Reading...' : ''
            if (isRunning) return `Reading ${target}...`
            if (isSuccess) return `Read ${target}`
            if (isError) return `Failed to read ${target}`
            return `Reading ${target}`
        }

        // 写入/创建
        if (['write_file', 'create_file', 'create_file_or_folder'].includes(name)) {
            const target = formatPath(args.path)
            if (!target) return isRunning ? 'Creating...' : ''
            if (isRunning) return `Creating ${target}...`
            if (isSuccess) return `Created ${target}`
            if (isError) return `Failed to create ${target}`
            return `Creating ${target}`
        }

        // 编辑
        if (name === 'edit_file') {
            const target = formatPath(args.path)
            if (!target) return isRunning ? 'Editing...' : ''
            if (isRunning) return `Editing ${target}...`
            if (isSuccess) return `Updated ${target}`
            if (isError) return `Failed to edit ${target}`
            return `Editing ${target}`
        }

        // 删除
        if (name === 'delete_file_or_folder') {
            const target = formatPath(args.path)
            if (!target) return isRunning ? 'Deleting...' : ''
            if (isRunning) return `Deleting ${target}...`
            if (isSuccess) return `Deleted ${target}`
            if (isError) return `Failed to delete ${target}`
            return `Deleting ${target}`
        }

        // 搜索
        if (['search_files', 'codebase_search', 'web_search', 'uiux_search'].includes(name)) {
            const query = (args.pattern || args.query) as string
            const qStr = query ? `"${query}"` : ''
            if (!qStr) return isRunning ? 'Searching...' : ''
            if (isRunning) return `Searching ${qStr}...`
            if (isSuccess) return `Searched ${qStr}`
            if (isError) return `Search failed`
            return `Searching ${qStr}`
        }

        // URL
        if (name === 'read_url') {
            const url = args.url as string
            let hostname = ''
            if (url) { try { hostname = new URL(url).hostname } catch { hostname = url } }
            if (!hostname) return isRunning ? 'Reading URL...' : ''
            if (isRunning) return `Reading ${hostname}...`
            if (isSuccess) return `Read ${hostname}`
            if (isError) return `Failed to read ${hostname}`
            return `Reading ${hostname}`
        }

        // LSP类
        if (['get_lint_errors', 'find_references', 'go_to_definition', 'get_hover_info', 'get_document_symbols'].includes(name)) {
            const target = formatPath(args.path)
            if (!target) return isRunning ? 'Analyzing...' : ''
            if (isRunning) return `Analyzing ${target}...`
            if (isSuccess) return `Analyzed ${target}`
            if (isError) return `Analysis failed`
            return `Analyzing ${target}`
        }

        // 默认 fallback
        return isRunning ? 'Processing...' : ''
    }, [toolCall.name, toolCall.status, args, isStreaming])

    const handleCopyResult = () => {
        if (toolCall.result) {
            navigator.clipboard.writeText(toolCall.result)
        }
    }

    // 渲染预览内容
    const renderPreview = () => {
        const name = toolCall.name

        // 终端命令
        if (name === 'run_command') {
            const cmd = args.command as string
            const terminalId = ((toolCall as any).meta?.terminalId) as string | undefined

            return (
                <div className="font-mono text-[11px] space-y-1">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-text-muted min-w-0">
                            <span className="text-accent/60 select-none flex-shrink-0">$</span>
                            <span className="text-text-primary break-all">{cmd}</span>
                        </div>
                        {/* 单一按钮：始终打开终端面板并定位到 Agent 终端 */}
                        <button
                            onClick={e => {
                                e.stopPropagation()
                                setTerminalVisible(true)
                                if (terminalId) terminalManager.setActiveTerminal(terminalId)
                            }}
                            className={`flex items-center gap-1 flex-shrink-0 ml-2 text-[10px] px-1.5 py-0.5 rounded transition-colors
                                ${isRunning
                                    ? 'text-accent bg-accent/10 border border-accent/20'
                                    : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
                                }`}
                            title="在终端面板中查看执行过程"
                        >
                            <Terminal className={`w-3 h-3 ${isRunning ? 'animate-pulse' : ''}`} />
                            <span>{isRunning ? 'Running…' : 'Terminal'}</span>
                        </button>
                    </div>
                    {toolCall.result && (
                        <div className="text-text-muted/80 whitespace-pre-wrap break-all border-l-2 border-border/30 pl-2 ml-1 mt-1">
                            {(toolCall.result as string).slice(0, 500)}
                            {(toolCall.result as string).length > 500 && <span className="opacity-50 inline-block ml-1">... (truncated)</span>}
                        </div>
                    )}
                </div>
            )
        }

        // --- 新增 Terminal 控制类工具 UI ---

        // 发送终端输入
        if (name === 'send_terminal_input') {
            const isCtrl = args.is_ctrl
            const bgClass = isCtrl ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' : 'bg-surface-elevated text-text-secondary border border-border/50'
            const displayStr = isCtrl ? `Ctrl+${(args.input as string).toUpperCase()}` : (args.input as string).replace(/\n|\r/g, '\\n')
            return (
                <div className="font-mono text-[11px] space-y-1">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-3.5 h-3.5 text-text-muted" />
                        <span className="text-text-muted">Sent input:</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${bgClass}`}>
                            {displayStr}
                        </span>
                        <span className="text-text-muted/50 text-[10px] ml-1">to {(args.terminal_id as string)}</span>
                    </div>
                </div>
            )
        }

        // 停止终端进程
        if (name === 'stop_terminal') {
            return (
                <div className="font-mono text-[11px] space-y-1 text-red-400">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-3.5 h-3.5 opacity-80" />
                        <span className="font-medium">Force terminated process</span>
                        <span className="opacity-50 text-[10px]">{(args.terminal_id as string)}</span>
                    </div>
                </div>
            )
        }

        // 读取终端输出
        if (name === 'read_terminal_output') {
            return (
                <div className="font-mono text-[11px] space-y-1">
                    <div className="flex items-center gap-2 text-text-muted">
                        <Terminal className="w-3.5 h-3.5 text-accent/70" />
                        <span>Read terminal logs</span>
                        <span className="opacity-50 text-[10px]">{(args.terminal_id as string)}</span>
                    </div>
                    {toolCall.result && typeof toolCall.result === 'string' && toolCall.result.length > 0 && (
                        <div className="text-text-muted/80 whitespace-pre-wrap break-all border-l-2 border-accent/30 pl-2 ml-1 mt-1 max-h-32 overflow-y-auto custom-scrollbar bg-surface/50 p-1.5 rounded-r">
                            {toolCall.result}
                        </div>
                    )}
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
                <div className="space-y-1 text-[11px]">
                    <div className="flex items-center gap-1.5 text-text-muted">
                        <Search className="w-3 h-3" />
                        <span>{searchType}:</span>
                        <span className="text-text-primary font-medium truncate">"{query}"</span>
                    </div>
                    {toolCall.result && (
                        <div className="max-h-48 overflow-y-auto custom-scrollbar border-l-2 border-border/30 pl-2 ml-1">
                            <JsonHighlight data={toolCall.result} className="py-1" maxHeight="max-h-48" maxLength={3000} />
                        </div>
                    )}
                </div>
            )
        }

        // 目录类工具
        if (name === 'list_directory') {
            const path = args.path as string
            const displayName = getFileName(path) || path || '.'
            return (
                <div className="space-y-1 text-[11px]">
                    <div className="flex items-center gap-1.5 text-text-muted">
                        <FileCode className="w-3 h-3" />
                        <span className="text-text-primary font-medium" title={path}>{displayName}</span>
                    </div>
                    {toolCall.result && (
                        <div className="max-h-64 overflow-y-auto custom-scrollbar border-l-2 border-border/30 pl-2 ml-1 font-mono text-text-secondary whitespace-pre">
                            {toolCall.result.slice(0, 3000)}
                            {toolCall.result.length > 3000 && <span className="opacity-50 mt-1 block">... (truncated)</span>}
                        </div>
                    )}
                </div>
            )
        }

        // 文件编辑类工具（带 diff 预览）
        if (['edit_file', 'write_file'].includes(name)) {
            const filePath = (args.path as string) || ''
            const MAX_CHARS = 5000
            const rawNew = ((args.content || args.new_string || '') as string)
            const rawOld = ((args.old_string || '') as string)
            const newContent = rawNew.slice(0, MAX_CHARS)
            const oldContent = rawOld.slice(0, MAX_CHARS)
            const isTruncated = rawNew.length > MAX_CHARS || rawOld.length > MAX_CHARS

            if (newContent || isStreaming) {
                return (
                    <div className="space-y-1">
                        <div className="flex items-center flex-wrap gap-2 text-[11px] text-text-muted">
                            <FileCode className="w-3 h-3 flex-shrink-0" />
                            {filePath ? (
                                <span className="font-medium text-text-primary transition-colors break-all" title={typeof filePath === 'string' ? filePath : JSON.stringify(filePath)}>
                                    <TextWithFileLinks text={typeof filePath === 'string' ? getFileName(filePath) : JSON.stringify(filePath)} />
                                </span>
                            ) : (isStreaming || isRunning) ? (
                                <span className="font-medium text-shimmer italic">editing...</span>
                            ) : (
                                <span className="font-medium text-text-primary opacity-50">&lt;empty path&gt;</span>
                            )}
                            {isStreaming && (
                                <span className="text-accent flex items-center gap-1">
                                    <span className="w-1 h-1 rounded-full bg-accent animate-pulse" />
                                    Writing...
                                </span>
                            )}
                            {isTruncated && !isStreaming && <span className="text-amber-500">(truncated)</span>}
                        </div>
                        <div className="max-h-64 overflow-auto custom-scrollbar border-l-2 border-border/30 pl-2 ml-1">
                            <InlineDiffPreview
                                oldContent={oldContent}
                                newContent={newContent}
                                filePath={filePath}
                                isStreaming={isStreaming}
                                maxLines={30}
                            />
                        </div>
                        {toolCall.result && !isStreaming && (
                            <div className="text-[11px] text-text-muted border-l-2 border-border/30 pl-2 ml-1 mt-1">{toolCall.result.slice(0, 200)}</div>
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
                <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px]">
                        <FileCode className={`w-3 h-3 ${isDelete ? 'text-status-error' : 'text-status-success'}`} />
                        <span className={`font-medium ${isDelete ? 'text-status-error' : 'text-status-success'}`}>
                            {isDelete ? 'Delete' : 'Create'} {isFolder ? 'folder' : 'file'}:
                        </span>
                        <span className="text-text-primary break-all" title={path}>{displayName}</span>
                    </div>
                    {toolCall.result && (
                        <div className="text-[11px] text-text-muted border-l-2 border-border/30 pl-2 ml-1">
                            <TextWithFileLinks text={toolCall.result.slice(0, 200)} />
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
            const theme = themeManager.getThemeById(currentTheme)
            const syntaxStyle = theme?.type === 'light' ? vs : vscDarkPlus

            return (
                <div className="space-y-1 mt-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                        <FileCode className="w-3 h-3" />
                        <span className="font-medium text-text-primary transition-colors hover:underline cursor-pointer" title={typeof args.path === 'string' ? args.path : undefined}>
                            <TextWithFileLinks text={displayName} />
                        </span>
                    </div>
                    {toolCall.result && (
                        <div className="mt-1 relative rounded-lg border border-border/40 bg-background-tertiary overflow-hidden shadow-sm">
                            <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                <SyntaxHighlighter
                                    style={syntaxStyle}
                                    language={filePath ? guessLanguage(filePath) : 'typescript'}
                                    PreTag="div"
                                    className="!bg-transparent !p-3 !m-0 !text-[11px] leading-relaxed font-mono"
                                    customStyle={{ background: 'transparent', margin: 0 }}
                                    wrapLines
                                    wrapLongLines
                                >
                                    {toolCall.result.slice(0, 3000)}
                                </SyntaxHighlighter>
                            </div>
                            {toolCall.result.length > 3000 && <div className="px-3 py-1.5 border-t border-border/50 text-[10px] text-text-muted bg-surface/30 italic drop-shadow-sm truncate">... (Content truncated for preview length limits)</div>}
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
                <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                        <Search className="w-3 h-3" />
                        <a href={url} target="_blank" rel="noreferrer" className="text-text-primary font-medium hover:underline truncate hover:text-accent transition-colors">{hostname}</a>
                    </div>
                    {toolCall.result && (
                        <div className="max-h-48 overflow-y-auto custom-scrollbar border-l-2 border-border/30 pl-2 ml-1 text-[11px] text-text-secondary">
                            {toolCall.result.slice(0, 2000)}
                            {toolCall.result.length > 2000 && <span className="opacity-50 mt-1 block">... (truncated)</span>}
                        </div>
                    )}
                </div>
            )
        }

        // LSP 工具（简洁显示）
        if (['get_lint_errors', 'find_references', 'go_to_definition', 'get_hover_info', 'get_document_symbols'].includes(name)) {
            const path = args.path as string | undefined
            const line = args.line as number | undefined
            return (
                <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                        <FileCode className="w-3 h-3" />
                        <span className="font-medium text-text-primary transition-colors hover:underline cursor-pointer" title={typeof path === 'string' ? path : JSON.stringify(path)}>
                            <TextWithFileLinks text={typeof path === 'string' ? getFileName(path) : JSON.stringify(path)} />
                        </span>
                        {line && <span className="text-text-muted/60">:{line}</span>}
                    </div>
                    {toolCall.result && (
                        <div className="max-h-48 overflow-y-auto custom-scrollbar border-l-2 border-border/30 pl-2 ml-1">
                            <JsonHighlight data={toolCall.result} className="py-1" maxHeight="max-h-48" maxLength={2000} />
                        </div>
                    )}
                </div>
            )
        }

        // 默认：显示参数和结果
        const hasArgs = Object.keys(args).filter(k => !k.startsWith('_')).length > 0
        return (
            <div className="space-y-1 mt-1 text-[11px]">
                {hasArgs && (
                    <>
                        <div className="flex items-center gap-1.5 text-text-muted">
                            <FileCode className="w-3 h-3" />
                            <span>Arguments:</span>
                        </div>
                        <div className="max-h-32 overflow-y-auto custom-scrollbar border-l-2 border-border/30 pl-2 ml-1">
                            <JsonHighlight
                                data={Object.fromEntries(Object.entries(args).filter(([k]) => !k.startsWith('_')))}
                                className="py-1"
                                maxHeight="max-h-32"
                                maxLength={1500}
                            />
                        </div>
                    </>
                )}
                {toolCall.richContent && toolCall.richContent.length > 0 && (
                    <RichContentRenderer content={toolCall.richContent} maxHeight="max-h-64" />
                )}
                {toolCall.result && (!toolCall.richContent || toolCall.richContent.length === 0) && (
                    <>
                        <div className="flex items-center justify-between gap-1.5 text-text-muted mt-2 group/title">
                            <div className="flex items-center gap-1.5">
                                <Terminal className="w-3 h-3" />
                                <span>Result:</span>
                            </div>
                            <button
                                onClick={e => {
                                    e.stopPropagation()
                                    handleCopyResult()
                                }}
                                className="opacity-0 group-hover/title:opacity-100 transition-opacity p-0.5 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary"
                                title="Copy Result"
                            >
                                <Copy className="w-3 h-3" />
                            </button>
                        </div>
                        <div className="max-h-48 overflow-y-auto custom-scrollbar border-l-2 border-border/30 pl-2 ml-1">
                            <JsonHighlight data={toolCall.result} className="py-1" maxHeight="max-h-48" maxLength={3000} />
                        </div>
                    </>
                )}
            </div>
        )
    }

    // 极简卡片样式
    const cardStyle = useMemo(() => {
        if (isAwaitingApproval) return 'border border-yellow-500/20 bg-yellow-500/5 rounded-lg shadow-sm shadow-yellow-500/5 overflow-hidden'
        if (isError) return 'bg-red-500/5 rounded-lg overflow-hidden'
        if (isStreaming || isRunning) return 'bg-accent/5 rounded-lg overflow-hidden'
        return 'hover:bg-text-primary/[0.02] transition-colors rounded-lg overflow-hidden'
    }, [isAwaitingApproval, isError, isStreaming, isRunning])

    return (
        <div className={`group my-0.5 relative ${cardStyle}`}>
            {/* Sweeping Light Effect for running state */}
            {(isStreaming || isRunning) && (
                <div className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden">
                    <div className="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-accent/10 to-transparent animate-shimmer" />
                </div>
            )}

            {/* Header - Flat Outline Style */}
            <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer select-none" onClick={() => setIsExpanded(!isExpanded)}>
                {/* Expand Toggle (Moved to far left) */}
                <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }} className="shrink-0 text-text-muted/40 hover:text-text-muted">
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                </motion.div>

                {/* Status Icon */}
                <div className="shrink-0 relative z-10 w-4 h-4 flex items-center justify-center">
                    {isStreaming || isRunning ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
                            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                        </div>
                    ) : isSuccess ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-green-500/10 flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 text-green-500" />
                        </div>
                    ) : isError ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-red-500/10 flex items-center justify-center">
                            <X className="w-2.5 h-2.5 text-red-500" />
                        </div>
                    ) : isRejected ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-yellow-500/10 flex items-center justify-center">
                            <X className="w-2.5 h-2.5 text-yellow-500" />
                        </div>
                    ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-text-muted/30" />
                    )}
                </div>

                {/* Flat Action Text */}
                <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden relative z-10">
                    <span className={`text-[12px] truncate ${isStreaming || isRunning ? 'text-text-primary text-shimmer' : 'text-text-secondary group-hover:text-text-primary transition-colors'}`}>
                        {statusText ||
                            <span className="opacity-50 inline-flex items-center gap-1.5">
                                <span>
                                    {TOOL_LABELS[toolCall.name] || toolCall.name}
                                </span>
                            </span>
                        }
                    </span>
                </div>
            </div>

            {/* Expanded Content (Framer Motion) */}
            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
                        className="overflow-hidden"
                    >
                        <div className="pl-[26px] pr-3 pb-3 pt-0 relative border-t-0">
                            {/* Visual Threading Line */}
                            <div className="absolute left-[13.5px] top-0 bottom-4 w-[1.5px] bg-border/40 rounded-full" />

                            {/* Nested Content Wrapper */}
                            <div className="relative z-10 space-y-2 mt-1">
                                {renderPreview()}
                                {toolCall.error && (
                                    <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-md">
                                        <div className="flex items-center gap-2 text-red-400 text-xs font-medium mb-1">
                                            <AlertTriangle className="w-3 h-3" />
                                            Error
                                        </div>
                                        <p className="text-[11px] text-red-300 font-mono break-all">{toolCall.error}</p>
                                    </div>
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
        // 先比较基本属性
        if (
            prevProps.toolCall.id !== nextProps.toolCall.id ||
            prevProps.toolCall.name !== nextProps.toolCall.name ||
            prevProps.toolCall.status !== nextProps.toolCall.status ||
            prevProps.toolCall.error !== nextProps.toolCall.error ||
            prevProps.toolCall.result !== nextProps.toolCall.result ||
            prevProps.isAwaitingApproval !== nextProps.isAwaitingApproval ||
            prevProps.defaultExpanded !== nextProps.defaultExpanded
        ) {
            return false // 依赖属性变化 -> 重绘
        }

        // 状态相同情况下（比如均为 running），进一步检查展示的参数内容是否发生变化
        // （为了性能，仅合并可能实时更新的重要参数做检查）
        const prevArgs = { ...prevProps.toolCall.arguments, ...prevProps.toolCall.streamingState?.partialArgs }
        const nextArgs = { ...nextProps.toolCall.arguments, ...nextProps.toolCall.streamingState?.partialArgs }

        const monitorKeys = ['path', 'command', 'query', 'pattern', 'new_string', 'content', 'url']
        for (const key of monitorKeys) {
            if (prevArgs[key] !== nextArgs[key]) return false
        }

        // 最后比较 streaming 标志位的变化（如从 false 变 true 等）
        const prevStreaming = prevProps.toolCall.streamingState?.isStreaming || prevProps.toolCall.arguments?._streaming
        const nextStreaming = nextProps.toolCall.streamingState?.isStreaming || nextProps.toolCall.arguments?._streaming

        return prevStreaming === nextStreaming
    })

export default ToolCallCard
