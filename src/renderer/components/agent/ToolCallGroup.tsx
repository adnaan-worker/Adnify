/**
 * 工具调用组组件
 * 用于合并显示连续的工具调用，减少刷屏
 * 
 * 升级版：高级卡片折叠设计
 */

import { useState, useMemo } from 'react'
import { ChevronDown, Layers, CheckCircle2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { ToolCall } from '@/renderer/agent/types'
import ToolCallCard from './ToolCallCard'
import FileChangeCard from './FileChangeCard'
import { isWriteTool } from '@/shared/config/tools'
import { useStore } from '@store'

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

    const { completedCalls, activeCalls } = useMemo(() => {
        const completed: ToolCall[] = []
        const active: ToolCall[] = []

        toolCalls.forEach(tc => {
            const isRunning = tc.status === 'running' || tc.status === 'pending'
            if (isRunning || tc.id === pendingToolId) {
                active.push(tc)
            } else {
                completed.push(tc)
            }
        })
        return { completedCalls: completed, activeCalls: active }
    }, [toolCalls, pendingToolId])

    const renderToolCard = (tc: ToolCall) => {
        const isFileOp = isWriteTool(tc.name)
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
    }

    return (
        <div className="my-2 space-y-2">
            {/* 1. 已完成的工具组 */}
            {completedCalls.length > 0 && (
                completedCalls.length === 1 ? (
                    renderToolCard(completedCalls[0])
                ) : (
                    <motion.div 
                        layout
                        className="rounded-2xl border border-border bg-surface/20 backdrop-blur-md overflow-hidden transition-all duration-300 hover:bg-surface/30 hover:shadow-md"
                    >
                        <div
                            className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                            onClick={() => setIsExpanded(!isExpanded)}
                        >
                            <div className="p-2 rounded-xl bg-accent/10 text-accent border border-accent/20">
                                <Layers className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                                <span className="text-xs font-bold text-text-primary tracking-tight">
                                    {language === 'zh'
                                        ? `已执行 ${completedCalls.length} 个步骤`
                                        : `Completed ${completedCalls.length} steps`}
                                </span>
                                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Success
                                </span>
                            </div>
                            <motion.div 
                                animate={{ rotate: isExpanded ? 180 : 0 }}
                                className="p-1 rounded-lg text-text-muted hover:bg-white/5 transition-colors"
                            >
                                <ChevronDown className="w-4 h-4" />
                            </motion.div>
                        </div>

                        <AnimatePresence initial={false}>
                            {isExpanded && (
                                <motion.div
                                    layout
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.25, ease: "easeInOut" }}
                                >
                                    <div className="border-t border-border p-3 space-y-3 bg-black/10">
                                        {completedCalls.map(renderToolCard)}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                )
            )}

            {/* 2. 正在运行的工具 */}
            <AnimatePresence>
                {activeCalls.length > 0 && (
                    <motion.div 
                        className="space-y-3"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                    >
                        {activeCalls.map(renderToolCard)}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}