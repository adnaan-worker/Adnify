import { StateCreator } from 'zustand'
import { AgentConfig } from '../types'
import type { AgentStore } from './index'

export interface ConfigSlice {
    autoApprove: AgentConfig['autoApprove']

    setAutoApprove: (type: keyof AgentConfig['autoApprove'], value: boolean) => void
}

export const createConfigSlice: StateCreator<AgentStore, [], [], ConfigSlice> = (set) => ({
    autoApprove: {
        edits: false,
        terminal: false,
        dangerous: false,
    },

    setAutoApprove: (type, value) => {
        set((state) => ({
            autoApprove: { ...state.autoApprove, [type]: value },
        }))
    },
})
