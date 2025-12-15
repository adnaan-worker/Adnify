import { GoogleGenerativeAI, FunctionDeclaration, Tool, SchemaType } from '@google/generative-ai'
import { LLMProvider, ChatParams, ToolDefinition, ToolCall } from '../types'

export class GeminiProvider implements LLMProvider {
	private client: GoogleGenerativeAI

	constructor(apiKey: string) {
		this.client = new GoogleGenerativeAI(apiKey)
	}

	private convertTools(tools?: ToolDefinition[]): Tool[] | undefined {
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
		})) as FunctionDeclaration[]

		return [{ functionDeclarations }]
	}

	async chat(params: ChatParams): Promise<void> {
		const { model, messages, tools, systemPrompt, onStream, onToolCall, onComplete, onError } = params

		try {
			const genModel = this.client.getGenerativeModel({
				model,
				systemInstruction: systemPrompt,
				tools: this.convertTools(tools),
			})

			const history: any[] = []
			let lastUserMessage = ''

			for (const msg of messages) {
				if (msg.role === 'user') {
					lastUserMessage = msg.content
				} else if (msg.role === 'assistant') {
					if (msg.toolName) {
						history.push({
							role: 'model',
							parts: [{
								functionCall: {
									name: msg.toolName,
									args: JSON.parse(msg.content),
								}
							}]
						})
					} else {
						history.push({
							role: 'model',
							parts: [{ text: msg.content }]
						})
					}
				} else if (msg.role === 'tool') {
					history.push({
						role: 'user',
						parts: [{
							functionResponse: {
								name: msg.toolName,
								response: { result: msg.content }
							}
						}]
					})
				}
			}

			// Remove last user message from history as it will be sent separately
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

				// Check for function calls
				const candidate = chunk.candidates?.[0]
				if (candidate?.content?.parts) {
					for (const part of candidate.content.parts) {
						if ('functionCall' in part && part.functionCall) {
							const toolCall: ToolCall = {
								id: `gemini-${Date.now()}`,
								name: part.functionCall.name,
								arguments: part.functionCall.args as Record<string, any>,
							}
							toolCalls.push(toolCall)
							onToolCall(toolCall)
						}
					}
				}
			}

			onComplete({ content: fullContent, toolCalls: toolCalls.length > 0 ? toolCalls : undefined })
		} catch (error: any) {
			onError(error)
		}
	}
}
