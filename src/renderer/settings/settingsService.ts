/**
 * 统一设置服务
 * 
 * 集中管理所有应用设置的加载、保存和清理
 * 合并了原来分散的 settingsService 和 editorConfig 逻辑
 * 
 * 存储策略：
 * - localStorage: 快速读取，应用启动时优先使用
 * - 文件 (electron-store): 持久化备份，跨设备同步
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import {
  isBuiltinProvider,
  getBuiltinProvider,
  getAdapterConfig,
  cleanAdvancedConfig,
} from '@shared/config/providers'
import type {
  LLMConfig,
  AgentConfig,
  AutoApproveSettings,
  EditorConfig,
  ProviderConfig,
  SecuritySettings,
  AppSettings,
  RuntimeSettings,
} from '@shared/config/types'
import {
  defaultLLMConfig,
  defaultLLMParameters,
  defaultAgentConfig,
  defaultAutoApprove,
  defaultEditorConfig,
  defaultSecuritySettings,
  defaultProviderConfigs,
} from './defaults'

// ============================================
// 存储 Key
// ============================================

const STORAGE_KEYS = {
  APP_SETTINGS: 'app-settings',
  EDITOR_CONFIG: 'editorConfig',
  SECURITY_SETTINGS: 'securitySettings',
} as const

const LOCAL_STORAGE_KEY = 'adnify-settings-cache'

// ============================================
// 内部类型（用于文件存储）
// ============================================

interface SavedAppSettings {
  llmConfig?: { provider: string; model: string }
  language?: string
  autoApprove?: AutoApproveSettings
  promptTemplateId?: string
  agentConfig?: Partial<AgentConfig>
  providerConfigs?: Record<string, ProviderConfig>
  aiInstructions?: string
  onboardingCompleted?: boolean
}

// ============================================
// 清理函数
// ============================================

function cleanAgentConfig(config: AgentConfig): AgentConfig {
  return {
    maxToolLoops: config.maxToolLoops,
    maxHistoryMessages: config.maxHistoryMessages,
    maxToolResultChars: config.maxToolResultChars,
    maxFileContentChars: config.maxFileContentChars,
    maxTotalContextChars: config.maxTotalContextChars,
    maxContextTokens: config.maxContextTokens,
    maxSingleFileChars: config.maxSingleFileChars,
    maxContextFiles: config.maxContextFiles,
    maxSemanticResults: config.maxSemanticResults,
    maxTerminalChars: config.maxTerminalChars,
    maxRetries: config.maxRetries,
    retryDelayMs: config.retryDelayMs,
    toolTimeoutMs: config.toolTimeoutMs,
    enableAutoFix: config.enableAutoFix,
    keepRecentTurns: config.keepRecentTurns,
    deepCompressionTurns: config.deepCompressionTurns,
    maxImportantOldTurns: config.maxImportantOldTurns,
    enableLLMSummary: config.enableLLMSummary,
    autoHandoff: config.autoHandoff,
    loopDetection: {
      maxHistory: config.loopDetection.maxHistory,
      maxExactRepeats: config.loopDetection.maxExactRepeats,
      maxSameTargetRepeats: config.loopDetection.maxSameTargetRepeats,
    },
    ignoredDirectories: config.ignoredDirectories,
  }
}

function cleanEditorConfig(config: EditorConfig): EditorConfig {
  return {
    fontSize: config.fontSize,
    fontFamily: config.fontFamily,
    tabSize: config.tabSize,
    wordWrap: config.wordWrap,
    lineHeight: config.lineHeight,
    minimap: config.minimap,
    minimapScale: config.minimapScale,
    lineNumbers: config.lineNumbers,
    bracketPairColorization: config.bracketPairColorization,
    formatOnSave: config.formatOnSave,
    autoSave: config.autoSave,
    autoSaveDelay: config.autoSaveDelay,
    terminal: { ...config.terminal },
    git: { ...config.git },
    lsp: { ...config.lsp },
    performance: { ...config.performance },
    ai: { ...config.ai },
  }
}

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

function cleanProviderConfigs(
  configs: Record<string, ProviderConfig>,
  currentProvider: string
): Record<string, ProviderConfig> {
  const cleaned: Record<string, ProviderConfig> = {}
  for (const [id, config] of Object.entries(configs)) {
    const cleanedConfig = cleanProviderConfig(id, config, id === currentProvider)
    if (cleanedConfig) cleaned[id] = cleanedConfig as ProviderConfig
  }
  return cleaned
}

// ============================================
// 深度合并
// ============================================

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        target[key] !== null
      ) {
        (result as Record<string, unknown>)[key] = deepMerge(
          target[key] as object,
          source[key] as object
        )
      } else {
        (result as Record<string, unknown>)[key] = source[key]
      }
    }
  }
  return result
}

// ============================================
// 设置服务类
// ============================================

class SettingsService {
  private cache: RuntimeSettings | null = null

  /**
   * 加载全部设置
   */
  async loadAll(): Promise<RuntimeSettings> {
    // 1. 尝试从 localStorage 读取缓存
    try {
      const cached = localStorage.getItem(LOCAL_STORAGE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached) as SavedAppSettings & {
          editorConfig?: Partial<EditorConfig>
          securitySettings?: Partial<SecuritySettings>
        }
        const merged = this.mergeSettings(parsed)
        this.cache = merged
        // 异步从文件同步
        this.syncFromFile().catch(() => {})
        return merged
      }
    } catch {
      // 忽略
    }

    // 2. 从文件读取
    try {
      const [appSettings, editorConfig, securitySettings] = await Promise.all([
        api.settings.get(STORAGE_KEYS.APP_SETTINGS) as Promise<SavedAppSettings | null>,
        api.settings.get(STORAGE_KEYS.EDITOR_CONFIG) as Promise<Partial<EditorConfig> | null>,
        api.settings.get(STORAGE_KEYS.SECURITY_SETTINGS) as Promise<Partial<SecuritySettings> | null>,
      ])

      const merged = this.mergeSettings({
        ...appSettings,
        editorConfig: editorConfig || undefined,
        securitySettings: securitySettings || undefined,
      })
      this.cache = merged
      this.saveToLocalStorage(merged)
      return merged
    } catch (e) {
      logger.settings.error('[SettingsService] Failed to load:', e)
      return this.getDefaultSettings()
    }
  }

  /**
   * 保存全部设置
   */
  async saveAll(settings: RuntimeSettings): Promise<void> {
    try {
      const cleanedAgentConfig = cleanAgentConfig(settings.agentConfig)
      const cleanedEditorConfig = cleanEditorConfig(settings.editorConfig)
      const cleanedProviderConfigs = cleanProviderConfigs(settings.providerConfigs, settings.llmConfig.provider)

      // 分开保存到不同的 key
      const appSettings: Partial<AppSettings> = {
        llmConfig: {
          provider: settings.llmConfig.provider,
          model: settings.llmConfig.model,
        },
        language: settings.language,
        autoApprove: settings.autoApprove,
        promptTemplateId: settings.promptTemplateId,
        agentConfig: cleanedAgentConfig,
        providerConfigs: cleanedProviderConfigs,
        aiInstructions: settings.aiInstructions,
        onboardingCompleted: settings.onboardingCompleted,
      }

      // 更新缓存
      this.cache = settings
      this.saveToLocalStorage(settings)

      // 异步写入文件
      await Promise.all([
        api.settings.set(STORAGE_KEYS.APP_SETTINGS, appSettings),
        api.settings.set(STORAGE_KEYS.EDITOR_CONFIG, cleanedEditorConfig),
        api.settings.set(STORAGE_KEYS.SECURITY_SETTINGS, settings.securitySettings),
      ])

      logger.settings.info('[SettingsService] Settings saved')
    } catch (e) {
      logger.settings.error('[SettingsService] Failed to save:', e)
      throw e
    }
  }

  /**
   * 保存单个设置项
   */
  async save<K extends keyof RuntimeSettings>(key: K, value: RuntimeSettings[K]): Promise<void> {
    const current = this.cache || await this.loadAll()
    const updated = { ...current, [key]: value }
    await this.saveAll(updated)
  }

  /**
   * 获取单个设置项
   */
  async get<K extends keyof RuntimeSettings>(key: K): Promise<RuntimeSettings[K]> {
    const settings = this.cache || await this.loadAll()
    return settings[key]
  }

  /**
   * 获取缓存的设置
   */
  getCached(): RuntimeSettings | null {
    return this.cache
  }

  /**
   * 获取默认设置
   */
  getDefaultSettings(): RuntimeSettings {
    return {
      llmConfig: defaultLLMConfig,
      language: 'en',
      autoApprove: defaultAutoApprove,
      agentConfig: defaultAgentConfig,
      providerConfigs: defaultProviderConfigs,
      aiInstructions: '',
      onboardingCompleted: false,
      editorConfig: defaultEditorConfig,
      securitySettings: defaultSecuritySettings,
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache = null
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY)
    } catch {
      // 忽略
    }
  }

  // ============ 私有方法 ============

  private mergeSettings(saved: SavedAppSettings & {
    editorConfig?: Partial<EditorConfig>
    securitySettings?: Partial<SecuritySettings>
  }): RuntimeSettings {
    const providerConfigs = this.mergeProviderConfigs(saved.providerConfigs)
    const llmConfig = this.mergeLLMConfig(saved.llmConfig, providerConfigs)

    return {
      llmConfig,
      language: saved.language || 'en',
      autoApprove: { ...defaultAutoApprove, ...saved.autoApprove },
      promptTemplateId: saved.promptTemplateId,
      agentConfig: { ...defaultAgentConfig, ...saved.agentConfig },
      providerConfigs,
      aiInstructions: saved.aiInstructions || '',
      onboardingCompleted: saved.onboardingCompleted ?? false,
      editorConfig: saved.editorConfig ? deepMerge(defaultEditorConfig, saved.editorConfig) : defaultEditorConfig,
      securitySettings: saved.securitySettings ? deepMerge(defaultSecuritySettings, saved.securitySettings) : defaultSecuritySettings,
    }
  }

  private mergeLLMConfig(saved?: { provider: string; model: string }, providerConfigs?: Record<string, ProviderConfig>): LLMConfig {
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
      parameters: { ...defaultLLMParameters },
    }

    if (isBuiltinProvider(providerId)) {
      merged.adapterConfig = { ...getAdapterConfig(providerId) }
    } else {
      merged.adapterConfig = providerConfig.adapterConfig || { ...getAdapterConfig('openai') }
    }

    if (providerConfig.advanced && merged.adapterConfig) {
      this.applyAdvancedConfig(merged, providerConfig.advanced)
    }

    return merged
  }

  private applyAdvancedConfig(config: LLMConfig, advanced: import('@shared/config/providers').AdvancedConfig): void {
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
      adapter.response = { ...adapter.response, ...advanced.response }
    }

    config.advanced = advanced
  }

  private mergeProviderConfigs(saved?: Record<string, ProviderConfig>): Record<string, ProviderConfig> {
    if (!saved) return { ...defaultProviderConfigs }

    const merged: Record<string, ProviderConfig> = { ...defaultProviderConfigs }

    for (const [id, config] of Object.entries(saved)) {
      if (isBuiltinProvider(id)) {
        merged[id] = { ...defaultProviderConfigs[id], ...config }
      } else {
        merged[id] = { ...config, adapterConfig: config.adapterConfig || getAdapterConfig('openai') }
      }
    }

    return merged
  }

  private async syncFromFile(): Promise<void> {
    try {
      const [appSettings, editorConfig, securitySettings] = await Promise.all([
        api.settings.get(STORAGE_KEYS.APP_SETTINGS) as Promise<SavedAppSettings | null>,
        api.settings.get(STORAGE_KEYS.EDITOR_CONFIG) as Promise<Partial<EditorConfig> | null>,
        api.settings.get(STORAGE_KEYS.SECURITY_SETTINGS) as Promise<Partial<SecuritySettings> | null>,
      ])

      if (appSettings || editorConfig || securitySettings) {
        const merged = this.mergeSettings({
          ...appSettings,
          editorConfig: editorConfig || undefined,
          securitySettings: securitySettings || undefined,
        })
        this.cache = merged
        this.saveToLocalStorage(merged)
      }
    } catch {
      // 忽略同步错误
    }
  }

  private saveToLocalStorage(settings: RuntimeSettings): void {
    try {
      // 只保存必要数据
      const toSave = {
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
      }
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(toSave))
    } catch {
      // 忽略
    }
  }
}

