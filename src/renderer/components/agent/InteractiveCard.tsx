/**
 * 交互式选项卡片组件
 * 用于 ask_user 工具引导用户选择
 * 
 * 设计风格：与 ToolCallCard 统一的扁平时间线结构
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
    Check,
    ChevronDown,
    CheckCircle2,
    ArrowRight,
    Send
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { InteractiveContent } from '@/renderer/agent/types'
import { useStore } from '@store'

interface InteractiveCardProps {
    content: InteractiveContent
    onSelect: (selectedIds: string[], customText?: string) => void
    disabled?: boolean
}

/** 检测是否是自定义/其他类型的选项 */
const isCustomOption = (option: { id: string; label: string }) => {
    const id = option.id.toLowerCase()
    const label = option.label.toLowerCase()
    return ['custom', 'other', '其他', '自定义'].some(k =>
        id.includes(k) || label.includes(k)
    )
}

export function InteractiveCard({ content, onSelect, disabled }: InteractiveCardProps) {
    const [selected, setSelected] = useState<Set<string>>(
        new Set(content.selectedIds || [])
    )
    const [isExpanded, setIsExpanded] = useState(!disabled)
    const [submitted, setSubmitted] = useState(!!content.selectedIds?.length)
    const [customText, setCustomText] = useState('')
    const [showCustomInput, setShowCustomInput] = useState(false)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const language = useStore(s => s.language)

    useEffect(() => {
        if (content.selectedIds?.length) {
            setSelected(new Set(content.selectedIds))
            setSubmitted(true)
            if (disabled) {
                setIsExpanded(false)
            }
        }
    }, [content.selectedIds, disabled])

    // 聚焦输入框
    useEffect(() => {
        if (showCustomInput && inputRef.current) {
            inputRef.current.focus()
        }
    }, [showCustomInput])

    const handleToggle = useCallback((id: string) => {
        if (disabled || submitted) return

        const option = content.options.find(o => o.id === id)
        const isCustom = option && isCustomOption(option)

        setSelected(prev => {
            const next = new Set(prev)
            if (content.multiSelect) {
                if (next.has(id)) {
                    next.delete(id)
                    if (isCustom) setShowCustomInput(false)
                } else {
                    next.add(id)
                    if (isCustom) setShowCustomInput(true)
                }
            } else {
                next.clear()
                next.add(id)
                // 自定义选项：显示输入框，不立即提交
                if (isCustom) {
                    setShowCustomInput(true)
                    return next
                }
                setShowCustomInput(false)
            }
            return next
        })

        // 单选 + 非自定义：立即提交
        if (!content.multiSelect && !(option && isCustomOption(option))) {
            setTimeout(() => {
                setSubmitted(true)
                onSelect([id])
                setIsExpanded(false)
            }, 300)
        }
    }, [content.multiSelect, content.options, disabled, submitted, onSelect])

    const handleSubmit = useCallback(() => {
        if (selected.size === 0 || submitted) return

        // 检查是否有自定义选项并携带文本
        const selectedArr = Array.from(selected)
        const hasCustom = selectedArr.some(id => {
            const opt = content.options.find(o => o.id === id)
            return opt && isCustomOption(opt)
        })

        setSubmitted(true)
        onSelect(selectedArr, hasCustom && customText.trim() ? customText.trim() : undefined)
        setIsExpanded(false)
    }, [selected, submitted, onSelect, customText, content.options])

    const handleCustomSubmit = useCallback(() => {
        if (!customText.trim() || submitted) return
        setSubmitted(true)
        onSelect(Array.from(selected), customText.trim())
        setIsExpanded(false)
    }, [customText, submitted, selected, onSelect])

    const isMulti = content.multiSelect

    // 已选择的选项标签
    const selectedLabels = content.options
        .filter(o => selected.has(o.id))
        .map(o => o.label)
        .join(', ')

    return (
        <div className={`group my-0.5 relative rounded-lg overflow-hidden transition-colors ${submitted
                ? 'hover:bg-text-primary/[0.02]'
                : 'bg-amber-500/5 border border-amber-500/15'
            }`}>
            {/* Header */}
            <div
                className="flex items-center gap-2 px-2 py-1.5 cursor-pointer select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <motion.div
                    animate={{ rotate: isExpanded ? 90 : 0 }}
                    transition={{ duration: 0.15 }}
                    className="shrink-0 text-text-muted/40 hover:text-text-muted"
                >
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                </motion.div>

                <div className="shrink-0 relative z-10 w-4 h-4 flex items-center justify-center">
                    {submitted ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-green-500/10 flex items-center justify-center">
                            <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />
                        </div>
                    ) : (
                        <div className="w-3.5 h-3.5 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        </div>
                    )}
                </div>

                <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden relative z-10">
                    <span className={`text-[12px] truncate ${submitted
                            ? 'text-text-secondary group-hover:text-text-primary transition-colors'
                            : 'text-text-primary'
                        }`}>
                        {content.question}
                    </span>
                    {!isExpanded && submitted && (
                        <span className="text-[11px] text-text-muted/40 truncate">
                            — {selectedLabels}
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
                        <div className="pl-[26px] pr-3 pb-2 pt-0 relative border-t-0">
                            <div className="absolute left-[13.5px] top-0 bottom-2 w-[1.5px] bg-border/40 rounded-full" />

                            {/* Options */}
                            <div className="relative z-10 mt-1 space-y-0.5">
                                {content.options.map((option, index) => {
                                    const isSelected = selected.has(option.id)
                                    const isDisabled = disabled || submitted

                                    return (
                                        <motion.button
                                            key={option.id}
                                            initial={{ opacity: 0, x: -8 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: index * 0.03 }}
                                            onClick={() => handleToggle(option.id)}
                                            disabled={isDisabled}
                                            className={`
                                                w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left
                                                transition-all duration-150
                                                ${isSelected
                                                    ? 'bg-accent/10 text-text-primary'
                                                    : 'hover:bg-surface-hover/50 text-text-secondary'
                                                }
                                                ${isDisabled ? 'opacity-50 cursor-default' : 'cursor-pointer'}
                                            `}
                                        >
                                            <div className={`
                                                w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-all
                                                ${isSelected
                                                    ? 'bg-accent border-accent'
                                                    : 'border-text-muted/30 group-hover:border-accent/50'
                                                }
                                            `}>
                                                {isSelected && <Check className="w-2 h-2 text-white" strokeWidth={3} />}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <span className={`text-[12px] font-medium block truncate ${isSelected ? 'text-text-primary' : ''}`}>
                                                    {option.label}
                                                </span>
                                                {option.description && (
                                                    <span className="text-[10px] text-text-muted block truncate mt-0.5">
                                                        {option.description}
                                                    </span>
                                                )}
                                            </div>
                                        </motion.button>
                                    )
                                })}
                            </div>

                            {/* Custom Text Input */}
                            <AnimatePresence>
                                {showCustomInput && !submitted && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="relative z-10 mt-2"
                                    >
                                        <div className="relative">
                                            <textarea
                                                ref={inputRef}
                                                value={customText}
                                                onChange={e => setCustomText(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault()
                                                        handleCustomSubmit()
                                                    }
                                                }}
                                                placeholder={language === 'zh' ? '请输入自定义内容...' : 'Type your custom response...'}
                                                rows={2}
                                                className="w-full px-3 py-2 pr-10 text-[12px] text-text-primary bg-surface/60 border border-border/50 rounded-lg resize-none focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 placeholder:text-text-muted/40 transition-all custom-scrollbar"
                                            />
                                            <button
                                                onClick={handleCustomSubmit}
                                                disabled={!customText.trim()}
                                                className={`absolute right-2 bottom-2 p-1 rounded-md transition-all ${customText.trim()
                                                        ? 'text-accent hover:bg-accent/10 active:scale-90'
                                                        : 'text-text-muted/30 cursor-not-allowed'
                                                    }`}
                                                title={language === 'zh' ? '发送' : 'Send'}
                                            >
                                                <Send className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Multi-select Confirm */}
                            {isMulti && !submitted && !showCustomInput && (
                                <div className="mt-2 flex justify-end relative z-10">
                                    <button
                                        onClick={handleSubmit}
                                        disabled={selected.size === 0}
                                        className={`
                                            flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium rounded-md transition-all
                                            ${selected.size > 0
                                                ? 'bg-accent text-white hover:bg-accent-hover active:scale-95'
                                                : 'bg-surface/50 text-text-muted cursor-not-allowed'
                                            }
                                        `}
                                    >
                                        <span>{language === 'zh' ? `确认 (${selected.size})` : `Confirm (${selected.size})`}</span>
                                        <ArrowRight className="w-3 h-3" />
                                    </button>
                                </div>
                            )}

                            {/* Multi-select with custom: show submit that includes custom text */}
                            {isMulti && !submitted && showCustomInput && (
                                <div className="mt-2 flex justify-end relative z-10">
                                    <button
                                        onClick={handleSubmit}
                                        disabled={selected.size === 0}
                                        className={`
                                            flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium rounded-md transition-all
                                            ${selected.size > 0
                                                ? 'bg-accent text-white hover:bg-accent-hover active:scale-95'
                                                : 'bg-surface/50 text-text-muted cursor-not-allowed'
                                            }
                                        `}
                                    >
                                        <span>{language === 'zh' ? `确认 (${selected.size})` : `Confirm (${selected.size})`}</span>
                                        <ArrowRight className="w-3 h-3" />
                                    </button>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
