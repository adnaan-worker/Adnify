/**
 * 文件变更卡片 - 带 Diff 预览的设计
 * 显示删除/新增行的 unified diff 视图，支持语法高亮
 * 
 * 增强功能：
 * - 实时流式 Diff 更新（订阅 streamingEditService）
 * - 与多文件 Diff 面板联动
 */

import { useState, useEffect, useMemo } from 'react'
import { Check, X, ChevronDown, ExternalLink } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ToolCall } from '@renderer/agent/types'
import { streamingEditService } from '@renderer/agent/services/streamingEditService'
import InlineDiffPreview, { getDiffStats } from './InlineDiffPreview'
import { getFileName, joinPath } from '@shared/utils/pathUtils'
import { CodeSkeleton } from '../ui/Loading'
import { useStore } from '@store'
import { api } from '@/renderer/services/electronAPI'
import { toast } from '@components/common/ToastProvider'

interface FileChangeCardProps {
    toolCall: ToolCall
    isAwaitingApproval?: boolean
    onApprove?: () => void
    onReject?: () => void
    onOpenInEditor?: (path: string, oldContent: string, newContent: string) => void
    messageId?: string
}

export default function FileChangeCard({
    toolCall,
    isAwaitingApproval,
    onApprove,
    onReject,
    onOpenInEditor,
}: FileChangeCardProps) {
    const [isExpanded, setIsExpanded] = useState(false)
    const { openFile, setActiveFile, workspacePath } = useStore()

    // 合并 arguments 与 streamingState.partialArgs，实现流式参数实时展示
    const args = useMemo(() => ({
        ...(toolCall.arguments || {}),
        ...(toolCall.streamingState?.partialArgs || {}),
    }), [toolCall.arguments, toolCall.streamingState?.partialArgs]) as Record<string, unknown>

    const meta = args._meta as Record<string, unknown> | undefined
    const filePath = (args.path || meta?.filePath) as string || ''

    const { status } = toolCall
    const isSuccess = status === 'success'
    const isError = status === 'error'
    const isRejected = status === 'rejected'
    const isRunning = status === 'running' || status === 'pending'

    // 是否正在流式输出（强制在非终态时才允许，防止残留字段导致一直 loading）
    const isFinalState = isSuccess || isError || isRejected
    const isStreaming = !isFinalState && (!!toolCall.streamingState?.isStreaming || args._streaming === true)

    // 流式内容状态 - 订阅 streamingEditService 获取实时更新
    const [streamingContent, setStreamingContent] = useState<string | null>(null)

    // 订阅流式编辑更新
    useEffect(() => {
        if (!isRunning && !isStreaming) {
            setStreamingContent(null)
            return
        }

        // 尝试获取该文件的流式编辑状态
        const editState = streamingEditService.getEditByFilePath(filePath)
        if (editState) {
            setStreamingContent(editState.currentContent)
        }

        // 订阅全局变更
        const unsubscribe = streamingEditService.subscribeGlobal((activeEdits) => {
            for (const [, state] of activeEdits) {
                if (state.filePath === filePath) {
                    setStreamingContent(state.currentContent)
                    return
                }
            }
        })

        return unsubscribe
    }, [filePath, isRunning, isStreaming])

    // 获取新旧内容用于 diff
    const oldContent = useMemo(() => {
        // 优先从 meta 获取（工具执行完成后会有准确的 oldContent）
        if (meta?.oldContent !== undefined) {
            return meta.oldContent as string
        }

        // 流式模式下 edit_file：用 old_string 作为旧内容，实现 patch 风格实时 diff
        if ((isRunning || isStreaming) && args.old_string) {
            return args.old_string as string
        }

        // 在流式传输或运行阶段，如果工具是局部编辑类（非全量覆盖），
        // 且还没有 meta 结果（即工具未完成），暂时忽略旧内容，
        // 避免将 patch 片段与完整旧文件对比导致显示大面积删除。
        if ((isRunning || isStreaming) && !meta?.oldContent && !args.old_string) {
            const isPartialEdit = ['edit_file', 'replace_file_content'].includes(toolCall.name)
            if (isPartialEdit) return ''
        }

        return ''
    }, [meta, args.old_string, isRunning, isStreaming, toolCall.name])

    const newContent = useMemo(() => {
        // 优先使用流式内容（实时更新）
        if (streamingContent && (isRunning || isStreaming)) {
            return streamingContent
        }
        if (meta?.newContent) return meta.newContent as string
        // Fallback: 从 args 中获取
        return (args.content || args.code || args.new_string || args.replacement || args.source) as string || ''
    }, [args, meta, streamingContent, isRunning, isStreaming])

    // 计算行数变化 - 优先使用工具返回的准确统计
    const diffStats = useMemo(() => {
        // 优先使用工具执行后返回的准确统计数据
        if (meta?.linesAdded !== undefined || meta?.linesRemoved !== undefined) {
            return {
                added: (meta.linesAdded as number) || 0,
                removed: (meta.linesRemoved as number) || 0
            }
        }
        // 流式传输中或没有 meta 时，使用 diff 计算（可能不准确）
        if (!newContent) return { added: 0, removed: 0 }
        try {
            return getDiffStats(oldContent, newContent)
        } catch {
            return { added: 0, removed: 0 }
        }
    }, [oldContent, newContent, meta])

    // 自动展开 logic
    useEffect(() => {
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
            // 缩短到 100ms，让用户感觉更快
            timer = setTimeout(() => setShowContent(true), 100)
        } else {
            // 收起时：立即隐藏内容，防止重绘
            setShowContent(false)
        }
        return () => clearTimeout(timer)
    }, [isExpanded])

    // 判断是否是新建文件
    // 注意：不能仅依据 !oldContent 判断，因为编辑状态下初始可能没有 oldContent 流回来
    const isNewFile = ['create_file', 'create_file_or_folder'].includes(toolCall.name) ||
        (!oldContent && !!newContent && !['edit_file', 'replace_file_content', 'write_file'].includes(toolCall.name))



    // 计算卡片样式
    const cardStyle = useMemo(() => {
        if (isAwaitingApproval) return 'border-l-2 border-yellow-500 bg-yellow-500/5'
        if (isError) return 'bg-red-500/5'
        if (isStreaming || isRunning) return 'bg-accent/5'
        return 'hover:bg-text-primary/[0.02] transition-colors rounded-lg'
    }, [isAwaitingApproval, isError, isStreaming, isRunning])

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className={`group my-0.5 relative ${cardStyle} overflow-hidden`}
        >
            {/* ToolCall Card Background Sweeping Effect */}
            {(isStreaming || isRunning) && (
                <div className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden">
                    <div className="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-accent/10 to-transparent animate-shimmer" />
                </div>
            )}
            {/* Header - Flat Outline Style */}
            <div
                className="flex items-center gap-2 px-2 py-1.5 cursor-pointer select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {/* Expand Toggle (Moved to far left) */}
                <motion.div
                    animate={{ rotate: isExpanded ? 90 : 0 }}
                    transition={{ duration: 0.15 }}
                    className="shrink-0 text-text-muted/40 hover:text-text-muted transition-colors"
                >
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
                    ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-text-muted/30" />
                    )}
                </div>

                {/* File Info */}
                <div className="flex-1 min-w-0 flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-2 truncate">
                        {filePath ? (
                            <div className="flex items-center gap-2">
                                <span
                                    className={`text-[12px] truncate transition-colors ${isStreaming || isRunning ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}
                                >
                                    {isNewFile ? 'Create ' : 'Update '}
                                </span>
                                <span
                                    className={`${isNewFile ? 'text-status-success' : 'text-text-primary'} ${isStreaming || isRunning ? 'text-shimmer text-[12px] font-medium' : 'font-medium text-[12px]'} hover:underline hover:text-accent cursor-pointer transition-colors break-all`}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        if (onOpenInEditor && newContent) {
                                            onOpenInEditor(filePath, oldContent, newContent)
                                        } else {
                                            let absPath = filePath
                                            const isAbsolute = /^([a-zA-Z]:[\\/]|[/])/.test(absPath)
                                            if (!isAbsolute && workspacePath) {
                                                absPath = joinPath(workspacePath, absPath)
                                            }

                                            api.file.read(absPath).then(content => {
                                                if (content !== null) {
                                                    const diffUri = `diff://${absPath}`
                                                    openFile(diffUri, newContent, oldContent)
                                                    setActiveFile(diffUri)
                                                } else {
                                                    toast.error(`Failed to open file: ${getFileName(absPath)}`)
                                                }
                                            }).catch(() => {
                                                toast.error(`Failed to open file: ${getFileName(absPath)}`)
                                            })
                                        }
                                    }}
                                    title={filePath}
                                >
                                    {getFileName(filePath)}
                                </span>
                            </div>
                        ) : (isStreaming || isRunning) ? (
                            <span className="font-medium text-[11px] italic text-shimmer">editing...</span>
                        ) : (
                            <span className="font-medium text-[11px] text-text-primary opacity-50">&lt;empty path&gt;</span>
                        )}
                        {(isStreaming || isRunning) && (
                            <span className="text-[11px] text-shimmer/80 italic ml-2">Processing...</span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {(isSuccess || newContent) && (
                            <motion.span
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="text-[10px] font-mono opacity-60 flex items-center gap-1.5 px-1.5 py-0.5 bg-text-primary/[0.05] rounded border border-border"
                            >
                                {diffStats.added > 0 && (
                                    <span className="text-green-400">+{diffStats.added}</span>
                                )}
                                {diffStats.removed > 0 && (
                                    <span className="text-red-400">-{diffStats.removed}</span>
                                )}
                                {isNewFile && diffStats.added === 0 && (
                                    <span className="text-blue-400">new</span>
                                )}
                            </motion.span>
                        )}
                        {isSuccess && onOpenInEditor && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onOpenInEditor(filePath, oldContent, newContent)
                                }}
                                className="p-1 text-text-muted hover:text-accent hover:bg-surface-hover rounded-md transition-colors opacity-0 group-hover:opacity-100"
                                title="Open in Editor"
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Expanded Content */}
            <AnimatePresence initial={false}>
                {isExpanded && newContent && (
                    <motion.div
                        layout
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                        className="overflow-hidden"
                    >
                        <div className="pl-[26px] pr-3 pb-3 pt-0 relative">
                            {/* Visual Threading Line */}
                            <div className="absolute left-[13.5px] top-0 bottom-4 w-[1.5px] bg-border/40 rounded-full" />

                            <div className="relative z-10 ms-1">
                                <div className="max-h-64 overflow-auto custom-scrollbar relative min-h-[60px] border-l-2 border-border/30 pl-2">
                                    {showContent || isRunning || isStreaming ? (
                                        <InlineDiffPreview
                                            oldContent={oldContent}
                                            newContent={newContent}
                                            filePath={filePath}
                                            isStreaming={isStreaming || isRunning}
                                            maxLines={50}
                                        />
                                    ) : (
                                        // 使用统一的代码骨架屏
                                        <div className="min-h-[160px] opacity-50 pt-2">
                                            <CodeSkeleton lines={5} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Error Message */}
            {toolCall.error && isExpanded && (
                <div className="px-3 pb-3 pl-9">
                    <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-md">
                        <p className="text-[11px] text-red-300 font-mono break-all">{toolCall.error}</p>
                    </div>
                </div>
            )}

            {/* Approval Actions */}
            {isAwaitingApproval && (
                <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-yellow-500/10 bg-yellow-500/5">
                    <button
                        onClick={onReject}
                        className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all active:scale-95"
                    >
                        Reject
                    </button>
                    <button
                        onClick={onApprove}
                        className="px-3 py-1.5 text-xs font-medium bg-accent text-white hover:bg-accent-hover rounded-md transition-all shadow-sm shadow-accent/20 active:scale-95 hover:shadow-accent/40"
                    >
                        Accept
                    </button>
                </div>
            )}
        </motion.div>
    )
}
