/**
 * 模式状态管理
 * 
 * 通过 electron-store (preferencesStore) 持久化，
 * 与其他设置统一存储后端，通过 IPC 调用 settings:get/set
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { WorkMode } from './types'
import { api } from '@/renderer/services/electronAPI'

const STORE_KEY = 'modeStore'

interface ModeState {
    /** 当前工作模式 */
    currentMode: WorkMode
    /** 上一个模式（用于切换回去） */
    previousMode: WorkMode | null
}

interface ModeActions {
    /** 设置当前模式 */
    setMode: (mode: WorkMode) => void
    /** 切换回上一个模式 */
    restorePreviousMode: () => void
    /** 检查是否为指定模式 */
    isMode: (mode: WorkMode) => boolean
}

type ModeStore = ModeState & ModeActions

/**
 * 自定义 Storage：通过 IPC 存到 electron-store 的 preferencesStore
 * 统一与其他设置的存储后端，避免使用 localStorage
 */
const electronStoreStorage = {
    getItem: async (name: string): Promise<string | null> => {
        try {
            const value = await api.settings.get(`${STORE_KEY}.${name}`)
            return value ? JSON.stringify(value) : null
        } catch {
            return null
        }
    },
    setItem: async (name: string, value: string): Promise<void> => {
        try {
            const parsed = JSON.parse(value)
            await api.settings.set(`${STORE_KEY}.${name}`, parsed)
        } catch { /* ignore */ }
    },
    removeItem: async (name: string): Promise<void> => {
        try {
            await api.settings.set(`${STORE_KEY}.${name}`, undefined)
        } catch { /* ignore */ }
    },
}

export const useModeStore = create<ModeStore>()(
    persist(
        (set, get) => ({
            currentMode: 'agent', // 默认 Agent 模式
            previousMode: null,

            setMode: (mode) => {
                const current = get().currentMode
                if (current !== mode) {
                    set({
                        currentMode: mode,
                        previousMode: current
                    })
                }
            },

            restorePreviousMode: () => {
                const previous = get().previousMode
                if (previous) {
                    set({
                        currentMode: previous,
                        previousMode: null
                    })
                }
            },

            isMode: (mode) => get().currentMode === mode
        }),
        {
            name: 'adnify-mode-store',
            storage: createJSONStorage(() => electronStoreStorage),
            partialize: (state) => ({
                currentMode: state.currentMode
            })
        }
    )
)
