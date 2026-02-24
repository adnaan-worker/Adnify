/**
 * 工具调用组组件
 * 简化设计：聚焦当前，简化历史
 * 
 * - 正在执行的工具：独立显示，自动展开
 * - 已完成的工具：全部折叠到组中
 * - 用户可以展开折叠组查看历史
 */

import { useState, useMemo, useCallback } from 'react'
import { ChevronDown, Layers, CheckCircle2, XCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ToolCall } from '@/renderer/agent/types'
import ToolCallCard from './ToolCallCard'
import FileChangeCard from './FileChangeCard'
import { MemoryApprovalInline } from './MemoryApprovalInline'
import { needsDiffPreview } from '@/shared/config/tools'
import { useStore } from '@store'

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
    const [isExpanded, setIsExpanded] = useState(false)
    const { language } = useStore()

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

    return (
        <div className="my-2 space-y-2 animate-slide-in-right">
            {/* 1. 已完成的工具折叠组 */}
            {completedCalls.length > 0 && (
                <div className="rounded-xl border border-border bg-surface/20 overflow-hidden">
                    <div
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer select-none hover:bg-surface/30 transition-colors"
                        onClick={() => setIsExpanded(!isExpanded)}
                    >
                        <div className={`p-1.5 rounded-lg ${hasError ? 'bg-red-500/10 text-red-400' : 'bg-accent/10 text-accent'}`}>
                            <Layers className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                            <span className="text-xs font-medium text-text-secondary">
                                {language === 'zh'
                                    ? `${completedCalls.length} 个步骤已完成`
                                    : `${completedCalls.length} step${completedCalls.length > 1 ? 's' : ''} completed`}
                            </span>
                            {hasError ? (
                                <XCircle className="w-3.5 h-3.5 text-red-400" />
                            ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            )}
                        </div>
                        <motion.div
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            transition={{ duration: 0.15 }}
                            className="text-text-muted"
                        >
                            <ChevronDown className="w-4 h-4" />
                        </motion.div>
                    </div>

                    <AnimatePresence initial={false}>
                        {isExpanded && (
                            <motion.div
                                initial={{ height: 0 }}
                                animate={{ height: 'auto' }}
                                exit={{ height: 0 }}
                                transition={{ duration: 0.2, ease: 'easeInOut' }}
                                className="overflow-hidden"
                            >
                                <div className="border-t border-border p-2 space-y-2 bg-text-primary/[0.02]">
                                    {completedCalls.map(tc => renderToolCard(tc, { inFoldedGroup: true }))}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}

            {/* 2. 正在运行的工具（独立显示） */}
            {activeCalls.map(tc => renderToolCard(tc))}
        </div>
    )
}
