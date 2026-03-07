/**
 * 工具调用组组件
 * 简化设计：聚焦当前，简化历史
 * 
 * - 正在执行的工具：独立显示，自动展开
 * - 已完成的工具：全部折叠到组中
 * - 用户可以展开折叠组查看历史
 */

import { useMemo, useCallback, useState } from 'react'
import { Layers, CheckCircle2, XCircle, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ToolCall } from '@/renderer/agent/types'
import ToolCallCard from './ToolCallCard'
import FileChangeCard from './FileChangeCard'
import { MemoryApprovalInline } from './MemoryApprovalInline'
import { needsDiffPreview } from '@/shared/config/tools'
import { useStore } from '@store'
import { api } from '@/renderer/services/electronAPI'
import { joinPath } from '@shared/utils/pathUtils'

interface ToolCallGroupProps {
    toolCalls: ToolCall[]
    pendingToolId?: string
    onApproveTool?: () => void
    onRejectTool?: () => void
    onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
    messageId?: string
}

export default function ToolCallGroup({
    toolCalls,
    pendingToolId,
    onApproveTool,
    onRejectTool,
    onOpenDiff,
    messageId,
}: ToolCallGroupProps) {
    const { language, openFile, setActiveFile, workspacePath } = useStore()
    const [isExpanded, setIsExpanded] = useState(true)

    // 简单分类：已完成 vs 正在执行
    const { completedCalls, activeCalls, hasError } = useMemo(() => {
        const completed: ToolCall[] = []
        const active: ToolCall[] = []
        let hasErr = false

        toolCalls.forEach(tc => {
            const isRunning = tc.status === 'running' || tc.status === 'pending'
            if (isRunning || tc.id === pendingToolId) {
                active.push(tc)
            } else {
                completed.push(tc)
                if (tc.status === 'error') hasErr = true
            }
        })

        return { completedCalls: completed, activeCalls: active, hasError: hasErr }
    }, [toolCalls, pendingToolId])

    const renderToolCard = useCallback(
        (tc: ToolCall, options?: { inFoldedGroup?: boolean }) => {
            const isPending = tc.id === pendingToolId
            const isActive = tc.status === 'running' || tc.status === 'pending'

            // 需要 Diff 预览的工具使用 FileChangeCard
            if (needsDiffPreview(tc.name)) {
                return (
                    <FileChangeCard
                        key={tc.id}
                        toolCall={tc}
                        isAwaitingApproval={isPending}
                        onApprove={isPending ? onApproveTool : undefined}
                        onReject={isPending ? onRejectTool : undefined}
                        onOpenInEditor={onOpenDiff}
                        messageId={messageId}
                    />
                )
            }

            // AI 记忆提议使用极简内联渲染
            if (tc.name === 'remember') {
                return (
                    <MemoryApprovalInline
                        key={tc.id}
                        content={tc.arguments.content as string}
                        isAwaitingApproval={isPending}
                        isSuccess={tc.status === 'success'}
                        messageId={messageId || ''}
                        toolCallId={tc.id}
                        args={tc.arguments}
                    />
                )
            }

            // 其他工具使用 ToolCallCard
            return (
                <ToolCallCard
                    key={tc.id}
                    toolCall={tc}
                    isAwaitingApproval={isPending}
                    onApprove={isPending ? onApproveTool : undefined}
                    onReject={isPending ? onRejectTool : undefined}
                    defaultExpanded={isActive && !options?.inFoldedGroup}
                />
            )
        },
        [pendingToolId, onApproveTool, onRejectTool, onOpenDiff, messageId]
    )

    // 获取简化的工具执行状态描述
    const getCompactStatusText = useCallback((tc: ToolCall) => {
        const name = tc.name
        const status = tc.status
        const args = tc.arguments || {}
        const isSuccess = status === 'success'
        const isError = status === 'error'

        const formatPath = (p: string | unknown) => p ? p.toString().split(/[/\\]/).pop() || '' : ''

        // 终端
        if (name === 'run_command') {
            const cmd = args.command as string
            if (!cmd) return ''
            if (isSuccess) return `Executed ${cmd}`
            if (isError) return `Command failed: ${cmd}`
            return cmd
        }

        // 文件读写
        if (['read_single_file', 'read_file', 'read_multiple_files', 'list_directory', 'get_dir_tree'].includes(name)) {
            const pathInfo = args.path || args.paths
            const target = Array.isArray(pathInfo)
                ? `[${pathInfo.length} files]`
                : formatPath(pathInfo)

            if (!target) return ''
            if (isSuccess) return `Read ${target}`
            if (isError) return `Failed to read ${target}`
            return `Reading ${target}`
        }

        if (['edit_file', 'write_file', 'create_file', 'create_file_or_folder', 'replace_file_content'].includes(name)) {
            const target = formatPath(args.path)
            if (!target) return ''
            const action = name.includes('create') ? 'Created' : 'Updated'
            const actionFail = name.includes('create') ? 'create' : 'edit'
            if (isSuccess) return `${action} ${target}`
            if (isError) return `Failed to ${actionFail} ${target}`
            return `${action.replace('ed', 'ing')} ${target}`
        }

        // 搜索
        if (['search_files', 'codebase_search', 'web_search', 'uiux_search'].includes(name)) {
            const query = (args.pattern || args.query) as string
            const qStr = query ? `"${query}"` : ''
            if (!qStr) return ''
            if (isSuccess) return `Searched ${qStr}`
            if (isError) return `Search failed`
            return `Searching ${qStr}`
        }

        return name.replace(/_/g, ' ')
    }, [])

    const handleToolClick = useCallback(async (tc: ToolCall) => {
        let pathStr = ''
        const argsStr = tc.arguments
        let args: any = {}
        try {
            args = typeof argsStr === 'string' ? JSON.parse(argsStr) : argsStr
        } catch { return }

        if (['read_file', 'edit_file', 'write_file', 'create_file', 'create_file_or_folder', 'replace_file_content', 'get_lint_errors', 'find_references', 'go_to_definition', 'get_hover_info', 'get_document_symbols'].includes(tc.name)) {
            pathStr = args.path
        } else if (tc.name === 'read_multiple_files') {
            pathStr = args.paths?.[0]
        }

        if (pathStr) {
            let absPath = pathStr
            const isAbsolute = /^([a-zA-Z]:[\\/]|[/])/.test(pathStr)
            if (!isAbsolute && workspacePath) {
                absPath = joinPath(workspacePath, absPath)
            }
            try {
                const content = await api.file.read(absPath)
                if (content !== null) {
                    openFile(absPath, content)
                    setActiveFile(absPath)
                }
            } catch (err) {
                // Ignore missing file
            }
        }
    }, [workspacePath, openFile, setActiveFile])

    return (
        <div className="my-2 animate-slide-in-right">
            {/* 1. 已完成的工具统一执行链路卡片 */}
            {completedCalls.length > 0 && (
                <div className="overflow-hidden w-full group/completed rounded-lg hover:bg-text-primary/[0.02] transition-colors mb-2">
                    {/* Header */}
                    <div
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="flex w-full items-center gap-2 px-2 py-1.5 cursor-pointer select-none"
                    >
                        <motion.div animate={{ rotate: isExpanded ? 0 : -90 }} className="shrink-0 text-text-muted/40 hover:text-text-muted transition-colors">
                            <ChevronDown className="w-3.5 h-3.5" />
                        </motion.div>
                        <div className={`shrink-0 relative z-10 w-4 h-4 flex items-center justify-center rounded-sm ${hasError ? 'bg-red-500/10 text-red-400' : 'text-text-muted/70'}`}>
                            <Layers className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                            <span className="text-[12px] truncate text-text-secondary group-hover/completed:text-text-primary transition-colors">
                                {language === 'zh'
                                    ? `已完成 ${completedCalls.length} 个执行步骤`
                                    : `Completed ${completedCalls.length} step${completedCalls.length > 1 ? 's' : ''}`}
                            </span>
                        </div>
                        {hasError ? (
                            <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-status-success shrink-0" />
                        )}
                    </div>

                    {/* Timeline List */}
                    <AnimatePresence initial={false}>
                        {isExpanded && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
                                className="overflow-hidden border-t-0"
                            >
                                <div className="p-2 space-y-1">
                                    {completedCalls.map((tc, index) => {
                                        const isSuccess = tc.status === 'success'
                                        const isError = tc.status === 'error'
                                        const isRejected = tc.status === 'rejected'
                                        const statusText = getCompactStatusText(tc)

                                        return (
                                            <div
                                                key={tc.id}
                                                className="flex items-center gap-2.5 px-2 py-1.5 relative group/item cursor-pointer hover:bg-surface-hover/50 rounded-md transition-colors"
                                                onClick={() => handleToolClick(tc)}
                                            >
                                                {/* Connection Line */}
                                                {index !== completedCalls.length - 1 && (
                                                    <div className="absolute left-[15px] top-[24px] bottom-[-8px] w-[1px] bg-border/40" />
                                                )}

                                                {/* Status Dot */}
                                                <div className="shrink-0 relative z-10 mt-0.5">
                                                    {isSuccess ? (
                                                        <div className="w-3.5 h-3.5 rounded-full bg-green-500/10 flex items-center justify-center">
                                                            <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />
                                                        </div>
                                                    ) : isError ? (
                                                        <div className="w-3.5 h-3.5 rounded-full bg-red-500/10 flex items-center justify-center">
                                                            <XCircle className="w-2.5 h-2.5 text-red-500" />
                                                        </div>
                                                    ) : isRejected ? (
                                                        <div className="w-3.5 h-3.5 rounded-full bg-yellow-500/10 flex items-center justify-center">
                                                            <XCircle className="w-2.5 h-2.5 text-yellow-500" />
                                                        </div>
                                                    ) : (
                                                        <div className="w-3.5 h-3.5 rounded-full border border-text-muted/30 flex items-center justify-center" />
                                                    )}
                                                </div>

                                                {/* Text Info */}
                                                <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
                                                    <span className="text-[12px] font-medium text-text-secondary whitespace-nowrap group-hover/item:text-text-primary transition-colors">
                                                        {tc.name}
                                                    </span>
                                                    {statusText && (
                                                        <>
                                                            <span className="text-border">|</span>
                                                            <span className={`text-[11px] truncate ${isError ? 'text-red-400' : 'text-text-muted group-hover/item:text-text-primary'} transition-colors`}>
                                                                {statusText}
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}

            {/* 2. 正在运行的工具（保持独立的大卡片显示） */}
            <div className="space-y-2">
                <AnimatePresence initial={false}>
                    {activeCalls.map(tc => (
                        <motion.div
                            key={tc.id}
                            initial={{ opacity: 0, height: 0, x: -10 }}
                            animate={{ opacity: 1, height: 'auto', x: 0 }}
                            exit={{ opacity: 0, height: 0, scale: 0.95 }}
                            transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
                            className="overflow-hidden"
                        >
                            {renderToolCard(tc)}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    )
}
