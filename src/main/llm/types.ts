export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'custom'

export interface LLMConfig {
	provider: ProviderType
	model: string
	apiKey: string
	baseUrl?: string
}

export interface LLMMessage {
	role: 'user' | 'assistant' | 'system' | 'tool'
	content: string
	toolCallId?: string
	toolName?: string
}

export interface ToolDefinition {
	name: string
	description: string
	parameters: {
		type: 'object'
		properties: Record<string, {
			type: string
			description: string
			enum?: string[]
		}>
		required?: string[]
	}
}

export interface ToolCall {
	id: string
	name: string
	arguments: Record<string, any>
}

export interface StreamChunk {
	type: 'text' | 'tool_call'
	content?: string
	toolCall?: ToolCall
}

export interface ChatParams {
	model: string
	messages: LLMMessage[]
	tools?: ToolDefinition[]
	systemPrompt?: string
	signal?: AbortSignal
	onStream: (chunk: StreamChunk) => void
	onToolCall: (toolCall: ToolCall) => void
	onComplete: (result: { content: string; toolCalls?: ToolCall[] }) => void
	onError: (error: Error) => void
}

export interface LLMProvider {
	chat(params: ChatParams): Promise<void>
}
