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
		const { model, messages, tools, systemPrompt, maxTokens, signal, onStream, onToolCall, onComplete, onError } = params

		try {
			this.log('info', 'Starting chat', { model, messageCount: messages.length })

			// 构建消息
			const openaiMessages: OpenAI.ChatCompletionMessageParam[] = []

			if (systemPrompt) {
				openaiMessages.push({ role: 'system', content: systemPrompt })
			}

			// 处理消息：直接转换格式，AgentService 已经确保了正确的消息顺序
			for (const msg of messages) {
				if (msg.role === 'user') {
					openaiMessages.push({
						role: 'user',
						content: this.convertContent(msg.content),
					})
				} else if (msg.role === 'assistant') {
					// 处理 assistant 消息，content 可能是 string、array 或 null
					let assistantContent: string | null = null
					if (typeof msg.content === 'string') {
						assistantContent = msg.content
					} else if (Array.isArray(msg.content)) {
						assistantContent = msg.content.map(p => p.type === 'text' ? p.text : '').join('')
					}
					
					// 如果有 tool_calls，添加到消息中
					if (msg.tool_calls && msg.tool_calls.length > 0) {
						openaiMessages.push({
							role: 'assistant',
							content: assistantContent,
							tool_calls: msg.tool_calls,
						})
					} else {
						openaiMessages.push({
							role: 'assistant',
							content: assistantContent || '',
						})
					}
				} else if (msg.role === 'tool') {
					// tool 消息必须有 toolCallId（支持两种命名风格）
					const toolCallId = msg.tool_call_id || msg.toolCallId
					if (!toolCallId) {
						this.log('warn', 'Tool message missing toolCallId, skipping', { content: String(msg.content).slice(0, 50) })
						continue
					}
					openaiMessages.push({
						role: 'tool',
						content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
						tool_call_id: toolCallId,
					})
				} else if (msg.role === 'system') {
					// system 消息通常在开头，但也支持中间插入
					openaiMessages.push({
						role: 'system',
						content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
					})
				}
			}

			// 构建请求
			const convertedTools = this.convertTools(tools)
			const requestBody: OpenAI.ChatCompletionCreateParamsStreaming = {
				model,
				messages: openaiMessages,
				stream: true,
				// 使用配置的 maxTokens，默认 8192（足够大多数工具调用）
				max_tokens: maxTokens || 8192,
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
									} else if (currentToolCall.name) {
										// 解析失败
										const errorToolCall: ToolCall = {
											id: currentToolCall.id,
											name: currentToolCall.name,
											arguments: { _parseError: true }
										}
										toolCalls.push(errorToolCall)
										onStream({ type: 'tool_call_end', toolCall: errorToolCall })
										onToolCall(errorToolCall)
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
				} else if (currentToolCall.id && currentToolCall.name) {
					// 解析失败，发送带空参数的工具调用，让前端显示错误
					const errorToolCall: ToolCall = {
						id: currentToolCall.id,
						name: currentToolCall.name,
						arguments: { _parseError: true, _rawArgs: currentToolCall.argsString.slice(0, 500) }
					}
					toolCalls.push(errorToolCall)
					onStream({ type: 'tool_call_end', toolCall: errorToolCall })
					onToolCall(errorToolCall)
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

		let argsStr = tc.argsString || '{}'
		
		// 预处理：清理各种模型的特殊标记
		argsStr = this.cleanToolCallArgs(argsStr)
		
		// 第一次尝试：直接解析
		try {
			const args = JSON.parse(argsStr)
			return { id: tc.id, name: tc.name, arguments: args }
		} catch (firstError) {
			// 第二次尝试：修复 JSON 中的未转义换行符
			try {
				const fixed = this.fixUnescapedNewlines(argsStr)
				const args = JSON.parse(fixed)
				this.log('info', 'Fixed JSON with unescaped newlines in tool call')
				return { id: tc.id, name: tc.name, arguments: args }
			} catch (secondError) {
				// 第三次尝试：修复 JSON 中的未转义特殊字符
				try {
					const fixed = this.fixMalformedJson(argsStr)
					const args = JSON.parse(fixed)
					this.log('info', 'Fixed malformed JSON in tool call')
					return { id: tc.id, name: tc.name, arguments: args }
				} catch (thirdError) {
					const error = thirdError as Error
					this.log('error', 'Failed to parse tool call arguments', { 
						error: error.message,
						argsLength: argsStr.length,
						argsStart: argsStr.slice(0, 100),
						argsEnd: argsStr.slice(-100)
					})
					return null
				}
			}
		}
	}

	/**
	 * 清理工具调用参数中的特殊标记
	 * 
	 * 背景：某些 OpenAI 兼容 API（如豆包、DeepSeek）在工具调用参数中
	 * 会添加非标准的特殊标记，需要清理后才能解析 JSON。
	 * 
	 * 这些清理操作是安全的，不会影响标准 OpenAI API 的输出：
	 * - 标准 OpenAI 输出的 JSON 不会有前导/尾随空白
	 * - 标准 OpenAI 输出不会包含 <|...|> 格式的标记
	 */
	private cleanToolCallArgs(argsStr: string): string {
		let cleaned = argsStr
		
		// 1. 去除开头的空白字符（安全：标准 JSON 不应有前导空白）
		cleaned = cleaned.trimStart()
		
		// 2. 去除特殊标记（如豆包的 <|FunctionCallEnd|>）
		// 这些标记只会出现在 JSON 外部，不会影响正常 JSON
		cleaned = cleaned.replace(/<\|[^|]+\|>/g, '')
		
		// 3. 去除末尾空白
		cleaned = cleaned.trimEnd()
		
		// 4. 如果清理后不是以 } 结尾，尝试找到最后一个完整的 JSON 对象
		// 这处理了某些模型在 JSON 后添加额外字符的情况
		if (cleaned.length > 0 && !cleaned.endsWith('}')) {
			// 使用括号匹配找到完整的 JSON 对象
			let braceCount = 0
			let lastValidEnd = -1
			let inString = false
			let escaped = false
			
			for (let i = 0; i < cleaned.length; i++) {
				const char = cleaned[i]
				
				if (escaped) {
					escaped = false
					continue
				}
				
				if (char === '\\' && inString) {
					escaped = true
					continue
				}
				
				if (char === '"') {
					inString = !inString
					continue
				}
				
				if (!inString) {
					if (char === '{') braceCount++
					else if (char === '}') {
						braceCount--
						if (braceCount === 0) {
							lastValidEnd = i
						}
					}
				}
			}
			
			if (lastValidEnd !== -1) {
				cleaned = cleaned.slice(0, lastValidEnd + 1)
			}
		}
		
		return cleaned
	}

	/**
	 * 修复 JSON 字符串中的未转义换行符和其他控制字符
	 */
	private fixUnescapedNewlines(argsStr: string): string {
		let inString = false
		let escaped = false
		let result = ''
		
		for (let i = 0; i < argsStr.length; i++) {
			const char = argsStr[i]
			const charCode = char.charCodeAt(0)
			
			if (escaped) {
				result += char
				escaped = false
				continue
			}
			
			if (char === '\\') {
				escaped = true
				result += char
				continue
			}
			
			if (char === '"') {
				inString = !inString
				result += char
				continue
			}
			
			// 在字符串内部遇到控制字符，转义它们
			if (inString) {
				if (char === '\n') {
					result += '\\n'
					continue
				}
				if (char === '\r') {
					result += '\\r'
					continue
				}
				if (char === '\t') {
					result += '\\t'
					continue
				}
				// 其他控制字符 (0x00-0x1F)
				if (charCode < 32) {
					result += `\\u${charCode.toString(16).padStart(4, '0')}`
					continue
				}
			}
			
			result += char
		}
		
		return result
	}

	/**
	 * 修复格式错误的 JSON
	 * 处理 LLM 可能生成的各种格式问题
	 */
	private fixMalformedJson(argsStr: string): string {
		// 策略：逐字符解析，修复常见问题
		let result = ''
		let inString = false
		let escaped = false
		let i = 0
		
		while (i < argsStr.length) {
			const char = argsStr[i]
			const charCode = char.charCodeAt(0)
			
			if (escaped) {
				// 处理转义序列
				if (char === 'n' || char === 'r' || char === 't' || char === '"' || 
					char === '\\' || char === '/' || char === 'b' || char === 'f') {
					result += char
				} else if (char === 'u') {
					// Unicode 转义
					result += char
				} else {
					// 无效的转义序列，保留原样但可能需要修复
					result += char
				}
				escaped = false
				i++
				continue
			}
			
			if (char === '\\') {
				escaped = true
				result += char
				i++
				continue
			}
			
			if (char === '"') {
				inString = !inString
				result += char
				i++
				continue
			}
			
			if (inString) {
				// 在字符串内部
				if (char === '\n') {
					result += '\\n'
				} else if (char === '\r') {
					result += '\\r'
				} else if (char === '\t') {
					result += '\\t'
				} else if (charCode < 32) {
					// 控制字符
					result += `\\u${charCode.toString(16).padStart(4, '0')}`
				} else {
					result += char
				}
			} else {
				// 在字符串外部
				result += char
			}
			
			i++
		}
		
		// 如果字符串没有正确闭合，尝试修复
		if (inString) {
			result += '"'
		}
		
		// 确保 JSON 对象正确闭合
		let braceCount = 0
		let bracketCount = 0
		inString = false
		escaped = false
		
		for (let j = 0; j < result.length; j++) {
			const c = result[j]
			if (escaped) {
				escaped = false
				continue
			}
			if (c === '\\') {
				escaped = true
				continue
			}
			if (c === '"') {
				inString = !inString
				continue
			}
			if (!inString) {
				if (c === '{') braceCount++
				else if (c === '}') braceCount--
				else if (c === '[') bracketCount++
				else if (c === ']') bracketCount--
			}
		}
		
		// 添加缺失的闭合括号
		while (bracketCount > 0) {
			result += ']'
			bracketCount--
		}
		while (braceCount > 0) {
			result += '}'
			braceCount--
		}
		
		return result
	}
}
