/**
 * 设置持久化服务
 * 
 * 职责：
 * - 从文件/localStorage 加载设置
 * - 保存设置到文件/localStorage
 * - 同步设置到主进程
 * 
 * 不负责：
 * - 状态管理（由 Zustand store 负责）
 * - 类型定义（由 schema 负责）
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@shared/utils/Logger'
import {
  SETTINGS,
  type SettingsState,
  type SettingKey,
  type SettingValue,
  type ProviderModelConfig,
  getAllDefaults,
} from '@shared/config/settings'
import {
  isBuiltinProvider,
  getBuiltinProvider,
  getAdapterConfig,
  cleanAdvancedConfig,
} from '@shared/config/providers'
import type { ProviderConfig, LLMConfig } from '@shared/config/types'

// ============================================
// 存储键
// ============================================

const STORAGE_KEYS = {
  APP: 'app-settings',
  EDITOR: 'editorConfig',
  SECURITY: 'securitySettings',
} as const

const LOCAL_CACHE_KEY = 'adnify-settings-cache'

// ============================================
// 深度合并
// ============================================

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key in source) {
    if (source[key] !== undefined) {
      const sourceVal = source[key]
      const targetVal = target[key]
      if (
        typeof sourceVal === 'object' &&
        sourceVal !== null &&
        !Array.isArray(sourceVal) &&
        typeof targetVal === 'object' &&
        targetVal !== null
      ) {
        (result as Record<string, unknown>)[key] = deepMerge(
          targetVal as object,
          sourceVal as object
        )
      } else {
        (result as Record<string, unknown>)[key] = sourceVal
      }
    }
  }
  return result
}

// ============================================
// Provider 配置处理
// ============================================

function cleanProviderConfig(
  providerId: string,
  config: ProviderConfig,
  isCurrentProvider: boolean
): Partial<ProviderConfig> | null {
  const isBuiltin = isBuiltinProvider(providerId)
  const cleaned: Partial<ProviderConfig> = {}

  if (config.apiKey) cleaned.apiKey = config.apiKey

  const builtinDef = getBuiltinProvider(providerId)
  if (config.baseUrl && config.baseUrl !== builtinDef?.baseUrl) {
    cleaned.baseUrl = config.baseUrl
  }

  if (isCurrentProvider && config.model) cleaned.model = config.model
  if (config.timeout && config.timeout !== 120000) cleaned.timeout = config.timeout
  if (config.customModels?.length) cleaned.customModels = config.customModels

  if (config.advanced) {
    const cleanedAdvanced = cleanAdvancedConfig(providerId, config.advanced)
    if (cleanedAdvanced) cleaned.advanced = cleanedAdvanced
  }

  if (!isBuiltin) {
    if (config.adapterConfig) {
      const cleanedAdapter = { ...config.adapterConfig }
      if (cleanedAdapter.request?.headers) {
        const cleanedHeaders = { ...cleanedAdapter.request.headers }
        delete cleanedHeaders['Authorization']
        delete cleanedHeaders['authorization']
        delete cleanedHeaders['x-api-key']
        delete cleanedHeaders['X-Api-Key']
        cleanedAdapter.request = { ...cleanedAdapter.request, headers: cleanedHeaders }
      }
      cleaned.adapterConfig = cleanedAdapter
    }
    if (config.displayName) cleaned.displayName = config.displayName
    if (config.protocol) cleaned.protocol = config.protocol
    if (config.createdAt) cleaned.createdAt = config.createdAt
    if (config.updatedAt) cleaned.updatedAt = config.updatedAt
    if (config.baseUrl) cleaned.baseUrl = config.baseUrl
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null
}

function mergeProviderConfigs(
  saved: Record<string, ProviderConfig> | undefined
): Record<string, ProviderConfig> {
  const defaults = SETTINGS.providerConfigs.default
  if (!saved) return { ...defaults }

  const merged: Record<string, ProviderConfig> = { ...defaults }
  for (const [id, config] of Object.entries(saved)) {
    if (isBuiltinProvider(id)) {
      merged[id] = { ...defaults[id], ...config }
    } else {
      merged[id] = { ...config, adapterConfig: config.adapterConfig || getAdapterConfig('openai') }
    }
  }
  return merged
}

function mergeLLMConfig(
  saved: { provider: string; model: string } | undefined,
  providerConfigs: Record<string, ProviderConfig>
): LLMConfig {
  const defaults = SETTINGS.llmConfig.default
  if (!saved) return defaults

  const providerId = saved.provider || 'openai'
  const providerConfig = providerConfigs[providerId] || {}
  const builtinDef = getBuiltinProvider(providerId)

  const merged: LLMConfig = {
    ...defaults,
    provider: providerId,
    model: saved.model || providerConfig.model || builtinDef?.defaultModel || defaults.model,
    apiKey: providerConfig.apiKey || '',
    baseUrl: providerConfig.baseUrl || builtinDef?.baseUrl,
    timeout: providerConfig.timeout || builtinDef?.defaults.timeout || 120000,
    parameters: { ...defaults.parameters },
  }

  if (isBuiltinProvider(providerId)) {
    merged.adapterConfig = { ...getAdapterConfig(providerId) }
  } else {
    merged.adapterConfig = providerConfig.adapterConfig || { ...getAdapterConfig('openai') }
  }

  if (providerConfig.advanced && merged.adapterConfig) {
    if (providerConfig.advanced.request) {
      merged.adapterConfig.request = {
        ...merged.adapterConfig.request,
        ...providerConfig.advanced.request,
        headers: { ...merged.adapterConfig.request.headers, ...providerConfig.advanced.request.headers },
      }
    }
    if (providerConfig.advanced.response) {
      merged.adapterConfig.response = { ...merged.adapterConfig.response, ...providerConfig.advanced.response }
    }
    merged.advanced = providerConfig.advanced
  }

  return merged
}

// ============================================
// 设置服务
// ============================================

class SettingsService {
  private cache: SettingsState | null = null

  /** 加载所有设置 */
  async load(): Promise<SettingsState> {
    // 1. 尝试 localStorage 缓存
    try {
      const cached = localStorage.getItem(LOCAL_CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached)
        const merged = this.merge(parsed)
        this.cache = merged
        this.syncFromFile()
        return merged
      }
    } catch {
      // ignore
    }

    // 2. 从文件加载
    try {
      const [appSettings, editorConfig, securitySettings] = await Promise.all([
        api.settings.get(STORAGE_KEYS.APP),
        api.settings.get(STORAGE_KEYS.EDITOR),
        api.settings.get(STORAGE_KEYS.SECURITY),
      ])

      const merged = this.merge({
        ...(appSettings as object || {}),
        editorConfig,
        securitySettings,
      })
      this.cache = merged
      this.saveToLocalStorage(merged)
      return merged
    } catch (e) {
      logger.settings.error('[SettingsService] Load failed:', e)
      return getAllDefaults()
    }
  }

  /** 保存所有设置 */
  async save(settings: SettingsState): Promise<void> {
    try {
      // 清理 provider configs
      const cleanedProviderConfigs: Record<string, ProviderConfig> = {}
      for (const [id, config] of Object.entries(settings.providerConfigs)) {
        const cleaned = cleanProviderConfig(id, config, id === settings.llmConfig.provider)
        if (cleaned) cleanedProviderConfigs[id] = cleaned as ProviderConfig
      }

      // 构建 app-settings
      const appSettings = {
        llmConfig: {
          provider: settings.llmConfig.provider,
          model: settings.llmConfig.model,
        },
        language: settings.language,
        autoApprove: settings.autoApprove,
        promptTemplateId: settings.promptTemplateId,
        agentConfig: settings.agentConfig,
        providerConfigs: cleanedProviderConfigs,
        aiInstructions: settings.aiInstructions,
        onboardingCompleted: settings.onboardingCompleted,
        webSearchConfig: settings.webSearchConfig,
        mcpConfig: settings.mcpConfig,
        enableFileLogging: settings.enableFileLogging,
      }

      // 更新缓存
      this.cache = settings
      this.saveToLocalStorage(settings)

      // 写入文件
      await Promise.all([
        api.settings.set(STORAGE_KEYS.APP, appSettings),
        api.settings.set(STORAGE_KEYS.EDITOR, settings.editorConfig),
        api.settings.set(STORAGE_KEYS.SECURITY, settings.securitySettings),
      ])

      // 同步到主进程
      await this.syncToMain(settings)

      logger.settings.info('[SettingsService] Saved')
    } catch (e) {
      logger.settings.error('[SettingsService] Save failed:', e)
      throw e
    }
  }

  /** 保存单个设置 */
  async saveSingle<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
    const current = this.cache || await this.load()
    await this.save({ ...current, [key]: value })
  }

  /** 获取缓存 */
  getCache(): SettingsState | null {
    return this.cache
  }

  /** 清除缓存 */
  clearCache(): void {
    this.cache = null
    try {
      localStorage.removeItem(LOCAL_CACHE_KEY)
    } catch {
      // ignore
    }
  }

  // ============ 私有方法 ============

  private merge(saved: Record<string, unknown>): SettingsState {
    const defaults = getAllDefaults()
    const providerConfigs = mergeProviderConfigs(saved.providerConfigs as Record<string, ProviderConfig>)
    const llmConfig = mergeLLMConfig(saved.llmConfig as { provider: string; model: string }, providerConfigs)

    return {
      llmConfig,
      language: ((saved.language as string) || defaults.language) as 'en' | 'zh',
      autoApprove: { ...defaults.autoApprove, ...(saved.autoApprove as object || {}) },
      promptTemplateId: (saved.promptTemplateId as string) || defaults.promptTemplateId,
      providerConfigs: providerConfigs as Record<string, ProviderModelConfig>,
      agentConfig: { ...defaults.agentConfig, ...(saved.agentConfig as object || {}) },
      editorConfig: saved.editorConfig
        ? deepMerge(defaults.editorConfig, saved.editorConfig as object)
        : defaults.editorConfig,
      securitySettings: saved.securitySettings
        ? deepMerge(defaults.securitySettings, saved.securitySettings as object)
        : defaults.securitySettings,
      webSearchConfig: { ...defaults.webSearchConfig, ...(saved.webSearchConfig as object || {}) },
      mcpConfig: { ...defaults.mcpConfig, ...(saved.mcpConfig as object || {}) },
      aiInstructions: (saved.aiInstructions as string) || defaults.aiInstructions,
      onboardingCompleted: typeof saved.onboardingCompleted === 'boolean' 
        ? saved.onboardingCompleted 
        : defaults.onboardingCompleted,
      enableFileLogging: typeof saved.enableFileLogging === 'boolean'
        ? saved.enableFileLogging
        : defaults.enableFileLogging,
    }
  }

  private async syncFromFile(): Promise<void> {
    try {
      const [appSettings, editorConfig, securitySettings] = await Promise.all([
        api.settings.get(STORAGE_KEYS.APP),
        api.settings.get(STORAGE_KEYS.EDITOR),
        api.settings.get(STORAGE_KEYS.SECURITY),
      ])

      if (appSettings || editorConfig || securitySettings) {
        const merged = this.merge({
          ...(appSettings as object || {}),
          editorConfig,
          securitySettings,
        })
        this.cache = merged
        this.saveToLocalStorage(merged)
      }
    } catch {
      // ignore
    }
  }

  private saveToLocalStorage(settings: SettingsState): void {
    try {
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({
        llmConfig: { provider: settings.llmConfig.provider, model: settings.llmConfig.model },
        language: settings.language,
        autoApprove: settings.autoApprove,
        promptTemplateId: settings.promptTemplateId,
        agentConfig: settings.agentConfig,
        providerConfigs: settings.providerConfigs,
        aiInstructions: settings.aiInstructions,
        onboardingCompleted: settings.onboardingCompleted,
        editorConfig: settings.editorConfig,
        securitySettings: settings.securitySettings,
        webSearchConfig: settings.webSearchConfig,
        mcpConfig: settings.mcpConfig,
        enableFileLogging: settings.enableFileLogging,
      }))
    } catch {
      // ignore
    }
  }

  private async syncToMain(settings: SettingsState): Promise<void> {
    const promises: Promise<unknown>[] = []

    // 同步 Google Search
    if (settings.webSearchConfig.googleApiKey && settings.webSearchConfig.googleCx) {
      promises.push(
        api.http.setGoogleSearch(settings.webSearchConfig.googleApiKey, settings.webSearchConfig.googleCx)
      )
    }

    // 同步 MCP 自动连接
    promises.push(api.mcp.setAutoConnect(settings.mcpConfig.autoConnect ?? true))

    await Promise.all(promises)
  }
}

export const settingsService = new SettingsService()


// ============================================
// 便捷函数
// ============================================

/** 获取编辑器配置（同步） */
export function getEditorConfig(): SettingsState['editorConfig'] {
  return settingsService.getCache()?.editorConfig || SETTINGS.editorConfig.default
}

/** 保存编辑器配置 */
export function saveEditorConfig(config: Partial<SettingsState['editorConfig']>): void {
  const current = settingsService.getCache()
  if (current) {
    const merged = deepMerge(current.editorConfig, config)
    settingsService.saveSingle('editorConfig', merged).catch((err) => {
      logger.settings.error('Failed to save editor config:', err)
    })
  }
}

/** 重置编辑器配置 */
export function resetEditorConfig(): void {
  settingsService.saveSingle('editorConfig', SETTINGS.editorConfig.default).catch((err) => {
    logger.settings.error('Failed to reset editor config:', err)
  })
}
