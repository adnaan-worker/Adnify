/**
 * 设置状态切片
 * 
 * 统一的设置管理，使用 set/update API
 */

import { StateCreator } from 'zustand'
import { logger } from '@shared/utils/Logger'
import { settingsService } from '@renderer/settings/service'
import {
  type SettingsState,
  type SettingKey,
  type ProviderModelConfig,
  getAllDefaults,
} from '@shared/config/settings'
import type { ApiProtocol } from '@shared/config/providers'

// ============================================
// Slice 接口
// ============================================

export interface SettingsSlice extends SettingsState {
  hasExistingConfig: boolean

  // 统一设置 API
  set: <K extends SettingKey>(key: K, value: SettingsState[K]) => void
  update: <K extends SettingKey>(key: K, partial: Partial<SettingsState[K]>) => void

  // Provider 方法
  setProvider: (id: string, config: ProviderModelConfig) => void
  updateProvider: (id: string, updates: Partial<ProviderModelConfig>) => void
  removeProvider: (id: string) => void
  addModel: (providerId: string, model: string) => void
  removeModel: (providerId: string, model: string) => void
  getCustomProviders: () => Array<{ id: string; config: ProviderModelConfig }>

  // 生命周期
  load: () => Promise<void>
  save: () => Promise<void>
}

// ============================================
// Slice 实现
// ============================================

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set, get) => ({
  ...getAllDefaults(),
  hasExistingConfig: false,

  set: (key, value) => {
    set({ [key]: value } as Partial<SettingsState>)
    if (key === 'llmConfig') {
      const config = value as SettingsState['llmConfig']
      if (config.apiKey !== undefined || config.baseUrl !== undefined) {
        window.electronAPI?.invalidateProviders?.()
      }
    }
  },

  update: (key, partial) => {
    set((state) => ({
      [key]: { ...(state[key] as object), ...partial },
    } as Partial<SettingsState>))
  },

  setProvider: (id, config) =>
    set((state) => ({
      providerConfigs: { ...state.providerConfigs, [id]: config },
    })),

  updateProvider: (id, updates) =>
    set((state) => {
      const current = state.providerConfigs[id] || {}
      return {
        providerConfigs: {
          ...state.providerConfigs,
          [id]: { ...current, ...updates, updatedAt: Date.now() },
        },
      }
    }),

  removeProvider: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.providerConfigs
      return { providerConfigs: rest }
    }),

  addModel: (providerId, model) =>
    set((state) => {
      const current = state.providerConfigs[providerId] || { customModels: [] }
      return {
        providerConfigs: {
          ...state.providerConfigs,
          [providerId]: { ...current, customModels: [...(current.customModels || []), model] },
        },
      }
    }),

  removeModel: (providerId, model) =>
    set((state) => {
      const current = state.providerConfigs[providerId]
      if (!current) return state
      return {
        providerConfigs: {
          ...state.providerConfigs,
          [providerId]: { ...current, customModels: (current.customModels || []).filter((m) => m !== model) },
        },
      }
    }),

  getCustomProviders: () => {
    const { providerConfigs } = get()
    return Object.entries(providerConfigs)
      .filter(([id]) => id.startsWith('custom-'))
      .map(([id, config]) => ({ id, config }))
  },

  load: async () => {
    try {
      const settings = await settingsService.load()
      logger.settings.info('[Settings] Loaded')

      const providerConfigs: Record<string, ProviderModelConfig> = {}
      for (const [id, config] of Object.entries(settings.providerConfigs)) {
        providerConfigs[id] = {
          ...config,
          customModels: config.customModels || [],
          protocol: config.protocol as ApiProtocol | undefined,
        }
      }

      set({
        ...settings,
        providerConfigs,
        hasExistingConfig: !!settings.llmConfig.apiKey,
      })
    } catch (e) {
      logger.settings.error('[Settings] Load failed:', e)
    }
  },

  save: async () => {
    try {
      const state = get()
      await settingsService.save({
        llmConfig: state.llmConfig,
        language: state.language,
        autoApprove: state.autoApprove,
        promptTemplateId: state.promptTemplateId,
        providerConfigs: state.providerConfigs,
        agentConfig: state.agentConfig,
        editorConfig: state.editorConfig,
        securitySettings: state.securitySettings,
        webSearchConfig: state.webSearchConfig,
        mcpConfig: state.mcpConfig,
        aiInstructions: state.aiInstructions,
        onboardingCompleted: state.onboardingCompleted,
        enableFileLogging: state.enableFileLogging,
      })
      logger.settings.info('[Settings] Saved')
    } catch (e) {
      logger.settings.error('[Settings] Save failed:', e)
      throw e
    }
  },
})

// ============================================
// 类型导出
// ============================================

export type { SettingsState, SettingKey, ProviderModelConfig }
