/**
 * 设置状态切片
 * 
 * 管理 Zustand 状态，委托实际的加载/保存逻辑给 settingsService
 */
import { logger } from '@utils/Logger'
import { StateCreator } from 'zustand'
import { BUILTIN_PROVIDERS, getAdapterConfig } from '@shared/config/providers'
import {
  settingsService,
  getEditorConfig,
  saveEditorConfig,
} from '@renderer/settings'
import type {
  LLMConfig,
  LLMParameters,
  AgentConfig,
  AutoApproveSettings,
  EditorConfig,
  ProviderConfig,
  SecuritySettings,
} from '@shared/config/types'
import type { ApiProtocol } from '@shared/config/providers'
import {
  defaultLLMConfig,
  defaultAgentConfig,
  defaultAutoApprove,
  defaultEditorConfig,
  defaultSecuritySettings,
} from '@renderer/settings'
import { SECURITY_DEFAULTS } from '@shared/constants'

// ============ 导出类型 ============

export type ProviderType = string
export type { LLMConfig, LLMParameters, AgentConfig, AutoApproveSettings, EditorConfig, ProviderConfig }

// ============ Provider 模型配置 ============

export interface ProviderModelConfig extends Omit<ProviderConfig, 'protocol'> {
  customModels?: string[]
  protocol?: ApiProtocol
}

// ============ Slice 接口 ============

export interface SettingsSlice {
  llmConfig: LLMConfig
  language: 'en' | 'zh'
  autoApprove: AutoApproveSettings
  promptTemplateId: string
  providerConfigs: Record<string, ProviderModelConfig>
  securitySettings: SecuritySettings
  agentConfig: AgentConfig
  editorConfig: EditorConfig
  onboardingCompleted: boolean
  hasExistingConfig: boolean
  aiInstructions: string

  setLLMConfig: (config: Partial<LLMConfig>) => void
  setLanguage: (lang: 'en' | 'zh') => void
  setAutoApprove: (settings: Partial<AutoApproveSettings>) => void
  setPromptTemplateId: (id: string) => void
  setProviderConfig: (providerId: string, config: ProviderModelConfig) => void
  updateProviderConfig: (providerId: string, updates: Partial<ProviderModelConfig>) => void
  removeProviderConfig: (providerId: string) => void
  addCustomModel: (providerId: string, model: string) => void
  removeCustomModel: (providerId: string, model: string) => void
  setSecuritySettings: (settings: Partial<SecuritySettings>) => void
  setAgentConfig: (config: Partial<AgentConfig>) => void
  setEditorConfig: (config: Partial<EditorConfig>) => void
  setOnboardingCompleted: (completed: boolean) => void
  setHasExistingConfig: (hasConfig: boolean) => void
  setAiInstructions: (instructions: string) => void
  loadSettings: (isEmptyWindow?: boolean) => Promise<void>
  getCustomProviders: () => Array<{ id: string; config: ProviderModelConfig }>
}

// ============ 默认 Provider 配置 ============

function generateDefaultProviderConfigs(): Record<string, ProviderModelConfig> {
  const configs: Record<string, ProviderModelConfig> = {}
  for (const [id, provider] of Object.entries(BUILTIN_PROVIDERS)) {
    configs[id] = {
      customModels: [],
      adapterConfig: provider.adapter,
      model: provider.defaultModel || '',
      baseUrl: provider.baseUrl,
    }
  }
  return configs
}

const defaultProviderConfigs = generateDefaultProviderConfigs()

