/**
 * 统一设置服务
 * 集中管理所有应用设置的加载、保存和清理
 */

import { LLM_DEFAULTS } from '@/shared/constants'
import { PROVIDERS, getAdapterConfig, type LLMAdapterConfig } from '@/shared/config/providers'

// ============ 类型定义 ============

/** LLM 参数配置 */
export interface LLMParameters {
    temperature: number
    topP: number
    maxTokens: number
    frequencyPenalty?: number
    presencePenalty?: number
}

/** LLM 配置 */
export interface LLMConfig {
    provider: string
    model: string
    apiKey: string
    baseUrl?: string
    timeout?: number
    adapterId?: string
    adapterConfig?: LLMAdapterConfig
    parameters?: LLMParameters
    thinkingEnabled?: boolean
    thinkingBudget?: number
}

/** Provider 配置 */
export interface ProviderConfig {
    apiKey?: string
    baseUrl?: string
    model?: string
    timeout?: number
    adapterId?: string
    adapterConfig?: LLMAdapterConfig
    customModels?: string[]
}

/** 自动审批设置 */
export interface AutoApproveSettings {
    terminal: boolean
    dangerous: boolean
}

/** Agent 配置 */
export interface AgentConfig {
    maxToolLoops: number
    maxHistoryMessages: number
    maxToolResultChars: number
    maxFileContentChars: number
    maxTotalContextChars: number
    enableAutoFix: boolean
    maxContextFiles: number
    maxSemanticResults: number
    maxTerminalChars: number
    maxSingleFileChars: number
}

/** 编辑器设置 */
export interface EditorSettings {
    fontSize: number
    tabSize: number
    wordWrap: string
    lineNumbers: string
    minimap: boolean
    bracketPairColorization: boolean
    formatOnSave: boolean
    autoSave: string
    theme: string
    completionEnabled: boolean
    completionDebounceMs: number
    completionMaxTokens: number
}

/** 安全设置 */
export interface SecuritySettings {
    strictWorkspaceMode: boolean
    enableAuditLog: boolean
    allowedPaths: string[]
    blockedCommands: string[]
}

/** 嵌入配置 */
export interface EmbeddingConfig {
    provider: string
    apiKey?: string
}

/** 完整的应用设置 */
export interface AppSettings {
    llmConfig: LLMConfig
    language: string
    autoApprove: AutoApproveSettings
    promptTemplateId?: string
    agentConfig: AgentConfig
    providerConfigs: Record<string, ProviderConfig>
    editorSettings: EditorSettings
    aiInstructions: string
    onboardingCompleted: boolean
    securitySettings?: SecuritySettings
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
    maxToolResultChars: 10000,
    maxFileContentChars: 15000,
    maxTotalContextChars: 60000,
    enableAutoFix: true,
    maxContextFiles: 6,
    maxSemanticResults: 5,
    maxTerminalChars: 3000,
    maxSingleFileChars: 6000,
}

const defaultEditorSettings: EditorSettings = {
    fontSize: 13,
    tabSize: 2,
    wordWrap: 'on',
    lineNumbers: 'on',
    minimap: true,
    bracketPairColorization: true,
    formatOnSave: true,
    autoSave: 'off',
    theme: 'adnify-dark',
    completionEnabled: true,
    completionDebounceMs: 300,
    completionMaxTokens: 256,
}

// 生成所有 Provider 的默认配置
const generateDefaultProviderConfigs = (): Record<string, ProviderConfig> => {
    const configs: Record<string, ProviderConfig> = {}
    for (const provider of Object.values(PROVIDERS)) {
        configs[provider.id] = {
            adapterId: provider.id,
            adapterConfig: provider.adapter,
            model: provider.models.recommended,
            baseUrl: provider.endpoint.default,
        }
    }
    return configs
}

// ============ 清理工具函数 ============

/** 移除对象中的空值 */
function cleanObject<T extends Record<string, unknown>>(obj: T): Partial<T> {
    const cleaned: Partial<T> = {}
    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined || value === null || value === '') continue
        if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0) continue
        if (Array.isArray(value) && value.length === 0) continue
        cleaned[key as keyof T] = value as T[keyof T]
    }
    return cleaned
}

/** 清理 Provider 配置 */
function cleanProviderConfig(config: ProviderConfig): Partial<ProviderConfig> {
    const cleaned = cleanObject(config as Record<string, unknown>) as Partial<ProviderConfig>
    // 移除默认超时值
    if (cleaned.timeout === 120000) delete cleaned.timeout
    // 移除空的 customModels
    if (Array.isArray(cleaned.customModels) && cleaned.customModels.length === 0) {
        delete cleaned.customModels
    }
    return cleaned
}

/** 清理 LLM 配置 */
function cleanLLMConfig(config: LLMConfig): LLMConfig {
    const cleaned = { ...config }
    if (!cleaned.baseUrl) delete cleaned.baseUrl
    if (cleaned.timeout === 120000) delete cleaned.timeout
    // parameters 保留，但清理默认值
    if (cleaned.parameters) {
        const { temperature, topP, maxTokens, ...rest } = cleaned.parameters
        cleaned.parameters = {
            ...rest,
            temperature: temperature ?? LLM_DEFAULTS.TEMPERATURE,
            topP: topP ?? LLM_DEFAULTS.TOP_P,
            maxTokens: maxTokens ?? LLM_DEFAULTS.MAX_TOKENS,
        }
    }
    return cleaned
}

