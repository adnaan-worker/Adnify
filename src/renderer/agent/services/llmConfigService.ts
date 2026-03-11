/**
 * LLM 配置服务
 * 
 * 职责：从 Store 获取完整的 LLM 配置（包括 apiKey）
 * 用于 Orchestrator 任务执行
 */

import { useStore } from '@store'
import { getBuiltinProvider, getProviderDefaultModel, BUILTIN_PROVIDERS } from '@shared/config/providers'
import type { LLMConfig } from '@shared/types/llm'

export interface ProviderModelContext {
  providerId: string
  defaultModel: string
  availableModels: string[]
}

/**
 * 获取任务执行所需的 LLM 配置
 * 
 * @param providerId - 提供商 ID（如 'anthropic', 'openai'）
 * @param modelId - 模型 ID（如 'claude-sonnet-4-20250514'）
 * @returns 完整的 LLM 配置，包含 apiKey
 */
export async function getLLMConfigForTask(
    providerId: string,
    modelId: string
): Promise<LLMConfig | null> {
    const store = useStore.getState()

    const providerConfig = store.providerConfigs[providerId]
    const builtinProvider = getBuiltinProvider(providerId)

    if (!providerConfig?.apiKey && !builtinProvider) {
        return null
    }

    const apiKey = providerConfig?.apiKey || ''
    if (!apiKey) {
        const defaultConfig = store.llmConfig
        if (defaultConfig.provider === providerId && defaultConfig.apiKey) {
            return {
                provider: providerId,
                model: modelId,
                apiKey: defaultConfig.apiKey,
                baseUrl: providerConfig?.baseUrl || builtinProvider?.baseUrl,
                maxTokens: builtinProvider?.defaults?.maxTokens || 8192,
                temperature: builtinProvider?.defaults?.temperature || 0.7,
                protocol: providerConfig?.protocol || builtinProvider?.protocol,
            }
        }
        return null
    }

    return {
        provider: providerId,
        model: modelId,
        apiKey,
        baseUrl: providerConfig?.baseUrl || builtinProvider?.baseUrl,
        maxTokens: builtinProvider?.defaults?.maxTokens || 8192,
        temperature: builtinProvider?.defaults?.temperature || 0.7,
        protocol: providerConfig?.protocol || builtinProvider?.protocol,
    }
}

export function getProviderModelContext(providerId: string): ProviderModelContext {
    const store = useStore.getState()
    const providerConfig = store.providerConfigs[providerId]
    const configuredModel = providerConfig?.model
        || (store.llmConfig.provider === providerId ? store.llmConfig.model : '')
        || getProviderDefaultModel(providerId)
    const availableModels = getAvailableModels(providerId)

    if (configuredModel && !availableModels.includes(configuredModel)) {
        availableModels.unshift(configuredModel)
    }

    return {
        providerId,
        defaultModel: configuredModel,
        availableModels,
    }
}

/**
 * 获取可用的提供商列表（有 API Key 的）
 */
export function getAvailableProviders(): string[] {
    const store = useStore.getState()
    const available: string[] = []

    for (const providerId of Object.keys(BUILTIN_PROVIDERS)) {
        const config = store.providerConfigs[providerId]
        if (config?.apiKey) {
            available.push(providerId)
        }
    }

    const defaultConfig = store.llmConfig
    if (defaultConfig.apiKey && !available.includes(defaultConfig.provider)) {
        available.push(defaultConfig.provider)
    }

    return available
}

/**
 * 获取提供商的可用模型列表
 */
export function getAvailableModels(providerId: string): string[] {
    const store = useStore.getState()
    const builtinProvider = getBuiltinProvider(providerId)
    const userConfig = store.providerConfigs[providerId]

    const models: string[] = []

    if (builtinProvider?.models) {
        models.push(...builtinProvider.models)
    }

    if (userConfig?.customModels) {
        for (const model of userConfig.customModels) {
            if (!models.includes(model)) {
                models.push(model)
            }
        }
    }

    return models
}
