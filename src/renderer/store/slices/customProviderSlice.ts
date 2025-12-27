/**
 * 自定义 Provider 状态切片
 * 管理用户添加的自定义 LLM Provider
 */

import { StateCreator } from 'zustand'
import { logger } from '@utils/Logger'
import type { CustomProviderConfig } from '@shared/config/providers'
import type { ProviderApiKey } from '@shared/types/customProvider'

// ============ Slice 接口 ============

export interface CustomProviderSlice {
    // 状态
    customProviders: CustomProviderConfig[]
    providerApiKeys: ProviderApiKey[]

    // Provider CRUD
    addCustomProvider: (config: CustomProviderConfig) => void
    updateCustomProvider: (id: string, updates: Partial<CustomProviderConfig>) => void
    removeCustomProvider: (id: string) => void
    getCustomProvider: (id: string) => CustomProviderConfig | undefined

    // API Key 管理 (分离存储以保护敏感信息)
    setProviderApiKey: (providerId: string, apiKey: string) => void
    getProviderApiKey: (providerId: string) => string | undefined
    removeProviderApiKey: (providerId: string) => void

    // 加载/保存
    loadCustomProviders: () => Promise<void>
    saveCustomProviders: () => Promise<void>
}

// ============ 持久化存储 key ============

const STORAGE_KEY_PROVIDERS = 'adnify:customProviders'
const STORAGE_KEY_API_KEYS = 'adnify:providerApiKeys'

// ============ 辅助函数 ============

/** 从 localStorage 加载数据 */
function loadFromStorage<T>(key: string, defaultValue: T): T {
    try {
        const stored = localStorage.getItem(key)
        if (stored) {
            return JSON.parse(stored) as T
        }
    } catch (e) {
        logger.settings.error(`[CustomProviderSlice] Failed to load from ${key}:`, e)
    }
    return defaultValue
}

/** 保存到 localStorage */
function saveToStorage<T>(key: string, data: T): void {
    try {
        localStorage.setItem(key, JSON.stringify(data))
    } catch (e) {
        logger.settings.error(`[CustomProviderSlice] Failed to save to ${key}:`, e)
    }
}

// ============ Slice 创建 ============

export const createCustomProviderSlice: StateCreator<
    CustomProviderSlice,
    [],
    [],
    CustomProviderSlice
> = (set, get) => ({
    // 初始状态
    customProviders: [],
    providerApiKeys: [],

    // ===== Provider CRUD =====

    addCustomProvider: (config) => {
        const now = Date.now()
        const newConfig: CustomProviderConfig = {
            ...config,
            createdAt: config.createdAt || now,
            updatedAt: now,
        }

        set((state) => ({
            customProviders: [...state.customProviders, newConfig],
        }))

        // 自动保存
        get().saveCustomProviders()
        logger.settings.info('[CustomProviderSlice] Added custom provider:', config.name)
    },

    updateCustomProvider: (id, updates) => {
        set((state) => ({
            customProviders: state.customProviders.map((p) =>
                p.id === id
                    ? { ...p, ...updates, updatedAt: Date.now() }
                    : p
            ),
        }))

        get().saveCustomProviders()
        logger.settings.info('[CustomProviderSlice] Updated custom provider:', id)
    },

    removeCustomProvider: (id) => {
        set((state) => ({
            customProviders: state.customProviders.filter((p) => p.id !== id),
            // 同时移除对应的 API Key
            providerApiKeys: state.providerApiKeys.filter((k) => k.providerId !== id),
        }))

        get().saveCustomProviders()
        logger.settings.info('[CustomProviderSlice] Removed custom provider:', id)
    },

    getCustomProvider: (id) => {
        return get().customProviders.find((p) => p.id === id)
    },

    // ===== API Key 管理 =====

    setProviderApiKey: (providerId, apiKey) => {
        set((state) => {
            const existing = state.providerApiKeys.find((k) => k.providerId === providerId)
            if (existing) {
                return {
                    providerApiKeys: state.providerApiKeys.map((k) =>
                        k.providerId === providerId ? { ...k, apiKey } : k
                    ),
                }
            } else {
                return {
                    providerApiKeys: [...state.providerApiKeys, { providerId, apiKey }],
                }
            }
        })

        // 保存 API Keys (考虑加密存储)
        saveToStorage(STORAGE_KEY_API_KEYS, get().providerApiKeys)
    },

    getProviderApiKey: (providerId) => {
        return get().providerApiKeys.find((k) => k.providerId === providerId)?.apiKey
    },

    removeProviderApiKey: (providerId) => {
        set((state) => ({
            providerApiKeys: state.providerApiKeys.filter((k) => k.providerId !== providerId),
        }))

        saveToStorage(STORAGE_KEY_API_KEYS, get().providerApiKeys)
    },

    // ===== 持久化 =====

    loadCustomProviders: async () => {
        try {
            // 从 localStorage 加载
            const providers = loadFromStorage<CustomProviderConfig[]>(STORAGE_KEY_PROVIDERS, [])
            const apiKeys = loadFromStorage<ProviderApiKey[]>(STORAGE_KEY_API_KEYS, [])

            set({
                customProviders: providers,
                providerApiKeys: apiKeys,
            })

            logger.settings.info('[CustomProviderSlice] Loaded', providers.length, 'custom providers')
        } catch (e) {
            logger.settings.error('[CustomProviderSlice] Failed to load custom providers:', e)
        }
    },

    saveCustomProviders: async () => {
        try {
            const { customProviders, providerApiKeys } = get()
            saveToStorage(STORAGE_KEY_PROVIDERS, customProviders)
            saveToStorage(STORAGE_KEY_API_KEYS, providerApiKeys)
        } catch (e) {
            logger.settings.error('[CustomProviderSlice] Failed to save custom providers:', e)
        }
    },
})