// ============================================
// 导出单例
// ============================================

export const settingsService = new SettingsService()

// ============================================
// 便捷函数
// ============================================

/** 获取编辑器配置（同步） */
export function getEditorConfig(): EditorConfig {
  return settingsService.getCached()?.editorConfig || defaultEditorConfig
}

/** 保存编辑器配置 */
export function saveEditorConfig(config: Partial<EditorConfig>): void {
  const current = settingsService.getCached()
  if (current) {
    const merged = deepMerge(current.editorConfig, config)
    settingsService.save('editorConfig', merged).catch((err) => {
      logger.settings.error('Failed to save editor config:', err)
    })
  }
}

/** 重置编辑器配置 */
export function resetEditorConfig(): void {
  settingsService.save('editorConfig', defaultEditorConfig).catch((err) => {
    logger.settings.error('Failed to reset editor config:', err)
  })
}

// 重新导出类型和默认值
export type { LLMConfig, AgentConfig, AutoApproveSettings, EditorConfig, ProviderConfig, SecuritySettings, RuntimeSettings }
export { defaultLLMConfig, defaultAgentConfig, defaultAutoApprove, defaultEditorConfig, defaultSecuritySettings, defaultProviderConfigs }

// ============================================
// 配置导出/导入
// ============================================

export interface ExportedSettings {
  version: string
  exportedAt: string
  settings: Partial<AppSettings>
}

