import { StateCreator } from 'zustand'
import { StreamState, ToolCall } from '../types'
import { StreamPhase } from '../enums'
import type { AgentStore } from './index'

export interface StreamSlice {
    streamState: StreamState

    setStreamState: (state: Partial<StreamState>) => void
    setStreamPhase: (phase: StreamPhase, toolCall?: ToolCall, error?: string) => void
}

export const createStreamSlice: StateCreator<AgentStore, [], [], StreamSlice> = (set) => ({
    streamState: { phase: StreamPhase.Idle },

    setStreamState: (newState) => {
        set((state) => ({
            streamState: { ...state.streamState, ...newState },
        }))
    },

    setStreamPhase: (phase, toolCall, error) => {
        set({ streamState: { phase, currentToolCall: toolCall, error } })
    },
})
