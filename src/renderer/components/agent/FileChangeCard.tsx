/**
 * 文件变更卡片 - 带 Diff 预览的设计
 * 显示删除/新增行的 unified diff 视图，支持语法高亮
 */

import { useState, useEffect, useMemo } from 'react'
import { Check, X, ChevronDown, ChevronRight, ExternalLink, Loader2, FileCode } from 'lucide-react'
import { ToolCall } from '../../agent/core/types'
import InlineDiffPreview, { getDiffStats } from './InlineDiffPreview'

interface FileChangeCardProps {
    toolCall: ToolCall
    isAwaitingApproval?: boolean
    onApprove?: () => void
    onReject?: () => void
    onOpenInEditor?: (path: string, oldContent: string, newContent: string) => void
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
    const filePath = (args.path || meta?.filePath) as string || 'unknown'
    const fileName = filePath.split(/[\\/]/).pop() || filePath

    const isStreaming = args._streaming === true
    const isRunning = toolCall.status === 'running' || toolCall.status === 'pending'
    const isSuccess = toolCall.status === 'success'
    const isError = toolCall.status === 'error'

    // 获取新旧内容用于 diff
    const oldContent = useMemo(() => {
        // 在流式传输或运行阶段，如果工具是局部编辑类（非全量覆盖），
        // 且还没有 meta 结果（即工具未完成），暂时忽略旧内容，
        // 避免将 patch 片段与完整旧文件对比导致显示大面积删除。
        // 这样预览会显示为纯新增（绿色），更符合 patch 的直观感受。
        if ((isRunning || isStreaming) && !meta?.oldContent) {
            const isPartialEdit = ['edit_file', 'replace_file_content'].includes(toolCall.name)
            if (isPartialEdit) return ''
        }
        return (meta?.oldContent as string) || ''
    }, [meta, isRunning, isStreaming, toolCall.name])

    const newContent = useMemo(() => {
        if (meta?.newContent) return meta.newContent as string
        // Fallback: 从 args 中获取
        return (args.content || args.code || args.search_replace_blocks || args.replacement || args.source) as string || ''
    }, [args, meta])

    // 计算行数变化
    const diffStats = useMemo(() => {
        if (!newContent) return { added: 0, removed: 0 }
        try {
            return getDiffStats(oldContent, newContent)
        } catch {
            return { added: 0, removed: 0 }
        }
    }, [oldContent, newContent])

    // 自动展开 logic
    useEffect(() => {
        if (isRunning || isStreaming) {
            setIsExpanded(true)
        }
    }, [isRunning, isStreaming])

    // 判断是否是新建文件
    const isNewFile = !oldContent && !!newContent

    return (
        <div className={`
            group my-1.5 rounded-lg border transition-all duration-200
            ${isAwaitingApproval
                ? 'border-yellow-500/30 bg-yellow-500/5'
                : isError
                    ? 'border-red-500/20 bg-red-500/5'
                    : 'border-white/5 bg-transparent hover:border-white/10'
            }
        `}>
            {/* Header */}
            <div
                className="flex items-center gap-3 px-3 py-2 cursor-pointer select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {/* Status Icon */}
                <div className="shrink-0">
                    {isStreaming || isRunning ? (
                        <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
                    ) : isSuccess ? (
                        <Check className="w-3.5 h-3.5 text-green-400" />
                    ) : isError ? (
                        <X className="w-3.5 h-3.5 text-red-400" />
                    ) : (
                        <FileCode className="w-3.5 h-3.5 text-text-muted" />
                    )}
                </div>

                {/* Title & Stats */}
                <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
                    <span className="text-xs font-medium text-text-secondary group-hover:text-text-primary transition-colors truncate">
                        {fileName}
                    </span>

                    {(isSuccess || newContent) && (
                        <span className="text-[10px] font-mono opacity-60 flex items-center gap-1.5 px-1.5 py-0.5 bg-white/5 rounded">
                            {diffStats.added > 0 && (
                                <span className="text-green-400">+{diffStats.added}</span>
                            )}
                            {diffStats.removed > 0 && (
                                <span className="text-red-400">-{diffStats.removed}</span>
                            )}
                            {isNewFile && diffStats.added === 0 && (
                                <span className="text-blue-400">new</span>
                            )}
                        </span>
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
                            className="p-1 text-text-muted hover:text-accent hover:bg-white/10 rounded transition-colors"
                            title="Open in Editor"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <div className="text-text-muted/50 group-hover:text-text-muted transition-colors">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </div>
                </div>
            </div>

            {/* Expanded Content */}
            {isExpanded && newContent && (
                <div className="px-3 pb-3 pt-0 animate-slide-down">
                    <div className="pl-6.5">
                        <div className="rounded-md border border-white/5 bg-black/20 overflow-hidden">
                            <div className="max-h-64 overflow-auto custom-scrollbar">
                                <InlineDiffPreview
                                    oldContent={oldContent}
                                    newContent={newContent}
                                    filePath={filePath}
                                    isStreaming={isStreaming || isRunning}
                                    maxLines={50}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
                        className="px-3 py-1 text-[11px] font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                    >
                        Reject
                    </button>
                    <button
                        onClick={onApprove}
                        className="px-3 py-1 text-[11px] font-medium bg-accent text-white hover:bg-accent-hover rounded transition-colors shadow-sm shadow-accent/20"
                    >
                        Accept
                    </button>
                </div>
            )}
        </div>
    )
}
