/**
 * 设置相关状态切片
 */
import { StateCreator } from 'zustand'

export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'groq' | 'mistral' | 'ollama' | 'custom'

export interface LLMConfig {
  provider: ProviderType
  model: string
  apiKey: string
  baseUrl?: string
  timeout?: number
  maxTokens?: number
}

export interface AutoApproveSettings {
  edits: boolean
  terminal: boolean
  dangerous: boolean
}

// Provider 配置（自定义模型等）
export interface ProviderModelConfig {
  customModels: string[]
}

// 安全设置
export interface SecuritySettings {
  enablePermissionConfirm: boolean
  enableAuditLog: boolean
  strictWorkspaceMode: boolean
  allowedShellCommands?: string[]
  showSecurityWarnings?: boolean
}

export interface SettingsSlice {
  llmConfig: LLMConfig
  language: 'en' | 'zh'
  autoApprove: AutoApproveSettings
  promptTemplateId: string
  providerConfigs: Record<string, ProviderModelConfig>
  securitySettings: SecuritySettings

  setLLMConfig: (config: Partial<LLMConfig>) => void
  setLanguage: (lang: 'en' | 'zh') => void
  setAutoApprove: (settings: Partial<AutoApproveSettings>) => void
  setPromptTemplateId: (id: string) => void
  setProviderConfig: (providerId: string, config: ProviderModelConfig) => void
  addCustomModel: (providerId: string, model: string) => void
  removeCustomModel: (providerId: string, model: string) => void
  setSecuritySettings: (settings: Partial<SecuritySettings>) => void
}

const defaultLLMConfig: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: '',
  baseUrl: '',
}

const defaultAutoApprove: AutoApproveSettings = {
  edits: false,
  terminal: false,
  dangerous: false,
}

const defaultProviderConfigs: Record<string, ProviderModelConfig> = {
  openai: { customModels: [] },
  anthropic: { customModels: [] },
  gemini: { customModels: [] },
  deepseek: { customModels: [] },
  groq: { customModels: [] },
  mistral: { customModels: [] },
  ollama: { customModels: [] },
  custom: { customModels: [] },
}

const defaultSecuritySettings: SecuritySettings = {
  enablePermissionConfirm: true,
  enableAuditLog: true,
  strictWorkspaceMode: true,
  allowedShellCommands: ['npm', 'yarn', 'pnpm', 'node', 'npx', 'git', 'ls', 'cat', 'echo', 'pwd'],
  showSecurityWarnings: true,
}

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set) => ({
  llmConfig: defaultLLMConfig,
  language: 'en',
  autoApprove: defaultAutoApprove,
  promptTemplateId: 'default',
  providerConfigs: defaultProviderConfigs,
  securitySettings: defaultSecuritySettings,

  setLLMConfig: (config) =>
    set((state) => ({
      llmConfig: { ...state.llmConfig, ...config },
    })),

  setLanguage: (lang) => set({ language: lang }),

  setAutoApprove: (settings) =>
    set((state) => ({
      autoApprove: { ...state.autoApprove, ...settings },
    })),

  setPromptTemplateId: (id) => set({ promptTemplateId: id }),

  setProviderConfig: (providerId, config) =>
    set((state) => ({
      providerConfigs: {
        ...state.providerConfigs,
        [providerId]: config,
      },
    })),

  addCustomModel: (providerId, model) =>
    set((state) => {
      const current = state.providerConfigs[providerId] || { customModels: [] }
      if (current.customModels.includes(model)) return state
      return {
        providerConfigs: {
          ...state.providerConfigs,
          [providerId]: {
            ...current,
            customModels: [...current.customModels, model],
          },
        },
      }
    }),

  removeCustomModel: (providerId, model) =>
    set((state) => {
      const current = state.providerConfigs[providerId] || { customModels: [] }
      return {
        providerConfigs: {
          ...state.providerConfigs,
          [providerId]: {
            ...current,
            customModels: current.customModels.filter((m) => m !== model),
          },
        },
      }
    }),

  setSecuritySettings: (settings) =>
    set((state) => ({
      securitySettings: { ...state.securitySettings, ...settings },
    })),
})
