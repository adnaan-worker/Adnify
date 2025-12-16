/**
 * OpenAI Provider
 * 支持 OpenAI API 及兼容的第三方 API（如 OpenRouter、DeepSeek 等）
 */

import OpenAI from 'openai'
import { BaseProvider } from './base'
import { ChatParams, ToolDefinition, ToolCall, MessageContent } from '../types'

export class OpenAIProvider extends BaseProvider {
	private client: OpenAI

	constructor(apiKey: string, baseUrl?: string, timeout?: number) {
		super('OpenAI')
		const timeoutMs = timeout || 120000 // 默认 2 分钟
		this.log('info', 'Initializing', { baseUrl: baseUrl || 'default', timeout: timeoutMs })
		this.client = new OpenAI({
			apiKey,
			baseURL: baseUrl,
			timeout: timeoutMs,
			maxRetries: 0, // 我们自己处理重试
		})
	}

    private convertContent(content: MessageContent): string | Array<OpenAI.Chat.Completions.ChatCompletionContentPart> {
        if (typeof content === 'string') return content
        return content.map(part => {
            if (part.type === 'text') {
                return { type: 'text', text: part.text }
            } else {
                // OpenAI expects base64 as data:image/...;base64,...
                const url = part.source.type === 'base64' 
                    ? `data:${part.source.media_type};base64,${part.source.data}`
                    : part.source.data
                return { type: 'image_url', image_url: { url } }
            }
        })
    }

	private convertTools(tools?: ToolDefinition[]): OpenAI.ChatCompletionTool[] | undefined {
		if (!tools?.length) return undefined
		return tools.map(tool => ({
			type: 'function' as const,
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			}
		}))
	}

	async chat(params: ChatParams): Promise<void> {
		const { model, messages, tools, systemPrompt, signal, onStream, onToolCall, onComplete, onError } = params

		try {
			this.log('info', 'Starting chat', { model, messageCount: messages.length })

			// 构建消息
			const openaiMessages: OpenAI.ChatCompletionMessageParam[] = []

			if (systemPrompt) {
				openaiMessages.push({ role: 'system', content: systemPrompt })
			}

			for (const msg of messages) {
				if (msg.role === 'tool') {
					openaiMessages.push({
						role: 'tool',
						content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
						tool_call_id: msg.toolCallId!,
					})
				} else if (msg.role === 'assistant' && msg.toolName) {
					openaiMessages.push({
						role: 'assistant',
						content: null,
						tool_calls: [{
							id: msg.toolCallId!,
							type: 'function',
							function: {
								name: msg.toolName,
								arguments: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
							}
						}]
					})
				} else if (msg.role === 'user') {
					openaiMessages.push({
						role: 'user',
						content: this.convertContent(msg.content),
					})
				} else if (msg.role === 'assistant') {
					openaiMessages.push({
						role: 'assistant',
						content: typeof msg.content === 'string' ? msg.content : msg.content.map(p => p.type === 'text' ? p.text : '').join(''),
					})
				}
			}

			// 构建请求
			const convertedTools = this.convertTools(tools)
			const requestBody: OpenAI.ChatCompletionCreateParamsStreaming = {
				model,
				messages: openaiMessages,
				stream: true,
			}

			if (convertedTools && convertedTools.length > 0) {
				requestBody.tools = convertedTools
			}

			// 发起流式请求
			const stream = await this.client.chat.completions.create(requestBody, { signal })

			let fullContent = ''
			let fullReasoning = ''
			const toolCalls: ToolCall[] = []
			let currentToolCall: { id?: string; name?: string; argsString: string } | null = null

			for await (const chunk of stream) {
				// Extended delta type to support reasoning field from OpenRouter and similar APIs
				interface ExtendedDelta {
					content?: string
					reasoning?: string
					tool_calls?: Array<{
						index?: number
						id?: string
						function?: { name?: string; arguments?: string }
					}>
				}
				const delta = chunk.choices[0]?.delta as ExtendedDelta | undefined

				// 处理文本内容
				if (delta?.content) {
					fullContent += delta.content
					onStream({ type: 'text', content: delta.content })
				}

				// 处理 reasoning（某些 API 如 OpenRouter 的推理模型）
				if (delta?.reasoning) {
					fullReasoning += delta.reasoning
					onStream({ type: 'reasoning', content: delta.reasoning })
				}

				// 处理工具调用
				if (delta?.tool_calls) {
					for (const tc of delta.tool_calls) {
						if (tc.index !== undefined) {
							// 新的工具调用开始
							if (tc.id) {
								// 完成上一个工具调用
								if (currentToolCall?.id) {
									const finalToolCall = this.finalizeToolCall(currentToolCall)
									if (finalToolCall) {
										toolCalls.push(finalToolCall)
										onStream({ type: 'tool_call_end', toolCall: finalToolCall })
										onToolCall(finalToolCall)
									}
								}
								currentToolCall = {
									id: tc.id,
									name: tc.function?.name,
									argsString: tc.function?.arguments || ''
								}
                                // 发送开始事件
                                onStream({ 
                                    type: 'tool_call_start', 
                                    toolCallDelta: { 
                                        id: tc.id, 
                                        name: tc.function?.name 
                                    } 
                                })
                                // 如果有初始参数，也发送 delta
                                if (tc.function?.arguments) {
                                    onStream({
                                        type: 'tool_call_delta',
                                        toolCallDelta: {
                                            id: tc.id,
                                            args: tc.function.arguments
                                        }
                                    })
                                }
							} else if (currentToolCall) {
								// 继续累积参数
								if (tc.function?.name) {
                                    currentToolCall.name = tc.function.name
                                    // Name 通常在 id 那个 chunk 里，但以防万一
                                } 
								if (tc.function?.arguments) {
                                    currentToolCall.argsString += tc.function.arguments
                                    // 发送参数增量
                                    onStream({
                                        type: 'tool_call_delta',
                                        toolCallDelta: {
                                            id: currentToolCall.id,
                                            args: tc.function.arguments
                                        }
                                    })
                                }
							}
						}
					}
				}
			}

			// 处理最后一个工具调用
			if (currentToolCall?.id) {
				const finalToolCall = this.finalizeToolCall(currentToolCall)
				if (finalToolCall) {
					toolCalls.push(finalToolCall)
                    onStream({ type: 'tool_call_end', toolCall: finalToolCall })
					onToolCall(finalToolCall)
				}
			}

			// 完成
			const finalContent = fullContent || (fullReasoning ? `[Reasoning]\n${fullReasoning}` : '')
			this.log('info', 'Chat complete', {
				contentLength: fullContent.length,
				reasoningLength: fullReasoning.length,
				toolCallCount: toolCalls.length
			})

			onComplete({
				content: finalContent,
				reasoning: fullReasoning || undefined,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined
			})

		} catch (error: unknown) {
			const llmError = this.parseError(error)
			this.log('error', 'Chat failed', { code: llmError.code, message: llmError.message })
			onError(llmError)
		}
	}

	private finalizeToolCall(tc: { id?: string; name?: string; argsString: string }): ToolCall | null {
		if (!tc.id || !tc.name) return null

		try {
			const args = JSON.parse(tc.argsString || '{}')
			return {
				id: tc.id,
				name: tc.name,
				arguments: args
			}
		} catch (e) {
			this.log('warn', 'Failed to parse tool call arguments', { argsString: tc.argsString })
			return {
				id: tc.id,
				name: tc.name,
				arguments: {}
			}
		}
	}
}
