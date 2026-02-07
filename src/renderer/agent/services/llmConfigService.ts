/**
 * LLM 配置服务
 * 
 * 职责：从 Store 获取完整的 LLM 配置（包括 apiKey）
 * 用于 Orchestrator 任务执行
 */

import { useStore } from '@store'
import { getBuiltinProvider, BUILTIN_PROVIDERS } from '@shared/config/providers'
import type { LLMConfig } from '@shared/types/llm'

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

    // 获取用户配置的提供商信息
    const providerConfig = store.providerConfigs[providerId]

    // 获取内置提供商定义
    const builtinProvider = getBuiltinProvider(providerId)

    if (!providerConfig?.apiKey && !builtinProvider) {
        return null
    }

    // 获取 API Key（优先使用用户配置）
    const apiKey = providerConfig?.apiKey || ''
    if (!apiKey) {
        // 如果没有 API Key，检查是否可以使用默认配置
        const defaultConfig = store.llmConfig
        if (defaultConfig.provider === providerId && defaultConfig.apiKey) {
            // 使用默认配置的 API Key
            return {
                provider: providerId,
                model: modelId,
                apiKey: defaultConfig.apiKey,
                baseUrl: providerConfig?.baseUrl || builtinProvider?.baseUrl,
                maxTokens: builtinProvider?.defaults?.maxTokens || 8192,
                temperature: builtinProvider?.defaults?.temperature || 0.7,
                protocol: builtinProvider?.protocol,
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
        protocol: builtinProvider?.protocol,
    }
}

/**
 * 获取可用的提供商列表（有 API Key 的）
 */
export function getAvailableProviders(): string[] {
    const store = useStore.getState()
    const available: string[] = []

    // 检查每个内置提供商
    for (const providerId of Object.keys(BUILTIN_PROVIDERS)) {
        const config = store.providerConfigs[providerId]
        if (config?.apiKey) {
            available.push(providerId)
        }
    }

    // 检查默认配置
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

    // 添加内置模型
    if (builtinProvider?.models) {
        models.push(...builtinProvider.models)
    }

    // 添加用户自定义模型
    if (userConfig?.customModels) {
        for (const model of userConfig.customModels) {
            if (!models.includes(model)) {
                models.push(model)
            }
        }
    }

    return models
}
