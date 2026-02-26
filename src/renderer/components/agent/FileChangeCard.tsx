/**
 * 文件变更卡片 - 带 Diff 预览的设计
 * 显示删除/新增行的 unified diff 视图，支持语法高亮
 * 
 * 增强功能：
 * - 实时流式 Diff 更新（订阅 streamingEditService）
 * - 与多文件 Diff 面板联动
 */

import { useState, useEffect, useMemo } from 'react'
import { Check, X, ChevronDown, ExternalLink, FileCode } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ToolCall } from '@renderer/agent/types'
import { streamingEditService } from '@renderer/agent/services/streamingEditService'
import InlineDiffPreview, { getDiffStats } from './InlineDiffPreview'
import { getFileName } from '@shared/utils/pathUtils'
import { CodeSkeleton } from '../ui/Loading'

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

    const args = toolCall.arguments as Record<string, unknown>
    const meta = args._meta as Record<string, unknown> | undefined
    const filePath = (args.path || meta?.filePath) as string || ''
    const isStreaming = args._streaming === true
    const isRunning = toolCall.status === 'running' || toolCall.status === 'pending'
    const isSuccess = toolCall.status === 'success'
    const isError = toolCall.status === 'error'

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

        // 在流式传输或运行阶段，如果工具是局部编辑类（非全量覆盖），
        // 且还没有 meta 结果（即工具未完成），暂时忽略旧内容，
        // 避免将 patch 片段与完整旧文件对比导致显示大面积删除。
        // 这样预览会显示为纯新增（绿色），更符合 patch 的直观感受。
        if ((isRunning || isStreaming) && !meta?.oldContent) {
            const isPartialEdit = ['edit_file', 'replace_file_content'].includes(toolCall.name)
            if (isPartialEdit) return ''
        }

        return ''
    }, [meta, isRunning, isStreaming, toolCall.name])

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

    // 获取动态状态文案（例如：Creating xxx...）
    const actionText = useMemo(() => {
        if (!filePath) return ''
        const name = getFileName(filePath)

        // 如果工具名明确是编辑类，强制使用 Editing
        const isEditingTool = ['edit_file', 'replace_file_content', 'write_file'].includes(toolCall.name)
        const isCreating = !isEditingTool && (['create_file', 'create_file_or_folder'].includes(toolCall.name) || isNewFile)

        const action = isCreating ? 'Creating' : 'Editing'
        const actionPast = isCreating ? 'Created' : 'Updated'

        if (isRunning || isStreaming) return `${action} ${name}...`
        if (isSuccess) return `${actionPast} ${name}`
        if (isError) return `Failed to ${action.toLowerCase()} ${name}`
        return `${action} ${name}`
    }, [filePath, isRunning, isStreaming, isSuccess, isError, toolCall.name, isNewFile])

    // 计算卡片样式
    const cardStyle = useMemo(() => {
        if (isAwaitingApproval) return 'border-status-warning/30 bg-status-warning/5 shadow-[0_0_15px_-3px_rgba(var(--status-warning),0.1)]'
        if (isError) return 'border-status-error/20 bg-status-error/5 shadow-[0_0_15px_-3px_rgba(var(--status-error),0.1)]'
        if (isStreaming || isRunning) return 'border-accent/50 bg-accent/5 shadow-[0_0_15px_-3px_rgba(var(--accent),0.15)] outline outline-1 outline-offset-1 outline-accent/20 animate-pulse-subtle'
        return 'border-border bg-surface/30 backdrop-blur-sm hover:bg-surface/50 hover:border-border hover:shadow-lg hover:shadow-black/20'
    }, [isAwaitingApproval, isError, isStreaming, isRunning])

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className={`
                group my-2 rounded-xl border transition-colors duration-300 overflow-hidden relative
                ${cardStyle}
            `}
        >
            {/* ToolCall Card Background Sweeping Effect */}
            {(isStreaming || isRunning) && (
                <div className="absolute inset-0 pointer-events-none rounded-xl overflow-hidden">
                    <div className="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-accent/20 to-transparent animate-shimmer" />
                </div>
            )}
            {/* Header */}
            <div
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none relative"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {/* Active Indicator Line */}
                {(isStreaming || isRunning) && (
                    <motion.div
                        layoutId="active-indicator-file"
                        className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent"
                    />
                )}

                {/* Status Icon */}
                <div className="shrink-0 relative z-10">
                    {isStreaming || isRunning ? (
                        <div className="w-5 h-5 rounded-full bg-accent/10 flex items-center justify-center border border-accent/20">
                            <FileCode className="w-3 h-3 text-accent" />
                        </div>
                    ) : isSuccess ? (
                        <div className="w-5 h-5 rounded-full bg-green-500/10 flex items-center justify-center border border-green-500/20">
                            <Check className="w-3 h-3 text-green-400" />
                        </div>
                    ) : isError ? (
                        <div className="w-5 h-5 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
                            <X className="w-3 h-3 text-red-400" />
                        </div>
                    ) : (
                        <div className="w-5 h-5 rounded-full bg-text-primary/[0.05] flex items-center justify-center border border-border">
                            <FileCode className="w-3 h-3 text-text-muted" />
                        </div>
                    )}
                </div>

                {/* File Info */}
                <div className="flex-1 min-w-0 flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-2 truncate">
                        {filePath ? (
                            <span className={`${isNewFile ? 'text-status-success' : 'text-text-primary'} ${isStreaming || isRunning ? 'text-shimmer text-sm font-medium' : 'font-medium text-sm'}`}>
                                {actionText}
                            </span>
                        ) : (isStreaming || isRunning) ? (
                            <span className="font-medium text-sm italic text-shimmer">editing...</span>
                        ) : (
                            <span className="font-medium text-sm text-text-primary opacity-50">&lt;empty path&gt;</span>
                        )}
                    </div>

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
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                    {isSuccess && onOpenInEditor && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                onOpenInEditor(filePath, oldContent, newContent)
                            }}
                            className="p-1.5 text-text-muted hover:text-accent hover:bg-surface-hover rounded-md transition-colors"
                            title="Open in Editor"
                        >
                            <ExternalLink className="w-4 h-4" />
                        </button>
                    )}
                    <motion.div
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="text-text-muted/50 group-hover:text-text-muted transition-colors"
                    >
                        <ChevronDown className="w-4 h-4" />
                    </motion.div>
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
                        <div className="px-3 pb-3 pt-0">
                            <div>
                                <div className="rounded-lg border border-border bg-surface/50 overflow-hidden shadow-inner">
                                    <div className="max-h-64 overflow-auto custom-scrollbar relative min-h-[60px]">
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
                                            <div className="min-h-[160px] opacity-50">
                                                <CodeSkeleton lines={5} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Error Message */}
            {toolCall.error && isExpanded && (
                <div className="px-3 pb-3 pl-9.5">
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
