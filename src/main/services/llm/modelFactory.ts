/**
 * Model Factory - 统一创建各协议的 LLM model 实例
 *
 * 使用 Vercel AI SDK，根据 provider 配置创建对应的 model
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { LLMConfig } from '@shared/types/llm'
import { BUILTIN_PROVIDERS, isBuiltinProvider } from '@shared/config/providers'

export interface ModelOptions {
    enableThinking?: boolean
}

/**
 * 根据配置创建 AI SDK model 实例
 */
export function createModel(config: LLMConfig, options: ModelOptions = {}): LanguageModel {
    const { provider, model, apiKey, baseUrl } = config

    // 内置 provider
    if (isBuiltinProvider(provider)) {
        return createBuiltinModel(config, options)
    }

    // 自定义 provider - 根据 protocol 选择
    const protocol = config.protocol || 'openai'
    return createCustomModel(protocol, model, apiKey, baseUrl, options)
}

/**
 * 创建内置 provider 的 model
 */
function createBuiltinModel(
    config: LLMConfig,
    _options: ModelOptions = {}
): LanguageModel {
    const { provider, model, apiKey, baseUrl } = config
    const providerDef = BUILTIN_PROVIDERS[provider]
    if (!providerDef) {
        throw new Error(`Unknown builtin provider: ${provider}`)
    }

    switch (provider) {
        case 'openai': {
            const openai = createOpenAI({
                apiKey,
                baseURL: baseUrl || providerDef.baseUrl,
            })

            // 基于 protocol 选择 API 端点
            if (config.protocol === 'openai-responses') {
                // Responses API (/v1/responses)
                return openai.responses(model)
            } else {
                // Chat Completions API (/v1/chat/completions) - 默认
                return openai.chat(model)
            }
        }

        case 'anthropic': {
            const anthropic = createAnthropic({
                apiKey,
                baseURL: baseUrl || undefined,
            })
            // Anthropic 直接调用就是 messages API，无需 .chat()
            return anthropic(model)
        }

        case 'gemini': {
            const google = createGoogleGenerativeAI({
                apiKey,
                baseURL: baseUrl || undefined,
            })
            // Google 直接调用就是 generateContent API，无需 .chat()
            return google(model)
        }

        default:
            throw new Error(`Unsupported builtin provider: ${provider}`)
    }
}

/**
 * 创建自定义 provider 的 model
 */
function createCustomModel(
    protocol: string,
    model: string,
    apiKey: string,
    baseUrl?: string,
    _options: ModelOptions = {}
): LanguageModel {
    if (!baseUrl) {
        throw new Error('Custom provider requires baseUrl')
    }

    switch (protocol) {
        case 'openai': {
            const provider = createOpenAICompatible({
                name: 'custom-openai',
                apiKey,
                baseURL: baseUrl,
            })
            return provider(model)
        }

        case 'openai-responses': {
            // Response API 需要使用 @ai-sdk/openai（非 compatible）
            const openai = createOpenAI({
                apiKey,
                baseURL: baseUrl,
            })
            return openai.responses(model)
        }

        case 'anthropic': {
            const anthropic = createAnthropic({
                apiKey,
                baseURL: baseUrl,
            })
            return anthropic(model)
        }

        case 'google': {
            const google = createGoogleGenerativeAI({
                apiKey,
                baseURL: baseUrl,
            })
            return google(model)
        }

        default: {
            const fallback = createOpenAICompatible({
                name: 'custom',
                apiKey,
                baseURL: baseUrl,
            })
            return fallback(model)
        }
    }
}
