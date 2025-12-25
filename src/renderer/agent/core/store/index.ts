import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ThreadSlice, createThreadSlice } from './createThreadSlice'
import { StreamSlice, createStreamSlice } from './createStreamSlice'
import { PlanSlice, createPlanSlice } from './createPlanSlice'
import { ConfigSlice, createConfigSlice } from './createConfigSlice'

export type AgentStore = ThreadSlice & StreamSlice & PlanSlice & ConfigSlice

let windowId: number | null = null

export const initializeAgentStore = async () => {
    try {
        windowId = await window.electronAPI.getWindowId()
        console.log('[AgentStore] Initialized with windowId:', windowId)
    } catch (e) {
        console.error('[AgentStore] Failed to get windowId:', e)
    }
}

export const useAgentStore = create<AgentStore>()(
    persist(
        (...a) => ({
            ...createThreadSlice(...a),
            ...createStreamSlice(...a),
            ...createPlanSlice(...a),
            ...createConfigSlice(...a),
        }),
        {
            name: 'adnify-agent-store',
            // Only persist threads and config, skip stream state
            partialize: (state) => ({
                threads: state.threads,
                currentThreadId: state.currentThreadId,
                autoApprove: state.autoApprove,
                plan: state.plan,
            }),
            // Use window-specific storage key if windowId is available
            storage: {
                getItem: (name) => {
                    const key = windowId ? `${name}-${windowId}` : name
                    const value = localStorage.getItem(key)
                    return value ? JSON.parse(value) : null
                },
                setItem: (name, value) => {
                    const key = windowId ? `${name}-${windowId}` : name
                    localStorage.setItem(key, JSON.stringify(value))
                },
                removeItem: (name) => {
                    const key = windowId ? `${name}-${windowId}` : name
                    localStorage.removeItem(key)
                }
            }
        }
    )
)

// Selectors
export const selectMessages = (state: AgentStore) => state.getMessages()
export const selectStreamState = (state: AgentStore) => state.streamState
export const selectContextItems = (state: AgentStore) => state.getCurrentThread()?.contextItems || []
export const selectIsStreaming = (state: AgentStore) => state.streamState.phase === 'streaming'
export const selectIsAwaitingApproval = (state: AgentStore) => state.streamState.phase === 'tool_pending'
export const selectPendingChanges = (state: AgentStore) => state.pendingChanges
export const selectMessageCheckpoints = (state: AgentStore) => state.messageCheckpoints
