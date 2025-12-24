/**
 * LLM 类型定义
 * 统一的接口定义，支持多种 Provider
 */

export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'groq' | 'mistral' | 'ollama' | 'custom'

// 适配器配置
export interface AdapterConfig {
  responseFormat: 'json' | 'xml' | 'mixed'
  toolCallPath: string
  toolNamePath: string
  toolArgsPath: string
  argsIsObject: boolean
  autoGenerateId: boolean
  xmlToolCallTag?: string
  xmlNameSource?: string
  xmlArgsTag?: string
}

export interface LLMConfig {
  provider: ProviderType
  model: string
  apiKey: string
  baseUrl?: string
  maxTokens?: number
  temperature?: number
  timeout?: number
  // 完整适配器配置
  adapterId?: string
  adapterConfig?: import('../../../shared/config/providers').LLMAdapterConfig
}

export interface TextContent {
  type: 'text'
  text: string
}

export interface ImageContent {
  type: 'image'
  source: {
    type: 'base64' | 'url'
    media_type: string
    data: string
  }
}

export type MessageContent = string | Array<TextContent | ImageContent>

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: MessageContent
  toolCallId?: string
  tool_call_id?: string
  toolName?: string
  rawParams?: Record<string, unknown>
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
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
  arguments: Record<string, unknown>
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'reasoning' | 'error'
  content?: string
  toolCall?: ToolCall
  toolCallDelta?: {
    id?: string
    name?: string
    args?: string
  }
  error?: string
}

export interface ChatParams {
  model: string
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  systemPrompt?: string
  maxTokens?: number
  signal?: AbortSignal
  // 完整适配器配置（包含请求体和响应解析）
  adapterConfig?: import('../../../shared/config/providers').LLMAdapterConfig
  onStream: (chunk: StreamChunk) => void
  onToolCall: (toolCall: ToolCall) => void
  onComplete: (result: ChatResult) => void
  onError: (error: LLMError) => void
}

export interface ChatResult {
  content: string
  reasoning?: string
  toolCalls?: ToolCall[]
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export class LLMError extends Error {
  constructor(
    message: string,
    public code: LLMErrorCode,
    public status?: number,
    public retryable: boolean = false,
    public details?: unknown
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

export enum LLMErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  INVALID_API_KEY = 'INVALID_API_KEY',
  RATE_LIMIT = 'RATE_LIMIT',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  CONTEXT_LENGTH_EXCEEDED = 'CONTEXT_LENGTH_EXCEEDED',
  INVALID_REQUEST = 'INVALID_REQUEST',
  ABORTED = 'ABORTED',
  UNKNOWN = 'UNKNOWN',
}

export interface LLMProvider {
  chat(params: ChatParams): Promise<void>
}

export interface ProviderFactory {
  create(config: LLMConfig): LLMProvider
}
