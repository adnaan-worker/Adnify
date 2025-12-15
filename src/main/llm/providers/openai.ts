import OpenAI from 'openai'
import { LLMProvider, ChatParams, ToolDefinition, ToolCall } from '../types'

export class OpenAIProvider implements LLMProvider {
	private client: OpenAI

	constructor(apiKey: string, baseUrl?: string) {
		console.log('[OpenAI Provider] Initializing with baseURL:', baseUrl || 'default')
		this.client = new OpenAI({
			apiKey,
			baseURL: baseUrl,
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
			console.log('[OpenAI Provider] Starting chat with model:', model)
			const openaiMessages: OpenAI.ChatCompletionMessageParam[] = []

			if (systemPrompt) {
				openaiMessages.push({ role: 'system', content: systemPrompt })
			}

			for (const msg of messages) {
				if (msg.role === 'tool') {
					openaiMessages.push({
						role: 'tool',
						content: msg.content,
						tool_call_id: msg.toolCallId!,
					})
				} else if (msg.role === 'assistant' && msg.toolName) {
					// This is a tool call from assistant
					openaiMessages.push({
						role: 'assistant',
						content: null,
						tool_calls: [{
							id: msg.toolCallId!,
							type: 'function',
							function: {
								name: msg.toolName,
								arguments: msg.content,
							}
						}]
					})
				} else {
					openaiMessages.push({
						role: msg.role as 'user' | 'assistant',
						content: msg.content,
					})
				}
			}

			const convertedTools = this.convertTools(tools)
			console.log('[OpenAI Provider] Request - messages:', openaiMessages.length, 'tools:', convertedTools?.length || 0)
			
			const requestBody: any = {
				model,
				messages: openaiMessages,
				stream: true,
			}
			
			// 只有在有工具时才添加 tools 参数（某些 API 不支持空的 tools）
			if (convertedTools && convertedTools.length > 0) {
				requestBody.tools = convertedTools
			}
			
			const stream = await this.client.chat.completions.create(requestBody, { signal })

			let fullContent = ''
			let fullReasoning = ''
			const toolCalls: ToolCall[] = []
			let currentToolCall: Partial<ToolCall> | null = null

			let chunkCount = 0
			for await (const chunk of stream) {
				chunkCount++
				const delta = chunk.choices[0]?.delta as any // 使用 any 来处理非标准字段
				
				// 调试：打印前几个 chunk
				if (chunkCount <= 3) {
					console.log('[OpenAI Provider] Chunk', chunkCount, ':', JSON.stringify(delta))
				}

				// 处理标准 content
				if (delta?.content) {
					fullContent += delta.content
					onStream({ type: 'text', content: delta.content })
				}

				// 处理 reasoning 字段 (某些 API 如 OpenRouter 的推理模型)
				if (delta?.reasoning) {
					fullReasoning += delta.reasoning
					// 可选：也流式输出 reasoning（作为思考过程）
					// onStream({ type: 'text', content: delta.reasoning })
				}

				if (delta?.tool_calls) {
					for (const tc of delta.tool_calls) {
						if (tc.index !== undefined) {
							if (!currentToolCall || tc.id) {
								if (currentToolCall?.id) {
									const finalToolCall: ToolCall = {
										id: currentToolCall.id!,
										name: currentToolCall.name!,
										arguments: JSON.parse((currentToolCall as any)._argsString || '{}')
									}
									toolCalls.push(finalToolCall)
									onToolCall(finalToolCall)
								}
								currentToolCall = {
									id: tc.id,
									name: tc.function?.name,
									arguments: {}
								};
								(currentToolCall as any)._argsString = tc.function?.arguments || ''
							} else {
								if (tc.function?.name) currentToolCall.name = tc.function.name
								if (tc.function?.arguments) {
									(currentToolCall as any)._argsString = ((currentToolCall as any)._argsString || '') + tc.function.arguments
								}
							}
						}
					}
				}
			}

			// Handle last tool call
			if (currentToolCall?.id) {
				const finalToolCall: ToolCall = {
					id: currentToolCall.id!,
					name: currentToolCall.name!,
					arguments: JSON.parse((currentToolCall as any)._argsString || '{}')
				}
				toolCalls.push(finalToolCall)
				onToolCall(finalToolCall)
			}

			// 如果没有 content 但有 reasoning，使用 reasoning 作为内容
			const finalContent = fullContent || (fullReasoning ? `[Reasoning]\n${fullReasoning}` : '')
			
			console.log('[OpenAI Provider] Complete. Chunks:', chunkCount, 'Content length:', fullContent.length, 'Reasoning length:', fullReasoning.length)
			onComplete({ content: finalContent, toolCalls: toolCalls.length > 0 ? toolCalls : undefined })
		} catch (error: any) {
			// 打印完整错误信息
			console.error('[OpenAI Provider] Error:', error.message)
			if (error.error) {
				console.error('[OpenAI Provider] Error details:', JSON.stringify(error.error))
			}
			if (error.response) {
				console.error('[OpenAI Provider] Response status:', error.response.status)
			}
			onError(error)
		}
	}
}