/**
 * 导出配置（不包含敏感信息如 API Key）
 */
export function exportSettings(settings: RuntimeSettings, includeApiKeys = false): ExportedSettings {
  const exported: Partial<AppSettings> = {
    language: settings.language,
    autoApprove: settings.autoApprove,
    promptTemplateId: settings.promptTemplateId,
    agentConfig: settings.agentConfig,
    aiInstructions: settings.aiInstructions,
    llmConfig: {
      provider: settings.llmConfig.provider,
      model: settings.llmConfig.model,
    },
    providerConfigs: {},
  }

  // 处理 provider 配置
  for (const [id, config] of Object.entries(settings.providerConfigs)) {
    const cleanedConfig: ProviderConfig = {
      model: config.model,
      baseUrl: config.baseUrl,
      timeout: config.timeout,
      customModels: config.customModels,
      advanced: config.advanced,
    }
    
    // 可选包含 API Key
    if (includeApiKeys && config.apiKey) {
      cleanedConfig.apiKey = config.apiKey
    }
    
    // 自定义 provider 的额外字段
    if (!isBuiltinProvider(id)) {
      cleanedConfig.displayName = config.displayName
      cleanedConfig.protocol = config.protocol
      cleanedConfig.adapterConfig = config.adapterConfig
    }
    
    exported.providerConfigs![id] = cleanedConfig
  }

  return {
    version: 'export-v1',
    exportedAt: new Date().toISOString(),
    settings: exported,
  }
}

