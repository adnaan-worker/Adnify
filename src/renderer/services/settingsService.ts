/**
 * 统一设置服务
 * 集中管理所有应用设置的加载、保存和清理
 */

import { logger } from '@utils/Logger'
import { LLM_DEFAULTS } from '@/shared/constants'
import {
  BUILTIN_PROVIDERS,
  isBuiltinProvider,
  getBuiltinProvider,
  getAdapterConfig,
  type LLMAdapterConfig,
  type AdvancedConfig,
  type UserProviderConfig,
} from '@/shared/config/providers'

// ============ 类型定义 ============

/** LLM 参数配置 */
export interface LLMParameters {
  temperature: number
  topP: number
  maxTokens: number
}

/** LLM 配置（运行时使用） */
export interface LLMConfig {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  timeout?: number
  parameters?: LLMParameters
  adapterConfig?: LLMAdapterConfig
  advanced?: AdvancedConfig
}

/** Provider 配置（保存到文件） */
export type ProviderConfig = UserProviderConfig

/** 自动审批设置 */
export interface AutoApproveSettings {
  terminal: boolean
  dangerous: boolean
}

/** Agent 配置 */
export interface AgentConfig {
  maxToolLoops: number
  maxHistoryMessages: number
  enableAutoFix: boolean
  maxToolResultChars: number
  maxFileContentChars: number
  maxTotalContextChars: number
  maxSingleFileChars: number
  maxContextFiles: number
  maxSemanticResults: number
  maxTerminalChars: number
  maxRetries: number
  retryDelayMs: number
  toolTimeoutMs: number
  contextCompressThreshold: number
  keepRecentTurns: number
  loopDetection: {
    maxHistory: number
    maxExactRepeats: number
    maxSameTargetRepeats: number
  }
  ignoredDirectories: string[]
}

/** 完整的应用设置 */
export interface AppSettings {
  llmConfig: LLMConfig
  language: string
  autoApprove: AutoApproveSettings
  promptTemplateId?: string
  agentConfig: AgentConfig
  providerConfigs: Record<string, ProviderConfig>
  aiInstructions: string
  onboardingCompleted: boolean
}

// ============ 默认值 ============

const defaultLLMParameters: LLMParameters = {
  temperature: LLM_DEFAULTS.TEMPERATURE,
  topP: LLM_DEFAULTS.TOP_P,
  maxTokens: LLM_DEFAULTS.MAX_TOKENS,
}

const defaultLLMConfig: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: '',
  parameters: defaultLLMParameters,
}

const defaultAutoApprove: AutoApproveSettings = {
  terminal: false,
  dangerous: false,
}

const defaultAgentConfig: AgentConfig = {
  maxToolLoops: 30,
  maxHistoryMessages: 60,
  enableAutoFix: true,
  maxToolResultChars: 10000,
  maxFileContentChars: 15000,
  maxTotalContextChars: 60000,
  maxSingleFileChars: 6000,
  maxContextFiles: 6,
  maxSemanticResults: 5,
  maxTerminalChars: 3000,
  maxRetries: 3,
  retryDelayMs: 1000,
  toolTimeoutMs: 60000,
  contextCompressThreshold: 40000,
  keepRecentTurns: 3,
  loopDetection: {
    maxHistory: 15,
    maxExactRepeats: 2,
    maxSameTargetRepeats: 3,
  },
  ignoredDirectories: [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '__pycache__',
    '.venv',
    'venv',
    '.cache',
    'coverage',
    '.nyc_output',
    'tmp',
    'temp',
    '.idea',
    '.vscode',
  ],
}

/** 生成内置 Provider 的默认配置 */
function generateDefaultProviderConfigs(): Record<string, ProviderConfig> {
  const configs: Record<string, ProviderConfig> = {}
  for (const [id, def] of Object.entries(BUILTIN_PROVIDERS)) {
    configs[id] = {
      model: def.defaultModel,
      baseUrl: def.baseUrl,
    }
  }
  return configs
}

// ============ 清理工具函数 ============

