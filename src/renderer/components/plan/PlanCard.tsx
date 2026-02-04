/**
 * PlanCard - 单个计划卡片
 * 
 * 可拖拽的卡片组件，显示计划信息和智能体配置
 */

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Bot, MessageSquare, Clock, Trash2 } from 'lucide-react'
import { useStore } from '@store'
import type { PlanCard as PlanCardType } from '@renderer/store/slices/planSlice'
import { motion } from 'framer-motion'

interface PlanCardProps {
    card: PlanCardType
    onClick?: () => void
    isDragging?: boolean
}

export function PlanCard({ card, onClick, isDragging }: PlanCardProps) {
    const { deletePlanCard, selectedCardId, language } = useStore()
    const isSelected = selectedCardId === card.id

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id: card.id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation()
        deletePlanCard(card.id)
    }

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp)
        return date.toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', {
            month: 'short',
            day: 'numeric',
        })
    }

    return (
        <motion.div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            onClick={onClick}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`
                group relative p-4 rounded-lg bg-surface border cursor-pointer
                transition-all duration-200
                ${isSelected
                    ? 'border-accent shadow-[0_0_0_2px_rgba(var(--accent)/0.3)]'
                    : 'border-border hover:border-border-active'}
                ${isDragging ? 'shadow-2xl' : 'shadow-sm'}
            `}
        >
            {/* Header */}
            <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-sm font-medium text-text-primary line-clamp-2">
                    {card.name}
                </h3>
                <button
                    onClick={handleDelete}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-all"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Description */}
            {card.description && (
                <p className="text-xs text-text-muted line-clamp-2 mb-3">
                    {card.description}
                </p>
            )}

            {/* Meta Info */}
            <div className="flex items-center gap-3 text-xs text-text-muted">
                {/* Agent Model */}
                <div className="flex items-center gap-1">
                    <Bot className="w-3 h-3" />
                    <span className="truncate max-w-[80px]">{card.agentConfig.model}</span>
                </div>

                {/* Messages Count */}
                <div className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    <span>{card.messages.length}</span>
                </div>

                {/* Time */}
                <div className="flex items-center gap-1 ml-auto">
                    <Clock className="w-3 h-3" />
                    <span>{formatTime(card.updatedAt)}</span>
                </div>
            </div>

            {/* Progress indicator for in-progress cards */}
            {card.status === 'in-progress' && (
                <div className="mt-3 h-1 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                        className="h-full bg-accent"
                        initial={{ width: 0 }}
                        animate={{ width: '60%' }}
                        transition={{ duration: 1, ease: 'easeOut' }}
                    />
                </div>
            )}
        </motion.div>
    )
}
