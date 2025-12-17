/**
 * 工具调用组组件
 * 用于合并显示连续的工具调用，减少刷屏
 */

import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, Layers, Check, Loader2, AlertTriangle } from 'lucide-react'
import { ToolCall } from '../../agent/core/types'
import ToolCallCard from './ToolCallCard'
import FileChangeCard from './FileChangeCard'
import { WRITE_TOOLS } from '../../agent/core/ToolExecutor'
import { useStore } from '../../store'

interface ToolCallGroupProps {
    toolCalls: ToolCall[]
    pendingToolId?: string
    onApproveTool?: () => void
    onRejectTool?: () => void
    onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
}

export default function ToolCallGroup({
    toolCalls,
    pendingToolId,
    onApproveTool,
    onRejectTool,
    onOpenDiff,
}: ToolCallGroupProps) {
    const [isExpanded, setIsExpanded] = useState(false)
    const { language } = useStore()

    // 统计状态
    const stats = useMemo(() => {
        let running = 0
        let success = 0
        let error = 0
        let pending = 0

        toolCalls.forEach(tc => {
            if (tc.status === 'running') running++
            else if (tc.status === 'success') success++
            else if (tc.status === 'error') error++
            else if (tc.status === 'pending') pending++
        })

        return { running, success, error, pending }
    }, [toolCalls])

    // 获取组标题
    const title = useMemo(() => {
        const count = toolCalls.length
        const firstTool = toolCalls[0]
        const isFileOp = WRITE_TOOLS.includes(firstTool.name)

        if (isFileOp) {
            // 计算涉及的唯一文件数
            const uniqueFiles = new Set(toolCalls.map(tc => {
                const args = tc.arguments as Record<string, unknown>
                const meta = args._meta as Record<string, unknown> | undefined
                return (args.path || meta?.filePath) as string
            }).filter(Boolean)).size

            if (language === 'zh') {
                return uniqueFiles === count
                    ? `执行了 ${count} 个文件操作`
                    : `对 ${uniqueFiles} 个文件执行了 ${count} 次操作`
            } else {
                return uniqueFiles === count
                    ? `Executed ${count} file operations`
                    : `Executed ${count} operations on ${uniqueFiles} files`
            }
        }

        return language === 'zh'
            ? `执行了 ${count} 个工具调用`
            : `Executed ${count} tool calls`
    }, [toolCalls, language])

    // 总体状态指示
    const StatusIcon = () => {
        if (stats.running > 0 || stats.pending > 0) {
            return <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
        }
        if (stats.error > 0) {
            return <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
        }
        return <Check className="w-3.5 h-3.5 text-green-400" />
    }

    return (
        <div className="my-2 rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
            {/* Group Header */}
            <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/[0.04] transition-colors select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="p-1 rounded bg-white/5 text-text-muted">
                    <Layers className="w-3.5 h-3.5" />
                </div>

                <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-xs font-medium text-text-secondary">
                        {title}
                    </span>
                    <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded-full bg-white/5 border border-white/5">
                        {toolCalls.length}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <StatusIcon />
                    {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                    ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                    )}
                </div>
            </div>

            {/* Group Content */}
            {isExpanded && (
                <div className="border-t border-white/5 p-2 space-y-1 bg-black/10">
                    {toolCalls.map((tc) => {
                        const isFileOp = WRITE_TOOLS.includes(tc.name)
                        const isPending = tc.id === pendingToolId

                        if (isFileOp) {
                            return (
                                <FileChangeCard
                                    key={tc.id}
                                    toolCall={tc}
                                    isAwaitingApproval={isPending}
                                    onApprove={isPending ? onApproveTool : undefined}
                                    onReject={isPending ? onRejectTool : undefined}
                                    onOpenInEditor={onOpenDiff}
                                />
                            )
                        }

                        return (
                            <ToolCallCard
                                key={tc.id}
                                toolCall={tc}
                                isAwaitingApproval={isPending}
                                onApprove={isPending ? onApproveTool : undefined}
                                onReject={isPending ? onRejectTool : undefined}
                            />
                        )
                    })}
                </div>
            )}
        </div>
    )
}
