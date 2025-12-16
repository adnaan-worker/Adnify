/**
 * LLM 服务
 * 统一管理 LLM Provider，处理消息发送和事件分发
 */

import { BrowserWindow } from 'electron'
import { OpenAIProvider } from './providers/openai'
import { AnthropicProvider } from './providers/anthropic'
import { GeminiProvider } from './providers/gemini'
import { LLMProvider, LLMMessage, LLMConfig, ToolDefinition, LLMError, LLMErrorCode } from './types'

export class LLMService {
	private window: BrowserWindow
	private providers: Map<string, LLMProvider> = new Map()
	private currentAbortController: AbortController | null = null

	constructor(window: BrowserWindow) {
		this.window = window
	}

	/**
	 * 获取或创建 Provider 实例
	 * 使用 provider + apiKey + baseUrl 作为缓存 key
	 */
	private getProvider(config: LLMConfig): LLMProvider {
		const key = `${config.provider}-${config.apiKey}-${config.baseUrl || 'default'}-${config.timeout || 'default'}`

		if (!this.providers.has(key)) {
			console.log('[LLMService] Creating new provider:', config.provider, 'timeout:', config.timeout)

			switch (config.provider) {
				case 'openai':
				case 'custom':
					this.providers.set(key, new OpenAIProvider(config.apiKey, config.baseUrl, config.timeout))
					break
				case 'anthropic':
					this.providers.set(key, new AnthropicProvider(config.apiKey, config.baseUrl, config.timeout))
					break
				case 'gemini':
					this.providers.set(key, new GeminiProvider(config.apiKey, config.timeout))
					break
				default:
					throw new LLMError(
						`Unknown provider: ${config.provider}`,
						LLMErrorCode.INVALID_REQUEST
					)
			}
		}

		return this.providers.get(key)!
	}

	/**
	 * 发送消息到 LLM
	 */
	async sendMessage(params: {
		config: LLMConfig
		messages: LLMMessage[]
		tools?: ToolDefinition[]
		systemPrompt?: string
	}) {
		const { config, messages, tools, systemPrompt } = params

		console.log('[LLMService] sendMessage', {
			provider: config.provider,
			model: config.model,
			messageCount: messages.length,
			hasTools: !!tools?.length
		})

		// 创建新的 AbortController
		this.currentAbortController = new AbortController()

		try {
			const provider = this.getProvider(config)

			await provider.chat({
				model: config.model,
				messages,
				tools,
				systemPrompt,
				signal: this.currentAbortController.signal,

				onStream: (chunk) => {
					this.window.webContents.send('llm:stream', chunk)
				},

				onToolCall: (toolCall) => {
					this.window.webContents.send('llm:toolCall', toolCall)
				},

				onComplete: (result) => {
					console.log('[LLMService] Complete', {
						contentLength: result.content.length,
						toolCallCount: result.toolCalls?.length || 0
					})
					this.window.webContents.send('llm:done', result)
				},

				onError: (error) => {
					console.error('[LLMService] Error', {
						code: error.code,
						message: error.message,
						retryable: error.retryable
					})
					this.window.webContents.send('llm:error', {
						message: error.message,
						code: error.code,
						retryable: error.retryable
					})
				}
			})

		} catch (error: unknown) {
			// 处理未捕获的错误
			const err = error as { name?: string; message?: string }
			if (err.name !== 'AbortError') {
				console.error('[LLMService] Uncaught error:', error)
				this.window.webContents.send('llm:error', {
					message: err.message || 'Unknown error',
					code: LLMErrorCode.UNKNOWN,
					retryable: false
				})
			}
		}
	}

	/**
	 * 中止当前请求
	 */
	abort() {
		if (this.currentAbortController) {
			console.log('[LLMService] Aborting request')
			this.currentAbortController.abort()
			this.currentAbortController = null
		}
	}

	/**
	 * 清除 Provider 缓存
	 */
	clearProviders() {
		this.providers.clear()
	}
}
