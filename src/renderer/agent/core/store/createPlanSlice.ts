import { StateCreator } from 'zustand'
import { Plan, PlanItem, PlanStatus, PlanItemStatus } from '../types'
import type { AgentStore } from './index'

export interface PlanSlice {
    plan: Plan | null

    createPlan: (items: Array<{ title: string; description?: string }>) => void
    updatePlanStatus: (status: PlanStatus) => void
    updatePlanItem: (itemId: string, updates: Partial<PlanItem>) => void
    addPlanItem: (item: { title: string; description?: string }) => void
    deletePlanItem: (itemId: string) => void
    setPlanStep: (stepId: string | null) => void
    clearPlan: () => void
}

const generateId = () => crypto.randomUUID()

export const createPlanSlice: StateCreator<AgentStore, [], [], PlanSlice> = (set) => ({
    plan: null,

    createPlan: (items) => {
        const plan: Plan = {
            id: generateId(),
            items: items.map(item => ({
                id: generateId(),
                title: item.title,
                description: item.description,
                status: PlanItemStatus.Pending
            })),
            status: PlanStatus.Active,
            currentStepId: null,
            createdAt: Date.now(),
            updatedAt: Date.now()
        }
        set({ plan })
    },

    updatePlanStatus: (status) => {
        set((state) => {
            if (!state.plan) return state
            return {
                plan: { ...state.plan, status, updatedAt: Date.now() }
            }
        })
    },

    updatePlanItem: (itemId, updates) => {
        set((state) => {
            if (!state.plan) return state
            const items = state.plan.items.map(item =>
                item.id === itemId ? { ...item, ...updates } : item
            )
            return {
                plan: { ...state.plan, items, updatedAt: Date.now() }
            }
        })
    },

    addPlanItem: (item) => {
        set((state) => {
            if (!state.plan) return state
            const newItem: PlanItem = {
                id: generateId(),
                title: item.title,
                description: item.description,
                status: PlanItemStatus.Pending
            }
            return {
                plan: { ...state.plan, items: [...state.plan.items, newItem], updatedAt: Date.now() }
            }
        })
    },

    deletePlanItem: (itemId) => {
        set((state) => {
            if (!state.plan) return state
            return {
                plan: { ...state.plan, items: state.plan.items.filter(i => i.id !== itemId), updatedAt: Date.now() }
            }
        })
    },

    setPlanStep: (stepId) => {
        set((state) => {
            if (!state.plan) return state
            return {
                plan: { ...state.plan, currentStepId: stepId, updatedAt: Date.now() }
            }
        })
    },

    clearPlan: () => {
        set({ plan: null })
    },
})
