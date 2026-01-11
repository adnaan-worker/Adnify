/**
 * 交互式选项卡片组件
 * 用于 Plan 模式下 AI 引导用户选择
 */

import { useState, useCallback } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { motion } from 'framer-motion'
import type { InteractiveContent } from '@/renderer/agent/types'

interface OptionCardProps {
    content: InteractiveContent
    onSelect: (selectedIds: string[]) => void
    disabled?: boolean
}

// 图标映射
const ICON_MAP: Record<string, string> = {
    feature: '🚀',
    refactor: '🔧',
    bugfix: '🐛',
    docs: '📝',
    test: '🧪',
    custom: '⚙️',
    yes: '✅',
    no: '❌',
    google: '🔵',
    github: '⚫',
    wechat: '🟢',
    password: '🔑',
    oauth: '🔐',
}

export function OptionCard({ content, onSelect, disabled }: OptionCardProps) {
    const [selected, setSelected] = useState<Set<string>>(
        new Set(content.selectedIds || [])
    )
    const [submitted, setSubmitted] = useState(false)

    const handleToggle = useCallback((id: string) => {
        if (disabled || submitted) return

        setSelected(prev => {
            const next = new Set(prev)
            if (content.multiSelect) {
                if (next.has(id)) {
                    next.delete(id)
                } else {
                    next.add(id)
                }
            } else {
                // 单选：直接提交
                next.clear()
                next.add(id)
                setSubmitted(true)
                onSelect([id])
            }
            return next
        })
    }, [content.multiSelect, disabled, submitted, onSelect])

    const handleSubmit = useCallback(() => {
        if (selected.size === 0 || submitted) return
        setSubmitted(true)
        onSelect(Array.from(selected))
    }, [selected, submitted, onSelect])

    const getIcon = (option: { icon?: string; label: string }) => {
        if (option.icon) return option.icon
        const key = option.label.toLowerCase().replace(/\s+/g, '')
        return ICON_MAP[key] || '📌'
    }

    return (
        <div className="my-4 space-y-3">
            {/* 问题 */}
            <p className="text-sm text-text-primary font-medium">{content.question}</p>

            {/* 选项网格 */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {content.options.map((option, index) => {
                    const isSelected = selected.has(option.id)
                    const isDisabled = disabled || submitted

                    return (
                        <motion.button
                            key={option.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                            onClick={() => handleToggle(option.id)}
                            disabled={isDisabled}
                            className={`
                                relative flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left
                                transition-all duration-200 group
                                ${isSelected
                                    ? 'bg-accent/10 border-accent/40 text-accent'
                                    : 'bg-surface/30 border-border hover:border-accent/30 hover:bg-surface/50 text-text-primary'
                                }
                                ${isDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
                            `}
                        >
                            {/* 图标 */}
                            <span className="text-base flex-shrink-0">{getIcon(option)}</span>

                            {/* 文本 */}
                            <div className="flex-1 min-w-0">
                                <span className="text-xs font-medium block truncate">
                                    {option.label}
                                </span>
                                {option.description && (
                                    <span className="text-[10px] text-text-muted block truncate mt-0.5">
                                        {option.description}
                                    </span>
                                )}
                            </div>

                            {/* 选中标记 */}
                            {isSelected && (
                                <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                            )}
                        </motion.button>
                    )
                })}
            </div>

            {/* 多选确认按钮 */}
            {content.multiSelect && !submitted && selected.size > 0 && (
                <motion.button
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    onClick={handleSubmit}
                    className="flex items-center gap-2 px-4 py-2 bg-accent text-white text-xs font-medium rounded-lg hover:bg-accent-hover transition-colors"
                >
                    <span>确认选择 ({selected.size})</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                </motion.button>
            )}

            {/* 已提交状态 */}
            {submitted && (
                <p className="text-[10px] text-text-muted flex items-center gap-1">
                    <Check className="w-3 h-3 text-green-400" />
                    已选择
                </p>
            )}
        </div>
    )
}
