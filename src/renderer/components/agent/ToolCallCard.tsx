import { memo, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Copy, FileCode, Search, Terminal, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import type { ToolCall } from '@renderer/agent/types'
import { useToolDisplayState } from '@renderer/agent/presentation/toolDisplay'
import { JsonHighlight } from '@utils/jsonHighlight'
import { terminalManager } from '@/renderer/services/TerminalManager'
import { toast } from '@components/common/ToastProvider'
import { RichContentRenderer } from './RichContentRenderer'
import InlineDiffPreview from './InlineDiffPreview'
import { getExtension, getFileName } from '@shared/utils/pathUtils'
import { TextWithFileLinks } from '../common/TextWithFileLinks'
import { SyntaxHighlighter } from '@renderer/utils/syntaxHighlighter'
import { themeManager } from '../../config/themeConfig'

interface ToolCallCardProps {
    toolCall: ToolCall
    isAwaitingApproval?: boolean
    onApprove?: () => void
    onReject?: () => void
    defaultExpanded?: boolean
}

type ToolArgs = Record<string, unknown>

const TOOL_LABELS: Record<string, string> = {
    read_file: 'Read File',
    read_multiple_files: 'Read Files',
    list_directory: 'List Directory',
    search_files: 'Search Files',
    codebase_search: 'Semantic Search',
    edit_file: 'Edit File',
    write_file: 'Write File',
    create_file: 'Create File',
    create_file_or_folder: 'Create',
    delete_file_or_folder: 'Delete',
    run_command: 'Run Command',
    get_lint_errors: 'Lint Errors',
    find_references: 'Find References',
    go_to_definition: 'Go to Definition',
    get_hover_info: 'Hover Info',
    get_document_symbols: 'Document Symbols',
    web_search: 'Web Search',
    read_url: 'Read URL',
    ask_user: 'Ask User',
    remember: 'Remember Fact',
    uiux_search: 'UI/UX Search',
    uiux_recommend: 'UI/UX Recommend',
    apply_skill: 'Apply Skill',
    todo_write: 'Task List',
}

const guessLanguage = (filename: string) => {
    const ext = getExtension(filename)
    const map: Record<string, string> = {
        js: 'javascript',
        jsx: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        json: 'json',
        css: 'css',
        html: 'html',
        md: 'markdown',
        py: 'python',
        rs: 'rust',
        go: 'go',
        sh: 'bash',
        yml: 'yaml',
        yaml: 'yaml',
        xml: 'xml',
    }
    return map[ext] || 'typescript'
}

const asString = (value: unknown): string => typeof value === 'string' ? value : ''

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const getPreviewPath = (value: unknown) => getFileName(value)

function getStatusText(name: string, args: ToolArgs, status: ToolCall['status'], isStreaming: boolean): string {
    const isRunning = status === 'running' || status === 'pending' || isStreaming
    const isSuccess = status === 'success'
    const isError = status === 'error'
    const path = getPreviewPath(args.path)

    if (name === 'run_command') {
        const cmd = asString(args.command)
        if (!cmd) return isRunning ? 'Preparing cmd...' : ''
        if (isRunning) return `Executing ${cmd}`
        if (isSuccess) return `Executed ${cmd}`
        if (isError) return `Command failed: ${cmd}`
        return cmd
    }

    if (name === 'read_multiple_files') {
        const paths = args.paths
        const stringPaths = asStringArray(paths)
        if (stringPaths.length > 0) {
            const preview = stringPaths.slice(0, 3).map(pathItem => `"${getFileName(pathItem)}"`).join(', ') + (stringPaths.length > 3 ? '...' : '')
            if (isRunning) return `Reading [${preview}]...`
            if (isSuccess) return `Read [${preview}]`
            if (isError) return 'Failed to read files'
            return `Reading [${preview}]`
        }
        if (typeof paths === 'string') {
            if (isRunning) return `Reading ${paths}...`
            if (isSuccess) return `Read ${paths}`
            if (isError) return `Failed to read ${paths}`
            return `Reading ${paths}`
        }
        return 'Reading files'
    }

    if (['read_file', 'list_directory'].includes(name)) {
        if (!path) return isRunning ? 'Reading...' : ''
        if (isRunning) return `Reading ${path}...`
        if (isSuccess) return `Read ${path}`
        if (isError) return `Failed to read ${path}`
        return `Reading ${path}`
    }

    if (['write_file', 'create_file', 'create_file_or_folder'].includes(name)) {
        if (!path) return isRunning ? 'Creating...' : ''
        if (isRunning) return `Creating ${path}...`
        if (isSuccess) return `Created ${path}`
        if (isError) return `Failed to create ${path}`
        return `Creating ${path}`
    }

    if (name === 'edit_file') {
        if (!path) return isRunning ? 'Editing...' : ''
        if (isRunning) return `Editing ${path}...`
        if (isSuccess) return `Updated ${path}`
        if (isError) return `Failed to edit ${path}`
        return `Editing ${path}`
    }

    if (name === 'delete_file_or_folder') {
        if (!path) return isRunning ? 'Deleting...' : ''
        if (isRunning) return `Deleting ${path}...`
        if (isSuccess) return `Deleted ${path}`
        if (isError) return `Failed to delete ${path}`
        return `Deleting ${path}`
    }

    if (['search_files', 'codebase_search', 'web_search', 'uiux_search'].includes(name)) {
        const query = asString(args.pattern) || asString(args.query)
        const value = query ? `"${query}"` : ''
        if (!value) return isRunning ? 'Searching...' : ''
        if (isRunning) return `Searching ${value}...`
        if (isSuccess) return `Searched ${value}`
        if (isError) return 'Search failed'
        return `Searching ${value}`
    }

    if (name === 'read_url') {
        const url = asString(args.url)
        let hostname = ''
        if (url) {
            try {
                hostname = new URL(url).hostname
            } catch {
                hostname = url
            }
        }
        if (!hostname) return isRunning ? 'Reading URL...' : ''
        if (isRunning) return `Reading ${hostname}...`
        if (isSuccess) return `Read ${hostname}`
        if (isError) return `Failed to read ${hostname}`
        return `Reading ${hostname}`
    }

    if (['get_lint_errors', 'find_references', 'go_to_definition', 'get_hover_info', 'get_document_symbols'].includes(name)) {
        if (!path) return isRunning ? 'Analyzing...' : ''
        if (isRunning) return `Analyzing ${path}...`
        if (isSuccess) return `Analyzed ${path}`
        if (isError) return 'Analysis failed'
        return `Analyzing ${path}`
    }

    if (name === 'apply_skill') {
        const skillName = asString(args.skill_name)
        if (!skillName) return isRunning ? 'Loading skill...' : ''
        if (isRunning) return `Applying ${skillName}...`
        if (isSuccess) return `Applied ${skillName}`
        if (isError) return `Failed to apply ${skillName}`
        return `Applying ${skillName}`
    }

    if (name === 'todo_write') {
        if (isRunning) return 'Updating tasks...'
        if (isSuccess) return 'Tasks updated'
        if (isError) return 'Failed to update tasks'
        return 'Updating tasks'
    }

    return isRunning ? 'Processing...' : ''
}

function ToolPreview({
    toolCall,
    args,
    effectiveName,
    isRunning,
    isStreaming,
    language,
    currentTheme,
    onCopyResult,
    setTerminalVisible,
}: {
    toolCall: ToolCall
    args: ToolArgs
    effectiveName: string
    isRunning: boolean
    isStreaming: boolean
    language: string
    currentTheme: string
    onCopyResult: () => void
    setTerminalVisible: (visible: boolean) => void
}) {
    const stringResult = typeof toolCall.result === 'string' ? toolCall.result : ''

    if (effectiveName === 'run_command') {
        const cmd = asString(args.command)
        const terminalId = (args as { _meta?: { terminalId?: string } })._meta?.terminalId

        return (
            <div className="font-mono text-[11px] space-y-1">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-text-muted min-w-0">
                        <span className="text-accent/60 select-none flex-shrink-0">$</span>
                        <span className="text-text-primary break-all">{cmd}</span>
                    </div>
                    <button
                        onClick={event => {
                            event.stopPropagation()
                            if (terminalId && !terminalManager.hasTerminal(terminalId)) {
                                toast.info('Terminal has been closed')
                                return
                            }
                            setTerminalVisible(true)
                            if (terminalId) terminalManager.setActiveTerminal(terminalId)
                        }}
                        className={`flex items-center gap-1 flex-shrink-0 ml-2 text-[10px] px-1.5 py-0.5 rounded transition-colors ${isRunning ? 'text-accent bg-accent/10 border border-accent/20' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'}`}
                        title={t('tool.viewInTerminal', language as any)}
                    >
                        <Terminal className={`w-3 h-3 ${isRunning ? 'animate-pulse' : ''}`} />
                        <span>{isRunning ? t('tool.running', language as any) : t('tool.terminal', language as any)}</span>
                    </button>
                </div>
                {stringResult && (
                    <div className="text-text-muted/80 whitespace-pre-wrap break-all border-l-2 border-border/30 pl-2 ml-1 mt-1">
                        {stringResult.slice(0, 500)}
                        {stringResult.length > 500 && <span className="opacity-50 inline-block ml-1">... (truncated)</span>}
                    </div>
                )}
            </div>
        )
    }

    if (effectiveName === 'send_terminal_input') {
        const input = asString(args.input)
        const display = args.is_ctrl ? `Ctrl+${input.toUpperCase()}` : input.replace(/\n|\r/g, '\\n')
        const badgeClass = args.is_ctrl ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' : 'bg-surface-elevated text-text-secondary border border-border/50'

        return (
            <div className="font-mono text-[11px] space-y-1">
                <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-text-muted">Sent input:</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badgeClass}`}>{display}</span>
                    <span className="text-text-muted/50 text-[10px] ml-1">to {asString(args.terminal_id)}</span>
                </div>
            </div>
        )
    }

    if (effectiveName === 'stop_terminal') {
        return (
            <div className="font-mono text-[11px] space-y-1 text-red-400">
                <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 opacity-80" />
                    <span className="font-medium">Force terminated process</span>
                    <span className="opacity-50 text-[10px]">{asString(args.terminal_id)}</span>
                </div>
            </div>
        )
    }

    if (effectiveName === 'read_terminal_output') {
        return (
            <div className="font-mono text-[11px] space-y-1">
                <div className="flex items-center gap-2 text-text-muted">
                    <Terminal className="w-3.5 h-3.5 text-accent/70" />
                    <span>Read terminal logs</span>
                    <span className="opacity-50 text-[10px]">{asString(args.terminal_id)}</span>
                </div>
                {stringResult.length > 0 && (
                    <div className="text-text-muted/80 whitespace-pre-wrap break-all border-l-2 border-accent/30 pl-2 ml-1 mt-1 max-h-32 overflow-y-auto custom-scrollbar bg-surface/50 p-1.5 rounded-r">
                        {stringResult}
                    </div>
                )}
            </div>
        )
    }

    if (['search_files', 'codebase_search', 'web_search', 'uiux_search'].includes(effectiveName)) {
        const query = asString(args.pattern) || asString(args.query)
        const searchType = effectiveName === 'codebase_search' ? 'Semantic' : effectiveName === 'web_search' ? 'Web' : effectiveName === 'uiux_search' ? 'UI/UX' : 'Files'

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

    if (effectiveName === 'list_directory') {
        const path = asString(args.path)
        const displayName = getFileName(path) || path || '.'

        return (
            <div className="space-y-1 text-[11px]">
                <div className="flex items-center gap-1.5 text-text-muted">
                    <FileCode className="w-3 h-3" />
                    <span className="text-text-primary font-medium" title={path || undefined}>{displayName}</span>
                </div>
                {stringResult && (
                    <div className="max-h-64 overflow-y-auto custom-scrollbar border-l-2 border-border/30 pl-2 ml-1 font-mono text-text-secondary whitespace-pre">
                        {stringResult.slice(0, 3000)}
                        {stringResult.length > 3000 && <span className="opacity-50 mt-1 block">... (truncated)</span>}
                    </div>
                )}
            </div>
        )
    }

    if (['edit_file', 'write_file'].includes(effectiveName)) {
        const filePath = asString(args.path)
        const oldString = asString(args.old_string)
        const nextContent = asString(args.content) || asString(args.new_string)
        const oldContent = oldString.slice(0, 5000)
        const newContent = nextContent.slice(0, 5000)
        const isTruncated = nextContent.length > 5000 || oldString.length > 5000

        if (newContent || isStreaming) {
            return (
                <div className="space-y-1">
                    <div className="flex items-center flex-wrap gap-2 text-[11px] text-text-muted">
                        <FileCode className="w-3 h-3 flex-shrink-0" />
                        {filePath ? (
                            <span className="font-medium text-text-primary transition-colors break-all" title={filePath}>
                                <TextWithFileLinks text={getFileName(filePath)} />
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
                    {stringResult && !isStreaming && (
                        <div className="text-[11px] text-text-muted border-l-2 border-border/30 pl-2 ml-1 mt-1">
                            {stringResult.slice(0, 200)}
                        </div>
                    )}
                </div>
            )
        }
    }

    if (['create_file_or_folder', 'delete_file_or_folder'].includes(effectiveName)) {
        const path = asString(args.path)
        const isDelete = effectiveName === 'delete_file_or_folder'
        const isFolder = path.endsWith('/')
        const displayName = path ? (getFileName(path) || path) : '<no path>'

        return (
            <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[11px]">
                    <FileCode className={`w-3 h-3 ${isDelete ? 'text-status-error' : 'text-status-success'}`} />
                    <span className={`font-medium ${isDelete ? 'text-status-error' : 'text-status-success'}`}>
                        {isDelete ? 'Delete' : 'Create'} {isFolder ? 'folder' : 'file'}:
                    </span>
                    <span className="text-text-primary break-all" title={path || undefined}>{displayName}</span>
                </div>
                {stringResult && (
                    <div className="text-[11px] text-text-muted border-l-2 border-border/30 pl-2 ml-1">
                        <TextWithFileLinks text={stringResult.slice(0, 200)} />
                    </div>
                )}
            </div>
        )
    }

    if (['read_file', 'read_multiple_files'].includes(effectiveName)) {
        const filePath = effectiveName === 'read_file' ? asString(args.path) : ''
        const paths = asStringArray(args.paths)
        const displayName = effectiveName === 'read_file' ? (filePath ? getFileName(filePath) : '<no path>') : `${paths.length} files`
        const theme = themeManager.getThemeById(currentTheme)
        const syntaxStyle = theme?.type === 'light' ? vs : vscDarkPlus

        return (
            <div className="space-y-1 mt-1">
                <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                    <FileCode className="w-3 h-3" />
                    <span className="font-medium text-text-primary transition-colors hover:underline cursor-pointer" title={filePath || undefined}>
                        <TextWithFileLinks text={displayName} />
                    </span>
                </div>
                {stringResult && (
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
                                {stringResult.slice(0, 3000)}
                            </SyntaxHighlighter>
                        </div>
                        {stringResult.length > 3000 && (
                            <div className="px-3 py-1.5 border-t border-border/50 text-[10px] text-text-muted bg-surface/30 italic drop-shadow-sm truncate">
                                ... (Content truncated for preview length limits)
                            </div>
                        )}
                    </div>
                )}
            </div>
        )
    }

    if (effectiveName === 'read_url') {
        const url = asString(args.url)
        let hostname = '<no url>'
        if (url) {
            try {
                hostname = new URL(url).hostname
            } catch {
                hostname = url
            }
        }

        return (
            <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                    <Search className="w-3 h-3" />
                    <a href={url} target="_blank" rel="noreferrer" className="text-text-primary font-medium hover:underline truncate hover:text-accent transition-colors">
                        {hostname}
                    </a>
                </div>
                {stringResult && (
                    <div className="max-h-48 overflow-y-auto custom-scrollbar border-l-2 border-border/30 pl-2 ml-1 text-[11px] text-text-secondary">
                        {stringResult.slice(0, 2000)}
                        {stringResult.length > 2000 && <span className="opacity-50 mt-1 block">... (truncated)</span>}
                    </div>
                )}
            </div>
        )
    }

    if (['get_lint_errors', 'find_references', 'go_to_definition', 'get_hover_info', 'get_document_symbols'].includes(effectiveName)) {
        const path = asString(args.path)
        const line = typeof args.line === 'number' ? args.line : undefined

        return (
            <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                    <FileCode className="w-3 h-3" />
                    <span className="font-medium text-text-primary transition-colors hover:underline cursor-pointer" title={path || undefined}>
                        <TextWithFileLinks text={getFileName(path) || '<unknown path>'} />
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

    const hasArgs = Object.keys(args).some(key => !key.startsWith('_'))
    const filteredArgs = Object.fromEntries(Object.entries(args).filter(([key]) => !key.startsWith('_')))

    return (
        <div className="space-y-1 mt-1 text-[11px]">
            {hasArgs && (
                <>
                    <div className="flex items-center gap-1.5 text-text-muted">
                        <FileCode className="w-3 h-3" />
                        <span>Arguments:</span>
                    </div>
                    <div className="max-h-32 overflow-y-auto custom-scrollbar border-l-2 border-border/30 pl-2 ml-1">
                        <JsonHighlight data={filteredArgs} className="py-1" maxHeight="max-h-32" maxLength={1500} />
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
                            onClick={event => {
                                event.stopPropagation()
                                onCopyResult()
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

const ToolCallCard = memo(function ToolCallCard({
    toolCall,
    isAwaitingApproval,
    onApprove,
    onReject,
    defaultExpanded = false,
}: ToolCallCardProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded)
    const { language, setTerminalVisible, currentTheme } = useStore(useShallow(state => ({
        language: state.language,
        setTerminalVisible: state.setTerminalVisible,
        currentTheme: state.currentTheme,
    })))
    const { args, effectiveName, isSuccess, isError, isRejected, isRunning, isStreaming } = useToolDisplayState(toolCall)

    useEffect(() => {
        if (isRunning || isStreaming) {
            setIsExpanded(true)
        }
    }, [isRunning, isStreaming])

    const statusText = useMemo(
        () => getStatusText(effectiveName, args, toolCall.status, isStreaming),
        [effectiveName, args, toolCall.status, isStreaming]
    )

    const cardStyle = useMemo(() => {
        if (isAwaitingApproval) return 'border border-yellow-500/20 bg-yellow-500/5 rounded-lg shadow-sm shadow-yellow-500/5 overflow-hidden'
        if (isError) return 'bg-red-500/5 rounded-lg overflow-hidden'
        if (isStreaming || isRunning) return 'bg-accent/5 rounded-lg overflow-hidden'
        return 'hover:bg-text-primary/[0.02] transition-colors rounded-lg overflow-hidden'
    }, [isAwaitingApproval, isError, isStreaming, isRunning])

    return (
        <div className={`group my-0.5 relative ${cardStyle}`}>
            {(isStreaming || isRunning) && (
                <div className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden">
                    <div className="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-accent/10 to-transparent animate-shimmer" />
                </div>
            )}

            <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer select-none" onClick={() => setIsExpanded(!isExpanded)}>
                <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }} className="shrink-0 text-text-muted/40 hover:text-text-muted">
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                </motion.div>

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

                <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden relative z-10">
                    <span className={`text-[12px] truncate ${isStreaming || isRunning ? 'text-text-primary text-shimmer' : 'text-text-secondary group-hover:text-text-primary transition-colors'}`}>
                        {statusText || (
                            <span className="opacity-50 inline-flex items-center gap-1.5">
                                <span>{TOOL_LABELS[effectiveName] || effectiveName}</span>
                            </span>
                        )}
                    </span>
                </div>
            </div>

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
                            <div className="absolute left-[13.5px] top-0 bottom-4 w-[1.5px] bg-border/40 rounded-full" />

                            <div className="relative z-10 space-y-2 mt-1">
                                <ToolPreview
                                    toolCall={toolCall}
                                    args={args}
                                    effectiveName={effectiveName}
                                    isRunning={isRunning}
                                    isStreaming={isStreaming}
                                    language={language}
                                    currentTheme={currentTheme}
                                    onCopyResult={() => {
                                        if (toolCall.result) {
                                            navigator.clipboard.writeText(toolCall.result)
                                        }
                                    }}
                                    setTerminalVisible={setTerminalVisible}
                                />
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

            {isAwaitingApproval && (
                <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-yellow-500/10 bg-yellow-500/5">
                    <button onClick={onReject} className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all">
                        {t('toolReject', language as any)}
                    </button>
                    <button onClick={onApprove} className="px-3 py-1.5 text-xs font-medium bg-accent text-white hover:bg-accent-hover rounded-md transition-all">
                        {t('toolApprove', language as any)}
                    </button>
                </div>
            )}
        </div>
    )
}, (prevProps, nextProps) => {
    if (
        prevProps.toolCall.id !== nextProps.toolCall.id ||
        prevProps.toolCall.name !== nextProps.toolCall.name ||
        prevProps.toolCall.status !== nextProps.toolCall.status ||
        prevProps.toolCall.error !== nextProps.toolCall.error ||
        prevProps.toolCall.result !== nextProps.toolCall.result ||
        prevProps.isAwaitingApproval !== nextProps.isAwaitingApproval ||
        prevProps.defaultExpanded !== nextProps.defaultExpanded
    ) {
        return false
    }

    return true
})

export default ToolCallCard
