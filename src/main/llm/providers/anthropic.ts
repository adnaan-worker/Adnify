/**
 * Anthropic Provider
 * 支持 Claude 系列模型
 */

import Anthropic from '@anthropic-ai/sdk'
import { BaseProvider } from './base'
import { ChatParams, ToolDefinition, ToolCall, MessageContent } from '../types'

export class AnthropicProvider extends BaseProvider {
	private client: Anthropic

	constructor(apiKey: string, baseUrl?: string, timeout?: number) {
		super('Anthropic')
		const timeoutMs = timeout || 120000 // 默认 2 分钟
		this.log('info', 'Initializing', { baseUrl: baseUrl || 'default', timeout: timeoutMs })
		this.client = new Anthropic({
			apiKey,
			baseURL: baseUrl,
			timeout: timeoutMs,
		})
	}

    private convertContent(content: MessageContent): string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
        if (typeof content === 'string') return content
        
        return content.map(part => {
            if (part.type === 'text') {
                return { type: 'text', text: part.text }
            } else {
                if (part.source.type === 'url') {
                    // Anthropic doesn't support URL images directly in this SDK version usually, 
                    // or requires fetching. For now, we assume base64 is passed or we filter it out/warn.
                    // Ideally, the frontend should convert to base64.
                    console.warn('Anthropic provider received URL image, which is not directly supported. Ignoring.')
                    return { type: 'text', text: '[Image URL not supported]' }
                }
                return {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: part.source.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                        data: part.source.data
                    }
                }
            }
        })
    }

	private convertTools(tools?: ToolDefinition[]): Anthropic.Tool[] | undefined {
		if (!tools?.length) return undefined
		return tools.map(tool => ({
			name: tool.name,
			description: tool.description,
			input_schema: tool.parameters as Anthropic.Tool['input_schema'],
		}))
	}

	async chat(params: ChatParams): Promise<void> {
		const { model, messages, tools, systemPrompt, signal, onStream, onToolCall, onComplete, onError } = params

		try {
			this.log('info', 'Starting chat', { model, messageCount: messages.length })

			// 构建消息
			const anthropicMessages: Anthropic.MessageParam[] = []

			for (const msg of messages) {
				if (msg.role === 'tool') {
					anthropicMessages.push({
						role: 'user',
						content: [{
							type: 'tool_result',
							tool_use_id: msg.toolCallId!,
							content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
						}]
					})
				} else if (msg.role === 'assistant' && msg.toolName) {
					anthropicMessages.push({
						role: 'assistant',
						content: [{
							type: 'tool_use',
							id: msg.toolCallId!,
							name: msg.toolName,
							input: JSON.parse(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)),
						}]
					})
				} else if (msg.role === 'user' || msg.role === 'assistant') {
					anthropicMessages.push({
						role: msg.role,
						content: this.convertContent(msg.content),
					})
				}
			}

			// 发起流式请求
			const stream = this.client.messages.stream({
				model,
				max_tokens: 8192,
				system: systemPrompt,
				messages: anthropicMessages,
				tools: this.convertTools(tools),
			}, { signal })

			let fullContent = ''
			const toolCalls: ToolCall[] = []

			// 监听文本流
			stream.on('text', (text) => {
				fullContent += text
				onStream({ type: 'text', content: text })
			})

			// 等待完成并提取工具调用
			const finalMessage = await stream.finalMessage()

			for (const block of finalMessage.content) {
				if (block.type === 'tool_use') {
					const toolCall: ToolCall = {
						id: block.id,
						name: block.name,
						arguments: block.input as Record<string, unknown>,
					}
					toolCalls.push(toolCall)
					onToolCall(toolCall)
				}
			}

			this.log('info', 'Chat complete', {
				contentLength: fullContent.length,
				toolCallCount: toolCalls.length
			})

			onComplete({
				content: fullContent,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				usage: {
					promptTokens: finalMessage.usage.input_tokens,
					completionTokens: finalMessage.usage.output_tokens,
					totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens
				}
			})

		} catch (error: unknown) {
			const llmError = this.parseError(error)
			this.log('error', 'Chat failed', { code: llmError.code, message: llmError.message })
			onError(llmError)
		}
	}
}