/** 判断 baseUrl 是否为默认值 */
function isDefaultBaseUrl(providerId: string, baseUrl?: string): boolean {
  if (!baseUrl) return true
  const provider = getBuiltinProvider(providerId)
  return provider?.baseUrl === baseUrl
}

/** 清理 LLM 配置 - 只保存 provider 和 model */
function cleanLLMConfig(config: LLMConfig): Partial<LLMConfig> {
  return {
    provider: config.provider,
    model: config.model,
  }
}

/** 清理单个 Provider 配置 */
function cleanProviderConfig(
  providerId: string,
  config: ProviderConfig,
  isCurrentProvider: boolean
): Partial<ProviderConfig> | null {
  const isBuiltin = isBuiltinProvider(providerId)
  const cleaned: Partial<ProviderConfig> = {}

  if (config.apiKey) {
    cleaned.apiKey = config.apiKey
  }

  if (config.baseUrl && !isDefaultBaseUrl(providerId, config.baseUrl)) {
    cleaned.baseUrl = config.baseUrl
  }

  if (isCurrentProvider && config.model) {
    cleaned.model = config.model
  }

  if (config.timeout && config.timeout !== 120000) {
    cleaned.timeout = config.timeout
  }

  if (config.customModels && config.customModels.length > 0) {
    cleaned.customModels = config.customModels
  }

  if (config.advanced) {
    cleaned.advanced = config.advanced
  }

  // 自定义 Provider: 保存 adapterConfig
  if (!isBuiltin && config.adapterConfig) {
    cleaned.adapterConfig = config.adapterConfig
  }

  if (Object.keys(cleaned).length === 0) {
    return null
  }

  return cleaned
}

/** 清理所有 Provider 配置 */
function cleanProviderConfigs(
  configs: Record<string, ProviderConfig>,
  currentProvider: string
): Record<string, ProviderConfig> {
  const cleaned: Record<string, ProviderConfig> = {}

  for (const [id, config] of Object.entries(configs)) {
    const isCurrentProvider = id === currentProvider
    const cleanedConfig = cleanProviderConfig(id, config, isCurrentProvider)

    if (cleanedConfig) {
      cleaned[id] = cleanedConfig as ProviderConfig
    }
  }

  return cleaned
}

// ============ 设置服务类 ============

class SettingsService {
  private cache: AppSettings | null = null

  async loadAll(): Promise<AppSettings> {
    try {
      const settings = (await window.electronAPI.getSetting('app-settings')) as Partial<AppSettings> | null

      if (!settings) {
        return this.getDefaultSettings()
      }

      const mergedProviderConfigs = this.mergeProviderConfigs(settings.providerConfigs)
      const llmConfig = this.mergeLLMConfig(settings.llmConfig, mergedProviderConfigs)

      const merged: AppSettings = {
        llmConfig,
        language: settings.language || 'en',
        autoApprove: { ...defaultAutoApprove, ...settings.autoApprove },
        promptTemplateId: settings.promptTemplateId,
        agentConfig: { ...defaultAgentConfig, ...settings.agentConfig },
        providerConfigs: mergedProviderConfigs,
        aiInstructions: settings.aiInstructions || '',
        onboardingCompleted: settings.onboardingCompleted ?? false,
      }

      this.cache = merged
      return merged
    } catch (e) {
      logger.settings.error('[SettingsService] Failed to load settings:', e)
      return this.getDefaultSettings()
    }
  }

  async saveAll(settings: AppSettings): Promise<void> {
    try {
      const cleanedLLMConfig = cleanLLMConfig(settings.llmConfig)
      const cleanedProviderConfigs = cleanProviderConfigs(settings.providerConfigs, settings.llmConfig.provider)

      const cleaned = {
        llmConfig: cleanedLLMConfig,
        language: settings.language,
        autoApprove: settings.autoApprove,
        promptTemplateId: settings.promptTemplateId,
        agentConfig: settings.agentConfig,
        providerConfigs: cleanedProviderConfigs,
        aiInstructions: settings.aiInstructions,
        onboardingCompleted: settings.onboardingCompleted,
      }

      await window.electronAPI.setSetting('app-settings', cleaned)
      this.cache = settings

      logger.settings.info('[SettingsService] Settings saved')
    } catch (e) {
      logger.settings.error('[SettingsService] Failed to save settings:', e)
      throw e
    }
  }

