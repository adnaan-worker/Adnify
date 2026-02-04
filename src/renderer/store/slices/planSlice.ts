/**
 * Plan 状态切片
 * 
 * 管理 Kanban 看板的卡片、选中状态和对话历史
 */

import { StateCreator } from 'zustand'
import type { ChatMessage } from '@renderer/agent/types'

// ============================================
// 类型定义
// ============================================

export type PlanCardStatus = 'planning' | 'in-progress' | 'completed'

export interface PlanAgentConfig {
    model: string
    providerId: string
    templateId?: string
    systemPrompt?: string
    temperature?: number
}

export interface PlanCard {
    id: string
    name: string
    description?: string
    status: PlanCardStatus
    agentConfig: PlanAgentConfig
    workflowId?: string
    messages: ChatMessage[]
    createdAt: number
    updatedAt: number
}

// ============================================
// Slice 接口
// ============================================

export interface PlanSlice {
    // 状态
    planCards: PlanCard[]
    selectedCardId: string | null
    isPlanBoardOpen: boolean

    // 卡片操作
    addPlanCard: (card: Omit<PlanCard, 'id' | 'createdAt' | 'updatedAt' | 'messages'>) => string
    updatePlanCard: (id: string, updates: Partial<Omit<PlanCard, 'id' | 'createdAt'>>) => void
    deletePlanCard: (id: string) => void
    movePlanCard: (id: string, newStatus: PlanCardStatus) => void

    // 选中
    selectPlanCard: (id: string | null) => void

    // 对话
    addPlanMessage: (cardId: string, message: ChatMessage) => void
    updatePlanMessage: (cardId: string, messageId: string, updates: Partial<ChatMessage>) => void
    clearPlanMessages: (cardId: string) => void

    // Plan Board 开关
    openPlanBoard: () => void
    closePlanBoard: () => void
}

// ============================================
// 常量
// ============================================

export const PLAN_BOARD_PATH = 'adnify://plan-board'

// ============================================
// Slice 实现
// ============================================

export const createPlanSlice: StateCreator<PlanSlice, [], [], PlanSlice> = (set) => ({
    planCards: [],
    selectedCardId: null,
    isPlanBoardOpen: false,

    addPlanCard: (card) => {
        const id = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const now = Date.now()
        const newCard: PlanCard = {
            ...card,
            id,
            messages: [],
            createdAt: now,
            updatedAt: now,
        }
        set((state) => ({
            planCards: [...state.planCards, newCard],
        }))
        return id
    },

    updatePlanCard: (id, updates) => {
        set((state) => ({
            planCards: state.planCards.map((card) =>
                card.id === id
                    ? { ...card, ...updates, updatedAt: Date.now() }
                    : card
            ),
        }))
    },

    deletePlanCard: (id) => {
        set((state) => ({
            planCards: state.planCards.filter((card) => card.id !== id),
            selectedCardId: state.selectedCardId === id ? null : state.selectedCardId,
        }))
    },

    movePlanCard: (id, newStatus) => {
        set((state) => ({
            planCards: state.planCards.map((card) =>
                card.id === id
                    ? { ...card, status: newStatus, updatedAt: Date.now() }
                    : card
            ),
        }))
    },

    selectPlanCard: (id) => {
        set({ selectedCardId: id })
    },

    addPlanMessage: (cardId, message) => {
        set((state) => ({
            planCards: state.planCards.map((card) =>
                card.id === cardId
                    ? { ...card, messages: [...card.messages, message], updatedAt: Date.now() }
                    : card
            ),
        }))
    },

    updatePlanMessage: (cardId, messageId, updates) => {
        set((state) => ({
            planCards: state.planCards.map((card) =>
                card.id === cardId
                    ? {
                        ...card,
                        messages: card.messages.map((msg): ChatMessage =>
                            msg.id === messageId ? { ...msg, ...updates } as ChatMessage : msg
                        ),
                        updatedAt: Date.now(),
                    }
                    : card
            ),
        }))
    },

    clearPlanMessages: (cardId) => {
        set((state) => ({
            planCards: state.planCards.map((card) =>
                card.id === cardId
                    ? { ...card, messages: [], updatedAt: Date.now() }
                    : card
            ),
        }))
    },

    openPlanBoard: () => {
        set({ isPlanBoardOpen: true })
    },

    closePlanBoard: () => {
        set({ isPlanBoardOpen: false, selectedCardId: null })
    },
})
