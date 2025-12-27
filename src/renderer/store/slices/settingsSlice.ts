/**
 * 设置相关状态切片
 * 统一管理所有应用设置
 */
import { logger } from '@utils/Logger'
import { StateCreator } from 'zustand'
import { SECURITY_DEFAULTS, AGENT_DEFAULTS } from '@/shared/constants'
import { saveEditorConfig, getEditorConfig, defaultEditorConfig } from '@renderer/config/editorConfig'
import { ProviderModelConfig } from '@app-types/provider'
import { BUILTIN_PROVIDERS, getAdapterConfig } from '@/shared/config/providers'
import {
  settingsService,
  type LLMConfig as ServiceLLMConfig,
  type LLMParameters,
  type AutoApproveSettings as ServiceAutoApprove,
  type AgentConfig as ServiceAgentConfig,
  defaultLLMConfig as serviceDefaultLLMConfig,
  defaultAutoApprove as serviceDefaultAutoApprove,
  defaultAgentConfig as serviceDefaultAgentConfig,
} from '@services/settingsService'

// ============ 导出类型 ============

export type ProviderType = string

export type { LLMParameters }

// LLMConfig 扩展 ServiceLLMConfig
export interface LLMConfig extends ServiceLLMConfig {
  parameters: LLMParameters
}


export type AutoApproveSettings = ServiceAutoApprove

// 安全设置（特定于此 slice）
export interface SecuritySettings {
  enablePermissionConfirm: boolean
  enableAuditLog: boolean
  strictWorkspaceMode: boolean
  allowedShellCommands?: string[]
  showSecurityWarnings?: boolean
}

// Agent 配置（扩展 ServiceAgentConfig）
export interface AgentConfig extends ServiceAgentConfig { }

// ============ Slice 接口 ============

export interface SettingsSlice {
  llmConfig: LLMConfig
  language: 'en' | 'zh'
  autoApprove: AutoApproveSettings
  promptTemplateId: string
  providerConfigs: Record<string, ProviderModelConfig>
  securitySettings: SecuritySettings
  agentConfig: AgentConfig
  editorConfig: import('../../config/editorConfig').EditorConfig
  onboardingCompleted: boolean
  hasExistingConfig: boolean
  aiInstructions: string

  setLLMConfig: (config: Partial<LLMConfig>) => void
  setLanguage: (lang: 'en' | 'zh') => void
  setAutoApprove: (settings: Partial<AutoApproveSettings>) => void
  setPromptTemplateId: (id: string) => void
  setProviderConfig: (providerId: string, config: ProviderModelConfig) => void
  addCustomModel: (providerId: string, model: string) => void
  removeCustomModel: (providerId: string, model: string) => void
  setSecuritySettings: (settings: Partial<SecuritySettings>) => void
  setAgentConfig: (config: Partial<AgentConfig>) => void
  setEditorConfig: (config: Partial<import('../../config/editorConfig').EditorConfig>) => void
  setOnboardingCompleted: (completed: boolean) => void
  setHasExistingConfig: (hasConfig: boolean) => void
  setAiInstructions: (instructions: string) => void
  loadSettings: (isEmptyWindow?: boolean) => Promise<void>
}

// ============ 默认值（从 settingsService 派生） ============

const defaultLLMConfig: LLMConfig = {
  ...serviceDefaultLLMConfig,
  provider: 'openai',
  parameters: serviceDefaultLLMConfig.parameters!,
  adapterConfig: getAdapterConfig('openai'),
}

const defaultAutoApprove = serviceDefaultAutoApprove

// 从统一配置生成默认 Provider 配置
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

const defaultSecuritySettings: SecuritySettings = {
  enablePermissionConfirm: true,
  enableAuditLog: true,
  strictWorkspaceMode: true,
  allowedShellCommands: [...SECURITY_DEFAULTS.SHELL_COMMANDS],
  showSecurityWarnings: true,
}

const defaultAgentConfig: AgentConfig = {
  ...serviceDefaultAgentConfig,
  maxToolLoops: AGENT_DEFAULTS.MAX_TOOL_LOOPS,
  maxFileContentChars: AGENT_DEFAULTS.MAX_FILE_CONTENT_CHARS,
}

// ============ Slice 创建 ============

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set, get) => ({
  llmConfig: defaultLLMConfig,
  language: 'en',
  autoApprove: defaultAutoApprove,
  promptTemplateId: 'default',
  providerConfigs: defaultProviderConfigs,
  securitySettings: defaultSecuritySettings,
  agentConfig: defaultAgentConfig,
  editorConfig: defaultEditorConfig,
  onboardingCompleted: true,
  hasExistingConfig: true,
  aiInstructions: '',

  setLLMConfig: (config) =>
    set((state) => {
      // 如果 API Key 或 baseUrl 变更，使 Provider 缓存失效
      if (config.apiKey !== undefined || config.baseUrl !== undefined) {
        window.electronAPI?.invalidateProviders?.()
      }
      return {
        llmConfig: { ...state.llmConfig, ...config },
      }
    }),

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
    set((state) => ({
      securitySettings: { ...state.securitySettings, ...settings },
    })),

  setAgentConfig: (config) =>
    set((state) => ({
      agentConfig: { ...state.agentConfig, ...config },
    })),

  setEditorConfig: (config) => {
    const newConfig = { ...get().editorConfig, ...config }
    saveEditorConfig(newConfig)
    set({ editorConfig: newConfig })
  },

  setOnboardingCompleted: (completed) => set({ onboardingCompleted: completed }),
  setHasExistingConfig: (hasConfig) => set({ hasExistingConfig: hasConfig }),
  setAiInstructions: (instructions) => set({ aiInstructions: instructions }),

  loadSettings: async (isEmptyWindow = false) => {
    try {
      // 使用统一的 settingsService 加载设置
      const settings = await settingsService.loadAll()

      logger.settings.info('[SettingsSlice] loadSettings via settingsService:', {
        hasAdapterConfig: !!settings.llmConfig.adapterConfig,
        provider: settings.llmConfig.provider,
      })

      // 转换 providerConfigs 类型，确保 customModels 是数组
      const providerConfigs: Record<string, ProviderModelConfig> = {}
      for (const [id, config] of Object.entries(settings.providerConfigs)) {
        providerConfigs[id] = {
          ...config,
          customModels: config.customModels || [],
        }
      }

      set({
        llmConfig: settings.llmConfig as LLMConfig,
        language: (settings.language as 'en' | 'zh') || 'en',
        autoApprove: { ...defaultAutoApprove, ...settings.autoApprove },
        providerConfigs,
        agentConfig: { ...defaultAgentConfig, ...settings.agentConfig },
        promptTemplateId: settings.promptTemplateId || 'default',
        onboardingCompleted: settings.onboardingCompleted ?? !!settings.llmConfig?.apiKey,
        hasExistingConfig: !!settings.llmConfig?.apiKey,
        aiInstructions: settings.aiInstructions || '',
        editorConfig: getEditorConfig(),
      })

      // 加载自定义 Provider（从 localStorage）
      await (get() as any).loadCustomProviders()

      if (!isEmptyWindow) {
        const workspace = await window.electronAPI.restoreWorkspace()
        if (workspace) {
          ; (get() as any).setWorkspace(workspace)
        }
      }
    } catch (e) {
      logger.settings.error('[SettingsSlice] Failed to load settings:', e)
    }
  },
})
