/**
 * Gemini Provider
 * 支持 Google Gemini 系列模型
 */

import { GoogleGenerativeAI, SchemaType, Content } from '@google/generative-ai'
import { BaseProvider } from './base'
import { ChatParams, ToolDefinition, ToolCall } from '../types'

export class GeminiProvider extends BaseProvider {
	private client: GoogleGenerativeAI
	private timeout: number

	constructor(apiKey: string, timeout?: number) {
		super('Gemini')
		this.timeout = timeout || 120000 // 默认 2 分钟
		this.log('info', 'Initializing', { timeout: this.timeout })
		this.client = new GoogleGenerativeAI(apiKey)
	}

	private convertTools(tools?: ToolDefinition[]) {
		if (!tools?.length) return undefined

		const functionDeclarations = tools.map(tool => ({
			name: tool.name,
			description: tool.description,
			parameters: {
				type: SchemaType.OBJECT,
				properties: Object.fromEntries(
					Object.entries(tool.parameters.properties).map(([key, value]) => [
						key,
						{
							type: value.type as SchemaType,
							description: value.description,
							enum: value.enum,
						}
					])
				),
				required: tool.parameters.required,
			}
		}))

		return [{ functionDeclarations }]
	}

	async chat(params: ChatParams): Promise<void> {
		const { model, messages, tools, systemPrompt, onStream, onToolCall, onComplete, onError } = params

		try {
			this.log('info', 'Starting chat', { model, messageCount: messages.length })

			// Note: tools type assertion needed due to Gemini SDK's complex tool type structure
			// Our convertTools returns a compatible structure but TypeScript can't verify it
			const genModel = this.client.getGenerativeModel({
				model,
				systemInstruction: systemPrompt,
				tools: this.convertTools(tools) as Parameters<typeof this.client.getGenerativeModel>[0]['tools'],
			})

			// 构建历史记录
			const history: Content[] = []
			let lastUserMessage = ''

			// Helper to convert MessageContent to string
			const contentToString = (content: typeof messages[0]['content']): string => {
				if (typeof content === 'string') return content
				return content.map(part => part.type === 'text' ? part.text : '[image]').join('')
			}

			for (const msg of messages) {
				if (msg.role === 'user') {
					lastUserMessage = contentToString(msg.content)
				} else if (msg.role === 'assistant') {
					if (msg.toolName) {
						history.push({
							role: 'model',
							parts: [{
								functionCall: {
									name: msg.toolName,
									args: JSON.parse(contentToString(msg.content)),
								}
							}]
						})
					} else {
						history.push({
							role: 'model',
							parts: [{ text: contentToString(msg.content) }]
						})
					}
				} else if (msg.role === 'tool') {
					history.push({
						role: 'user',
						parts: [{
							functionResponse: {
								name: msg.toolName || '',
								response: { result: contentToString(msg.content) }
							}
						}]
					})
				}
			}

			// 发起流式请求
			const chat = genModel.startChat({ history })
			const result = await chat.sendMessageStream(lastUserMessage)

			let fullContent = ''
			const toolCalls: ToolCall[] = []

			for await (const chunk of result.stream) {
				const text = chunk.text()
				if (text) {
					fullContent += text
					onStream({ type: 'text', content: text })
				}

				// 检查函数调用
				const candidate = chunk.candidates?.[0]
				if (candidate?.content?.parts) {
					for (const part of candidate.content.parts) {
						if ('functionCall' in part && part.functionCall) {
							const toolCall: ToolCall = {
								id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2)}`,
								name: part.functionCall.name,
								arguments: part.functionCall.args as Record<string, unknown>,
							}
							toolCalls.push(toolCall)
							onToolCall(toolCall)
						}
					}
				}
			}

			this.log('info', 'Chat complete', {
				contentLength: fullContent.length,
				toolCallCount: toolCalls.length
			})

			onComplete({
				content: fullContent,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined
			})

		} catch (error: unknown) {
			const llmError = this.parseError(error)
			this.log('error', 'Chat failed', { code: llmError.code, message: llmError.message })
			onError(llmError)
		}
	}
}
