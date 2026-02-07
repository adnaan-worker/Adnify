/**
 * 交互式选项卡片组件
 * 用于 ask_user 工具引导用户选择
 */

import { useState, useCallback, useEffect } from 'react'
import {
    Check,
    ChevronDown,
    CheckCircle2,
    ListTodo,
    ArrowRight
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { InteractiveContent } from '@/renderer/agent/types'

interface InteractiveCardProps {
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

export function InteractiveCard({ content, onSelect, disabled }: InteractiveCardProps) {
    const [selected, setSelected] = useState<Set<string>>(
        new Set(content.selectedIds || [])
    )
    // 默认展开，除非已被禁用（已提交）
    const [isExpanded, setIsExpanded] = useState(!disabled)
    const [submitted, setSubmitted] = useState(!!content.selectedIds?.length)

    // 同步外部状态
    useEffect(() => {
        if (content.selectedIds?.length) {
            setSelected(new Set(content.selectedIds))
            setSubmitted(true)
            // 如果已提交且不是刚提交（即初始化时就是提交状态），则默认折叠
            if (disabled) {
                setIsExpanded(false)
            }
        }
    }, [content.selectedIds, disabled])

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
                // 提交逻辑在下面处理
            }
            return next
        })

        // 单选立即触发
        if (!content.multiSelect) {
            // 使用 setTimeout 让 UI 先更新选中状态，给用户反馈
            setTimeout(() => {
                setSubmitted(true)
                onSelect([id])
                setIsExpanded(false)
            }, 300)
        }
    }, [content.multiSelect, disabled, submitted, onSelect])

    const handleSubmit = useCallback(() => {
        if (selected.size === 0 || submitted) return
        setSubmitted(true)
        onSelect(Array.from(selected))
        setIsExpanded(false)
    }, [selected, submitted, onSelect])

    const getIcon = (option: { icon?: string; label: string }) => {
        if (option.icon) return option.icon
        const key = option.label.toLowerCase().replace(/\s+/g, '')
        return ICON_MAP[key]
    }

    const isMulti = content.multiSelect

    return (
        <div className={`
            my-4 rounded-xl overflow-hidden transition-all duration-300 border
            ${submitted
                ? 'bg-surface/30 border-border/40'
                : 'bg-surface/60 border-accent/20 shadow-lg shadow-accent/5 ring-1 ring-accent/10'
            }
        `}>
            {/* Header */}
            <div
                className={`
                    flex items-center justify-between px-4 py-3 cursor-pointer 
                    hover:bg-surface/50 transition-colors select-none
                    ${isExpanded ? 'border-b border-border/40' : ''}
                `}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className={`
                        w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors
                        ${submitted ? 'bg-surface/80 text-text-muted' : 'bg-accent/10 text-accent'}
                     `}>
                        {submitted ? <CheckCircle2 className="w-4 h-4" /> : <ListTodo className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                        <h3 className={`text-sm font-medium truncate ${submitted ? 'text-text-secondary' : 'text-text-primary'}`}>
                            {content.question}
                        </h3>
                        {submitted && (
                            <p className="text-[10px] text-text-muted mt-0.5 truncate">
                                已选择: {content.options.filter(o => selected.has(o.id)).map(o => o.label).join(', ')}
                            </p>
                        )}
                    </div>
                </div>
                <motion.div
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    className="text-text-muted/60 shrink-0 ml-2"
                >
                    <ChevronDown className="w-4 h-4" />
                </motion.div>
            </div>

            {/* List Content */}
            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="p-2 space-y-1 bg-surface/20">
                            {content.options.map((option, index) => {
                                const isSelected = selected.has(option.id)
                                const isDisabled = disabled || submitted
                                const icon = getIcon(option)

                                return (
                                    <motion.button
                                        key={option.id}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: index * 0.03 }}
                                        onClick={() => handleToggle(option.id)}
                                        disabled={isDisabled}
                                        className={`
                                            w-full relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                                            transition-all duration-200 group border
                                            ${isSelected
                                                ? 'bg-accent/10 border-accent/30 text-text-primary'
                                                : 'bg-transparent border-transparent hover:bg-surface/60 hover:border-border/50 text-text-secondary'
                                            }
                                            ${isDisabled ? 'opacity-60 cursor-default' : 'cursor-pointer'}
                                        `}
                                    >
                                        {/* Checkbox/Radio Indicator */}
                                        <div className={`
                                            w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all
                                            ${isSelected
                                                ? 'bg-accent border-accent scale-110'
                                                : 'border-text-muted/40 group-hover:border-accent/50 bg-transparent'
                                            }
                                        `}>
                                            {isSelected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                                        </div>

                                        {/* Icon (if exists) */}
                                        {icon && (
                                            <span className="text-base shrink-0 opacity-80">{icon}</span>
                                        )}

                                        {/* Text Info */}
                                        <div className="flex-1 min-w-0">
                                            <span className={`text-sm font-medium block truncate ${isSelected ? 'text-text-primary' : ''}`}>
                                                {option.label}
                                            </span>
                                            {option.description && (
                                                <span className="text-xs text-text-muted block truncate mt-0.5 opacity-80 font-normal">
                                                    {option.description}
                                                </span>
                                            )}
                                        </div>
                                    </motion.button>
                                )
                            })}
                        </div>

                        {/* Multi-select Confirm Button */}
                        {isMulti && !submitted && (
                            <div className="p-3 border-t border-border/40 flex justify-end bg-surface/30">
                                <button
                                    onClick={handleSubmit}
                                    disabled={selected.size === 0}
                                    className={`
                                        flex items-center gap-2 px-4 py-1.5 text-xs font-medium rounded-lg transition-all
                                        ${selected.size > 0
                                            ? 'bg-accent text-white shadow-md shadow-accent/20 hover:bg-accent-hover hover:scale-105 active:scale-95'
                                            : 'bg-surface/50 text-text-muted cursor-not-allowed'
                                        }
                                    `}
                                >
                                    <span>确认选择 ({selected.size})</span>
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