/** 清理所有 Provider 配置，只保留有意义的数据 */
function cleanProviderConfigs(
    configs: Record<string, ProviderConfig>,
    currentProvider: string
): Record<string, ProviderConfig> {
    const cleaned: Record<string, ProviderConfig> = {}

    for (const [id, config] of Object.entries(configs)) {
        const cleanedConfig = cleanProviderConfig(config)

        // 当前 Provider 始终保留
        if (id === currentProvider) {
            if (Object.keys(cleanedConfig).length > 0) {
                cleaned[id] = cleanedConfig as ProviderConfig
            }
        } else {
            // 其他 Provider：只有有实质性配置时才保存
            if (cleanedConfig.apiKey || cleanedConfig.baseUrl || cleanedConfig.adapterConfig ||
                (cleanedConfig.customModels && cleanedConfig.customModels.length > 0)) {
                cleaned[id] = cleanedConfig as ProviderConfig
            }
        }
    }

    return cleaned
}

// ============ 设置服务类 ============

class SettingsService {
    private cache: AppSettings | null = null

    /** 加载所有设置 */
    async loadAll(): Promise<AppSettings> {
        try {
            const settings = await window.electronAPI.getSetting('app-settings') as Partial<AppSettings> | null

            if (!settings) {
                return this.getDefaultSettings()
            }

            // 合并默认值
            const merged: AppSettings = {
                llmConfig: this.mergeLLMConfig(settings.llmConfig),
                language: settings.language || 'en',
                autoApprove: { ...defaultAutoApprove, ...settings.autoApprove },
                promptTemplateId: settings.promptTemplateId,
                agentConfig: { ...defaultAgentConfig, ...settings.agentConfig },
                providerConfigs: this.mergeProviderConfigs(settings.providerConfigs),
                editorSettings: { ...defaultEditorSettings, ...settings.editorSettings },
                aiInstructions: settings.aiInstructions || '',
                onboardingCompleted: settings.onboardingCompleted ?? false,
                securitySettings: settings.securitySettings,
            }

            this.cache = merged
            return merged
        } catch (e) {
            console.error('[SettingsService] Failed to load settings:', e)
            return this.getDefaultSettings()
        }
    }

    /** 保存所有设置 */
    async saveAll(settings: AppSettings): Promise<void> {
        try {
            // 清理数据
            const cleaned: AppSettings = {
                ...settings,
                llmConfig: cleanLLMConfig(settings.llmConfig),
                providerConfigs: cleanProviderConfigs(
                    settings.providerConfigs,
                    settings.llmConfig.provider
                ),
            }

            await window.electronAPI.setSetting('app-settings', cleaned)
            this.cache = cleaned

            console.log('[SettingsService] Settings saved successfully')
        } catch (e) {
            console.error('[SettingsService] Failed to save settings:', e)
            throw e
        }
    }

    /** 保存单个设置项 */
    async save<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
        const current = this.cache || await this.loadAll()
        const updated = { ...current, [key]: value } as AppSettings
        await this.saveAll(updated)
    }

    /** 获取单个设置项 */
    async get<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
        const settings = this.cache || await this.loadAll()
        return settings[key]
    }

    /** 获取缓存的设置（同步） */
    getCached(): AppSettings | null {
        return this.cache
    }

    /** 获取默认设置 */
    getDefaultSettings(): AppSettings {
        return {
            llmConfig: defaultLLMConfig,
            language: 'en',
            autoApprove: defaultAutoApprove,
            agentConfig: defaultAgentConfig,
            providerConfigs: generateDefaultProviderConfigs(),
            editorSettings: defaultEditorSettings,
            aiInstructions: '',
            onboardingCompleted: false,
        }
    }

    /** 合并 LLM 配置 */
    private mergeLLMConfig(saved?: Partial<LLMConfig>): LLMConfig {
        if (!saved) return defaultLLMConfig

        const merged: LLMConfig = {
            ...defaultLLMConfig,
            ...saved,
            parameters: {
                ...defaultLLMParameters,
                ...saved.parameters,
            },
        }

        // 如果没有 adapterConfig 但有 adapterId，使用内置预设
        if (!merged.adapterConfig && merged.adapterId) {
            const preset = getAdapterConfig(merged.adapterId)
            if (preset) {
                merged.adapterConfig = preset
            }
        }

        return merged
    }

    /** 合并 Provider 配置 */
    private mergeProviderConfigs(saved?: Record<string, ProviderConfig>): Record<string, ProviderConfig> {
        const defaults = generateDefaultProviderConfigs()

        if (!saved) return defaults

        const merged: Record<string, ProviderConfig> = { ...defaults }
        for (const [id, config] of Object.entries(saved)) {
            merged[id] = {
                ...defaults[id],
                ...config,
            }
        }

        return merged
    }

    /** 清除缓存 */
    clearCache(): void {
        this.cache = null
    }
}

// 导出单例
export const settingsService = new SettingsService()

// 导出默认值供其他模块使用
export {
    defaultLLMConfig,
    defaultLLMParameters,
    defaultAutoApprove,
    defaultAgentConfig,
    defaultEditorSettings,
    generateDefaultProviderConfigs,
}
