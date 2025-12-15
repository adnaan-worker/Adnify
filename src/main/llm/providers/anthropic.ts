import Anthropic from '@anthropic-ai/sdk'
import { LLMProvider, ChatParams, ToolDefinition, ToolCall } from '../types'

export class AnthropicProvider implements LLMProvider {
	private client: Anthropic

	constructor(apiKey: string) {
		this.client = new Anthropic({ apiKey })
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
			const anthropicMessages: Anthropic.MessageParam[] = []

			for (const msg of messages) {
				if (msg.role === 'tool') {
					anthropicMessages.push({
						role: 'user',
						content: [{
							type: 'tool_result',
							tool_use_id: msg.toolCallId!,
							content: msg.content,
						}]
					})
				} else if (msg.role === 'assistant' && msg.toolName) {
					anthropicMessages.push({
						role: 'assistant',
						content: [{
							type: 'tool_use',
							id: msg.toolCallId!,
							name: msg.toolName,
							input: JSON.parse(msg.content),
						}]
					})
				} else if (msg.role === 'user' || msg.role === 'assistant') {
					anthropicMessages.push({
						role: msg.role,
						content: msg.content,
					})
				}
			}

			const stream = this.client.messages.stream({
				model,
				max_tokens: 8192,
				system: systemPrompt,
				messages: anthropicMessages,
				tools: this.convertTools(tools),
			}, { signal })

			let fullContent = ''
			const toolCalls: ToolCall[] = []

			stream.on('text', (text) => {
				fullContent += text
				onStream({ type: 'text', content: text })
			})

			const finalMessage = await stream.finalMessage()

			// Extract tool calls from final message
			for (const block of finalMessage.content) {
				if (block.type === 'tool_use') {
					const toolCall: ToolCall = {
						id: block.id,
						name: block.name,
						arguments: block.input as Record<string, any>,
					}
					toolCalls.push(toolCall)
					onToolCall(toolCall)
				}
			}
			onComplete({ content: fullContent, toolCalls: toolCalls.length > 0 ? toolCalls : undefined })
		} catch (error: any) {
			onError(error)
		}
	}
}
