/**
 * File change card with diff preview.
 * UI is unchanged; data flow is optimized for streaming updates.
 */

import { useState, useEffect, useMemo, memo } from 'react'
import { Check, X, ChevronDown, ExternalLink } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ToolCall } from '@renderer/agent/types'
import { useToolDisplayState } from '@renderer/agent/presentation/toolDisplay'
import { streamingEditService } from '@renderer/agent/services/streamingEditService'
import InlineDiffPreview, { getApproxLineDeltaStats, getDiffStats } from './InlineDiffPreview'
import { getFileName, joinPath } from '@shared/utils/pathUtils'
import { CodeSkeleton } from '../ui/Loading'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
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

function FileChangeCard({
    toolCall,
    isAwaitingApproval,
    onApprove,
    onReject,
    onOpenInEditor,
}: FileChangeCardProps) {
    const [isExpanded, setIsExpanded] = useState(false)
    const { openFile, setActiveFile, workspacePath } = useStore(useShallow(s => ({ openFile: s.openFile, setActiveFile: s.setActiveFile, workspacePath: s.workspacePath })))
    const { args, isSuccess, isError, isRunning, isStreaming } = useToolDisplayState(toolCall)

    const meta = args._meta as Record<string, unknown> | undefined
    const filePath = (args.path || meta?.filePath) as string || ''

    // Local streamed content used by the diff preview.
    const [streamingContent, setStreamingContent] = useState<string | null>(null)

    // Subscribe only to this file path instead of all active edits.
    useEffect(() => {
        if (!isRunning && !isStreaming) {
            setStreamingContent(null)
            return
        }

        const editState = streamingEditService.getEditByFilePath(filePath)
        if (editState) {
            setStreamingContent(editState.currentContent)
        }

        const unsubscribe = streamingEditService.subscribeByFilePath(filePath, state => {
            setStreamingContent(state?.currentContent ?? null)
        })

        return unsubscribe
    }, [filePath, isRunning, isStreaming])

    // Build old content for diffing.
    const oldContent = useMemo(() => {
        if (meta?.oldContent !== undefined) {
            return meta.oldContent as string
        }

        // For streamed edits, old_string is the best local base.
        if ((isRunning || isStreaming) && args.old_string) {
            return args.old_string as string
        }

        // Hide unrelated old-content noise while partial edits are still streaming.
        if ((isRunning || isStreaming) && !meta?.oldContent && !args.old_string) {
            const isPartialEdit = toolCall.name === 'edit_file'
            if (isPartialEdit) return ''
        }

        return ''
    }, [meta, args.old_string, isRunning, isStreaming, toolCall.name])

    const newContent = useMemo(() => {
        // Prefer live streamed content while the tool is active.
        if (streamingContent && (isRunning || isStreaming)) {
            return streamingContent
        }
        if (meta?.newContent) return meta.newContent as string
        return (args.content || args.code || args.new_string || args.replacement || args.source) as string || ''
    }, [args, meta, streamingContent, isRunning, isStreaming])

    const diffStats = useMemo(() => {
        // Prefer precise stats returned by the tool when available.
        if (meta?.linesAdded !== undefined || meta?.linesRemoved !== undefined) {
            return {
                added: (meta.linesAdded as number) || 0,
                removed: (meta.linesRemoved as number) || 0
            }
        }
        if (!newContent) return { added: 0, removed: 0 }
        if (isRunning || isStreaming) {
            return getApproxLineDeltaStats(oldContent, newContent)
        }
        try {
            return getDiffStats(oldContent, newContent)
        } catch {
            return { added: 0, removed: 0 }
        }
    }, [oldContent, newContent, meta, isRunning, isStreaming])

    // Auto-expand while the tool is active.
    useEffect(() => {
        if (isRunning || isStreaming) {
            setIsExpanded(true)
        }
    }, [isRunning, isStreaming])

    const isNewFile = ['create_file', 'create_file_or_folder'].includes(toolCall.name) ||
        (!oldContent && !!newContent && !['edit_file', 'replace_file_content', 'write_file'].includes(toolCall.name))



    // Card style only; visual design remains unchanged.
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
                                    {isExpanded ? (
                                        <InlineDiffPreview
                                            oldContent={oldContent}
                                            newContent={newContent}
                                            filePath={filePath}
                                            isStreaming={isStreaming || isRunning}
                                            maxLines={50}
                                        />
                                    ) : (
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

export default memo(FileChangeCard)


