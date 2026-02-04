/**
 * PlanKanban - 三列看板组件
 * 
 * 使用 @dnd-kit 实现拖拽排序
 */

import { useMemo } from 'react'
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragOverlay,
    DragStartEvent,
} from '@dnd-kit/core'
import {
    SortableContext,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useStore } from '@store'
import { PlanCard } from './PlanCard'
import type { PlanCardStatus } from '@renderer/store/slices/planSlice'
import { useState } from 'react'
import { ClipboardList, Wrench, CheckCircle2, type LucideIcon } from 'lucide-react'

interface Column {
    id: PlanCardStatus
    title: string
    titleEn: string
    icon: LucideIcon
    color: string
}

const COLUMNS: Column[] = [
    { id: 'planning', title: '待规划', titleEn: 'Planning', icon: ClipboardList, color: 'text-blue-400' },
    { id: 'in-progress', title: '执行中', titleEn: 'In Progress', icon: Wrench, color: 'text-yellow-400' },
    { id: 'completed', title: '已完成', titleEn: 'Completed', icon: CheckCircle2, color: 'text-green-400' },
]

export function PlanKanban() {
    const { planCards, movePlanCard, selectPlanCard, language } = useStore()
    const [activeId, setActiveId] = useState<string | null>(null)

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor)
    )

    const cardsByStatus = useMemo(() => {
        const result: Record<PlanCardStatus, typeof planCards> = {
            'planning': [],
            'in-progress': [],
            'completed': [],
        }
        for (const card of planCards) {
            result[card.status].push(card)
        }
        return result
    }, [planCards])

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string)
    }

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveId(null)
        const { active, over } = event

        if (!over) return

        const activeCard = planCards.find(c => c.id === active.id)
        if (!activeCard) return

        // Check if dropped on a column
        const targetColumn = COLUMNS.find(col => col.id === over.id)
        if (targetColumn) {
            movePlanCard(activeCard.id, targetColumn.id)
            return
        }

        // Check if dropped on another card
        const overCard = planCards.find(c => c.id === over.id)
        if (overCard && activeCard.status !== overCard.status) {
            movePlanCard(activeCard.id, overCard.status)
        }
    }

    const activeCard = activeId ? planCards.find(c => c.id === activeId) : null

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <div className="flex gap-4 p-6 h-full min-w-max">
                {COLUMNS.map((column) => (
                    <KanbanColumn
                        key={column.id}
                        column={column}
                        cards={cardsByStatus[column.id]}
                        language={language}
                        onCardClick={selectPlanCard}
                    />
                ))}
            </div>

            <DragOverlay>
                {activeCard && (
                    <div className="opacity-90 rotate-3 scale-105">
                        <PlanCard card={activeCard} isDragging />
                    </div>
                )}
            </DragOverlay>
        </DndContext>
    )
}

interface KanbanColumnProps {
    column: Column
    cards: typeof useStore.getState extends () => infer R ? R extends { planCards: infer C } ? C : never : never
    language: string
    onCardClick: (id: string) => void
}

function KanbanColumn({ column, cards, language, onCardClick }: KanbanColumnProps) {
    return (
        <div
            className="w-72 flex-shrink-0 flex flex-col bg-surface/30 rounded-xl border border-border"
        >
            {/* Column Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <column.icon className={`w-4 h-4 ${column.color}`} />
                <span className={`text-sm font-medium ${column.color}`}>
                    {language === 'zh' ? column.title : column.titleEn}
                </span>
                <span className="ml-auto px-2 py-0.5 text-xs bg-white/5 rounded-full text-text-muted">
                    {cards.length}
                </span>
            </div>

            {/* Cards Container */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                <SortableContext
                    items={cards.map(c => c.id)}
                    strategy={verticalListSortingStrategy}
                >
                    {cards.map((card) => (
                        <PlanCard
                            key={card.id}
                            card={card}
                            onClick={() => onCardClick(card.id)}
                        />
                    ))}
                </SortableContext>

                {cards.length === 0 && (
                    <div className="flex items-center justify-center h-24 text-text-muted text-sm opacity-50">
                        {language === 'zh' ? '暂无计划' : 'No plans'}
                    </div>
                )}
            </div>
        </div>
    )
}