  async save<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    const current = this.cache || (await this.loadAll())
    const updated = { ...current, [key]: value } as AppSettings
    await this.saveAll(updated)
  }

  async get<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
    const settings = this.cache || (await this.loadAll())
    return settings[key]
  }

  getCached(): AppSettings | null {
    return this.cache
  }

  getDefaultSettings(): AppSettings {
    return {
      llmConfig: defaultLLMConfig,
      language: 'en',
      autoApprove: defaultAutoApprove,
      agentConfig: defaultAgentConfig,
      providerConfigs: generateDefaultProviderConfigs(),
      aiInstructions: '',
      onboardingCompleted: false,
    }
  }

  private mergeLLMConfig(saved?: Partial<LLMConfig>, providerConfigs?: Record<string, ProviderConfig>): LLMConfig {
    if (!saved) return defaultLLMConfig

    const providerId = saved.provider || 'openai'
    const providerConfig = providerConfigs?.[providerId] || {}
    const builtinDef = getBuiltinProvider(providerId)

    const merged: LLMConfig = {
      ...defaultLLMConfig,
      provider: providerId,
      model: saved.model || providerConfig.model || builtinDef?.defaultModel || defaultLLMConfig.model,
      apiKey: providerConfig.apiKey || '',
      baseUrl: providerConfig.baseUrl || builtinDef?.baseUrl,
      timeout: providerConfig.timeout || builtinDef?.defaults.timeout || 120000,
      parameters: {
        ...defaultLLMParameters,
        ...saved.parameters,
      },
    }

    // 获取适配器配置
    if (isBuiltinProvider(providerId)) {
      merged.adapterConfig = { ...getAdapterConfig(providerId) }
    } else {
      merged.adapterConfig = providerConfig.adapterConfig || { ...getAdapterConfig('openai') }
    }

    // 应用高级配置
    if (providerConfig.advanced && merged.adapterConfig) {
      this.applyAdvancedConfig(merged, providerConfig.advanced)
    }

    return merged
  }

  private applyAdvancedConfig(config: LLMConfig, advanced: AdvancedConfig): void {
    const adapter = config.adapterConfig!

    if (advanced.request) {
      adapter.request = {
        ...adapter.request,
        ...advanced.request,
        headers: { ...adapter.request.headers, ...advanced.request.headers },
        bodyTemplate: advanced.request.bodyTemplate || adapter.request.bodyTemplate,
      }
    }

    if (advanced.response) {
      adapter.response = {
        ...adapter.response,
        ...advanced.response,
      }
    }

    if (advanced.auth && config.apiKey) {
      const authType = advanced.auth.type
      if (authType === 'bearer') {
        adapter.request.headers['Authorization'] = `Bearer ${config.apiKey}`
      } else if (authType === 'header' && advanced.auth.headerName) {
        adapter.request.headers[advanced.auth.headerName] = config.apiKey
      }
    }

    config.advanced = advanced
  }

  private mergeProviderConfigs(saved?: Record<string, ProviderConfig>): Record<string, ProviderConfig> {
    const defaults = generateDefaultProviderConfigs()

    if (!saved) return defaults

    const merged: Record<string, ProviderConfig> = { ...defaults }

    for (const [id, config] of Object.entries(saved)) {
      if (isBuiltinProvider(id)) {
        merged[id] = {
          ...defaults[id],
          ...config,
        }
      } else {
        merged[id] = {
          ...config,
          adapterConfig: config.adapterConfig || getAdapterConfig('openai'),
        }
      }
    }

    return merged
  }

  clearCache(): void {
    this.cache = null
  }
}

export const settingsService = new SettingsService()

export { defaultLLMConfig, defaultLLMParameters, defaultAutoApprove, defaultAgentConfig, isBuiltinProvider }
