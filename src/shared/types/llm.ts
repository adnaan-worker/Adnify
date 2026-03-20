/**
 * Shared LLM-related types.
 * This file is the single export point for LLM payloads, tool schemas, and tool UI state.
 */

// ============================================
// Message content
// ============================================

export interface TextContent {
    type: 'text'
    text: string
}

export interface ImageContent {
    type: 'image'
    source: {
        type: 'base64' | 'url'
        media_type?: string
        data: string
    }
}

export type MessageContentPart = TextContent | ImageContent
export type MessageContent = string | MessageContentPart[]

// ============================================
// LLM messages
// ============================================

export interface LLMMessage {
    role: 'user' | 'assistant' | 'system' | 'tool'
    /** Assistant messages with tool calls may use `null` content. */
    content: MessageContent | null
    /** OpenAI-style tool calls. */
    tool_calls?: LLMToolCallMessage[]
    /** Tool-call id for tool role messages. */
    tool_call_id?: string
    /** Tool name for tool role messages. */
    name?: string
    /** Reasoning text for providers that expose it. */
    reasoning_content?: string
}

export interface LLMToolCallMessage {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

// ============================================
// Provider config
// ============================================

export type ProviderType =
    | 'openai'
    | 'anthropic'
    | 'gemini'
    | 'deepseek'
    | 'groq'
    | 'mistral'
    | 'ollama'
    | 'custom'

export interface LLMConfig {
    provider: string
    model: string
    apiKey: string
    baseUrl?: string
    timeout?: number

    // Core generation params.
    maxTokens?: number
    temperature?: number
    topP?: number
    frequencyPenalty?: number
    presencePenalty?: number
    stopSequences?: string[]
    topK?: number
    seed?: number
    logitBias?: Record<string, number>

    // Extended AI SDK params.
    maxRetries?: number
    toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string }
    parallelToolCalls?: boolean
    headers?: Record<string, string>

    /** Provider protocol selection for AI SDK adapters. */
    protocol?: import('@shared/config/providers').ApiProtocol
    /** Enables reasoning / thinking mode where supported. */
    enableThinking?: boolean
    /** Thinking token budget for providers that support it. */
    thinkingBudget?: number
    /** Reasoning effort level for providers that support it. */
    reasoningEffort?: 'low' | 'medium' | 'high'
}

export interface LLMParameters {
    temperature: number
    topP: number
    maxTokens: number
    frequencyPenalty?: number
    presencePenalty?: number
    topK?: number
    seed?: number
    logitBias?: Record<string, number>
}

// ============================================
// LLM responses
// ============================================

/** Raw tool call returned by the model before execution state is added. */
export interface LLMToolCall {
    id: string
    name: string
    arguments: Record<string, unknown>
}

export interface LLMStreamChunk {
    type:
        | 'text'
        | 'tool_call'
        | 'tool_call_start'
        | 'tool_call_delta'
        | 'tool_call_delta_end'
        | 'tool_call_end'
        | 'tool_call_available'
        | 'reasoning'
        | 'error'
    content?: string
    toolCall?: LLMToolCall
    toolCallDelta?: {
        id?: string
        name?: string
        args?: string
    }
    error?: string
}

export interface LLMResult {
    content: string
    reasoning?: string
    toolCalls?: LLMToolCall[]
    usage?: {
        promptTokens: number
        completionTokens: number
        totalTokens: number
    }
}

// ============================================
// Errors
// ============================================

export interface LLMError {
    message: string
    code: string
    retryable: boolean
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

// ============================================
// IPC payloads
// ============================================

export interface LLMSendMessageParams {
    config: LLMConfig
    messages: LLMMessage[]
    tools?: ToolDefinition[]
    systemPrompt?: string
    activeTools?: string[]
}

// ============================================
// Tool definitions
// ============================================

export interface ToolDefinition {
    name: string
    description: string
    approvalType?: ToolApprovalType
    parameters: {
        type: 'object'
        properties: Record<string, ToolPropertySchema>
        required?: string[]
    }
}

export interface ToolPropertySchema {
    type: string
    description?: string
    enum?: string[]
    items?: ToolPropertySchema
    properties?: Record<string, ToolPropertySchema>
    required?: string[]
}

// ============================================
// Tool execution / UI state
// ============================================

export type ToolStatus = 'pending' | 'awaiting' | 'running' | 'success' | 'error' | 'rejected'
export type ToolApprovalType = 'none' | 'terminal' | 'dangerous' | 'interaction'
export type ToolResultType = 'tool_request' | 'running_now' | 'success' | 'tool_error' | 'rejected'

/**
 * Ephemeral tool preview state used while a tool call is still streaming.
 * The canonical live source now lives on the thread store.
 */
export interface ToolStreamingPreview {
    isStreaming: boolean
    name?: string
    partialArgs?: Record<string, unknown>
    lastUpdateTime?: number
}

/** Tool call record rendered in the chat UI. */
export interface ToolCall {
    id: string
    name: string
    arguments: Record<string, unknown>
    status: ToolStatus
    result?: string
    error?: string
    /** Structured rich results such as images, code, tables, or files. */
    richContent?: ToolRichContent[]
    /**
     * Legacy compatibility field.
     * Live streaming previews should read from thread-level `ToolStreamingPreview` state instead.
     */
    streamingState?: ToolStreamingPreview
}

export interface ToolExecutionResult {
    success: boolean
    /** Plain-text result returned to the model. */
    result: string
    error?: string
    /** Extra execution metadata for UI and follow-up logic. */
    meta?: Record<string, unknown>
    /** Structured rich output for renderer-side display. */
    richContent?: ToolRichContent[]
}

export type ToolRichContentType =
    | 'text'
    | 'image'
    | 'code'
    | 'json'
    | 'markdown'
    | 'html'
    | 'file'
    | 'link'
    | 'table'

export interface ToolRichContent {
    type: ToolRichContentType
    text?: string
    data?: string
    mimeType?: string
    uri?: string
    title?: string
    language?: string
    tableData?: {
        headers: string[]
        rows: string[][]
    }
    url?: string
}

export interface ToolExecutionContext {
    workspacePath: string | null
    currentAssistantId?: string | null
    chatMode?: import('@/renderer/modes/types').WorkMode
    toolCallId?: string
}

export type ToolExecutor = (
    args: Record<string, unknown>,
    context: ToolExecutionContext
) => Promise<ToolExecutionResult>

export interface ValidationResult<T = unknown> {
    success: boolean
    data?: T
    error?: string
}

/** AST node used by code graph / call graph analysis. */
export interface CodeGraphNode {
    id: string
    name: string
    type: 'definition' | 'call'
    content: string
    startLine: number
    endLine: number
    callerName?: string
    calleeName?: string
}
