import React, { useState, useEffect } from 'react'
import { CheckCircle2, ChevronDown, Brain } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@store'

interface MemoryApprovalInlineProps {
    content: string
    isAwaitingApproval: boolean
    isSuccess?: boolean
    messageId: string
    toolCallId: string
    args: Record<string, any>
}

export const MemoryApprovalInline: React.FC<MemoryApprovalInlineProps> = ({
    content,
    isAwaitingApproval,
    isSuccess,
}) => {
    const [isExpanded, setIsExpanded] = useState(!isSuccess)
    const language = useStore(s => s.language)

    useEffect(() => {
        if (isSuccess) {
            setIsExpanded(false)
        }
    }, [isSuccess])

    const statusText = isSuccess
        ? (language === 'zh' ? '已存入项目记忆' : 'Project Memory Stored')
        : (language === 'zh' ? '记忆提议' : 'Memory Proposal')

    const isRunning = !isSuccess && !isAwaitingApproval

    return (
        <div className="group my-0.5 relative hover:bg-text-primary/[0.02] transition-colors rounded-lg overflow-hidden">
            {/* Header - 与 ToolCallCard 完全一致的扁平化结构 */}
            <div
                className="flex items-center gap-2 px-2 py-1.5 cursor-pointer select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {/* Expand Toggle */}
                <motion.div
                    animate={{ rotate: isExpanded ? 90 : 0 }}
                    transition={{ duration: 0.15 }}
                    className="shrink-0 text-text-muted/40 hover:text-text-muted"
                >
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                </motion.div>

                {/* Status Icon */}
                <div className="shrink-0 relative z-10 w-4 h-4 flex items-center justify-center">
                    {isRunning ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
                            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                        </div>
                    ) : isSuccess ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-green-500/10 flex items-center justify-center">
                            <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />
                        </div>
                    ) : (
                        <div className="w-3.5 h-3.5 rounded-full bg-purple-500/10 flex items-center justify-center">
                            <Brain className="w-2.5 h-2.5 text-purple-400" />
                        </div>
                    )}
                </div>

                {/* Status Text */}
                <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden relative z-10">
                    <span className={`text-[12px] truncate ${isRunning ? 'text-text-primary text-shimmer' : 'text-text-secondary group-hover:text-text-primary transition-colors'}`}>
                        {statusText}
                    </span>
                    {!isExpanded && (
                        <span className="text-[11px] text-text-muted/40 truncate">
                            — {content.slice(0, 50)}{content.length > 50 ? '...' : ''}
                        </span>
                    )}
                </div>
            </div>

            {/* Expanded Content */}
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

                            {/* Content */}
                            <div className="relative z-10 mt-1">
                                <div className="text-[11px] text-text-secondary/80 leading-relaxed font-sans whitespace-pre-wrap border-l-2 border-border/30 pl-2 ml-1">
                                    {content}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
