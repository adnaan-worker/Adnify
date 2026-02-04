/**
 * Plan Board Tab - Kanban 看板主容器
 * 
 * 作为 Editor 的特殊 Tab 显示
 */

import { useStore } from '@store'
import { PlanKanban } from './PlanKanban'
import { PlanDetailPanel } from './PlanDetailPanel'
import { Plus, LayoutGrid } from 'lucide-react'
import { useState } from 'react'
import { AgentConfigModal } from './AgentConfigModal'
import type { PlanAgentConfig } from '@renderer/store/slices/planSlice'

export default function PlanBoardTab() {
    const { language, planCards, addPlanCard, llmConfig } = useStore()
    const [showNewCardModal, setShowNewCardModal] = useState(false)

    const handleCreateCard = (name: string, agentConfig: PlanAgentConfig) => {
        addPlanCard({
            name,
            status: 'planning',
            agentConfig,
        })
        setShowNewCardModal(false)
    }

    return (
        <div className="h-full flex flex-col bg-background overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-border bg-surface/30">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
                        <LayoutGrid className="w-4 h-4 text-accent" />
                    </div>
                    <div>
                        <h1 className="text-base font-semibold text-text-primary">
                            {language === 'zh' ? 'Plan 看板' : 'Plan Board'}
                        </h1>
                        <p className="text-xs text-text-muted">
                            {language === 'zh'
                                ? `${planCards.length} 个计划`
                                : `${planCards.length} plans`}
                        </p>
                    </div>
                </div>

                <button
                    onClick={() => setShowNewCardModal(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    {language === 'zh' ? '新建计划' : 'New Plan'}
                </button>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* Kanban Area */}
                <div className="flex-1 overflow-x-auto">
                    <PlanKanban />
                </div>
            </div>

            {/* Detail Panel - Fixed at bottom */}
            <PlanDetailPanel />

            {/* New Card Modal */}
            {showNewCardModal && (
                <AgentConfigModal
                    mode="create"
                    defaultConfig={{
                        model: llmConfig.model,
                        providerId: llmConfig.provider,
                    }}
                    onConfirm={(name, config) => handleCreateCard(name, config)}
                    onClose={() => setShowNewCardModal(false)}
                />
            )}
        </div>
    )
}