/**
 * 导出配置为 JSON 字符串
 */
export function exportSettingsToJSON(settings: RuntimeSettings, includeApiKeys = false): string {
  const exported = exportSettings(settings, includeApiKeys)
  return JSON.stringify(exported, null, 2)
}

/**
 * 从 JSON 导入配置
 */
export function importSettingsFromJSON(json: string): { success: boolean; settings?: Partial<AppSettings>; error?: string } {
  try {
    const parsed = JSON.parse(json) as ExportedSettings
    
    // 验证版本
    if (!parsed.version || !parsed.settings) {
      return { success: false, error: 'Invalid settings file format' }
    }
    
    // 验证必要字段
    const settings = parsed.settings
    if (typeof settings !== 'object') {
      return { success: false, error: 'Invalid settings data' }
    }
    
    return { success: true, settings }
  } catch (e) {
    return { success: false, error: `Failed to parse JSON: ${e instanceof Error ? e.message : 'Unknown error'}` }
  }
}

/**
 * 下载配置文件
 */
export function downloadSettings(settings: RuntimeSettings, includeApiKeys = false): void {
  const json = exportSettingsToJSON(settings, includeApiKeys)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  
  const a = document.createElement('a')
  a.href = url
  a.download = `adnify-settings-${new Date().toISOString().split('T')[0]}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