// ============ Slice 创建 ============

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set, get) => ({
  llmConfig: { ...defaultLLMConfig, adapterConfig: getAdapterConfig('openai') },
  language: 'en',
  autoApprove: defaultAutoApprove,
  promptTemplateId: 'default',
  providerConfigs: defaultProviderConfigs,
  securitySettings: {
    ...defaultSecuritySettings,
    allowedShellCommands: [...SECURITY_DEFAULTS.SHELL_COMMANDS],
  },
  agentConfig: defaultAgentConfig,
  editorConfig: defaultEditorConfig,
  onboardingCompleted: true,
  hasExistingConfig: true,
  aiInstructions: '',

  setLLMConfig: (config) =>
    set((state) => {
      if (config.apiKey !== undefined || config.baseUrl !== undefined) {
        window.electronAPI?.invalidateProviders?.()
      }
      return { llmConfig: { ...state.llmConfig, ...config } }
    }),

  setLanguage: (lang) => set({ language: lang }),

  setAutoApprove: (settings) =>
    set((state) => ({ autoApprove: { ...state.autoApprove, ...settings } })),

  setPromptTemplateId: (id) => set({ promptTemplateId: id }),

  setProviderConfig: (providerId, config) =>
    set((state) => ({
      providerConfigs: { ...state.providerConfigs, [providerId]: config },
    })),

  updateProviderConfig: (providerId, updates) =>
    set((state) => {
      const current = state.providerConfigs[providerId] || {}
      return {
        providerConfigs: {
          ...state.providerConfigs,
          [providerId]: { ...current, ...updates, updatedAt: Date.now() },
        },
      }
    }),

  removeProviderConfig: (providerId) =>
    set((state) => {
      const { [providerId]: _, ...rest } = state.providerConfigs
      return { providerConfigs: rest }
    }),

  addCustomModel: (providerId, model) =>
    set((state) => {
      const current = state.providerConfigs[providerId] || { customModels: [] }
      const customModels = [...(current.customModels || []), model]
      return {
        providerConfigs: {
          ...state.providerConfigs,
          [providerId]: { ...current, customModels },
        },
      }
    }),

  removeCustomModel: (providerId, model) =>
    set((state) => {
      const current = state.providerConfigs[providerId]
      if (!current) return state
      const customModels = (current.customModels || []).filter((m) => m !== model)
      return {
        providerConfigs: {
          ...state.providerConfigs,
          [providerId]: { ...current, customModels },
        },
      }
    }),

  setSecuritySettings: (settings) =>
    set((state) => ({ securitySettings: { ...state.securitySettings, ...settings } })),

  setAgentConfig: (config) =>
    set((state) => ({ agentConfig: { ...state.agentConfig, ...config } })),

  setEditorConfig: (config) => {
    const newConfig = { ...get().editorConfig, ...config }
    saveEditorConfig(newConfig)
    set({ editorConfig: newConfig })
  },

  setOnboardingCompleted: (completed) => set({ onboardingCompleted: completed }),
  setHasExistingConfig: (hasConfig) => set({ hasExistingConfig: hasConfig }),
  setAiInstructions: (instructions) => set({ aiInstructions: instructions }),

  loadSettings: async (_isEmptyWindow = false) => {
    try {
      const settings = await settingsService.loadAll()

      logger.settings.info('[SettingsSlice] loadSettings:', {
        hasAdapterConfig: !!settings.llmConfig.adapterConfig,
        provider: settings.llmConfig.provider,
      })

      // 转换 providerConfigs，确保 customModels 是数组，并正确转换类型
      const providerConfigs: Record<string, ProviderModelConfig> = {}
      for (const [id, config] of Object.entries(settings.providerConfigs)) {
        providerConfigs[id] = { 
          ...config, 
          customModels: config.customModels || [],
          protocol: config.protocol as ApiProtocol | undefined,
        }
      }

      set({
        llmConfig: settings.llmConfig,
        language: (settings.language as 'en' | 'zh') || 'en',
        autoApprove: { ...defaultAutoApprove, ...settings.autoApprove },
        providerConfigs,
        agentConfig: { ...defaultAgentConfig, ...settings.agentConfig },
        promptTemplateId: settings.promptTemplateId || 'default',
        onboardingCompleted: settings.onboardingCompleted ?? !!settings.llmConfig?.apiKey,
        hasExistingConfig: !!settings.llmConfig?.apiKey,
        aiInstructions: settings.aiInstructions || '',
        editorConfig: getEditorConfig(),
        securitySettings: settings.securitySettings,
      })
    } catch (e) {
      logger.settings.error('[SettingsSlice] Failed to load settings:', e)
    }
  },

  getCustomProviders: () => {
    const { providerConfigs } = get()
    return Object.entries(providerConfigs)
      .filter(([id]) => id.startsWith('custom-'))
      .map(([id, config]) => ({ id, config }))
  },
})
