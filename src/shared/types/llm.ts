/**
 * LLM 相关类型定义
 * 单一来源 - 所有 LLM 相关类型从此文件导出
 */

// ============================================
// 消息内容类型
// ============================================

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

export type MessageContentPart = TextContent | ImageContent
export type MessageContent = string | MessageContentPart[]

// ============================================
// LLM 消息类型
// ============================================

export interface LLMMessage {
    role: 'user' | 'assistant' | 'system' | 'tool'
    /** 消息内容，assistant 有 tool_calls 时可为 null */
    content: MessageContent | null
    /** OpenAI 格式的工具调用 */
    tool_calls?: LLMToolCallMessage[]
    /** 工具结果对应的调用 ID */
    tool_call_id?: string
    /** 工具名称（tool role 时使用） */
    name?: string
}

/** OpenAI 格式的工具调用消息 */
export interface LLMToolCallMessage {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

// ============================================
// Provider 配置
// ============================================

export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'groq' | 'mistral' | 'ollama' | 'custom'

/**
 * 统一的 LLM 配置接口
 */
export interface LLMConfig {
    provider: string
    model: string
    apiKey: string
    baseUrl?: string
    timeout?: number

    // LLM 参数
    maxTokens?: number
    temperature?: number
    topP?: number
    frequencyPenalty?: number
    presencePenalty?: number
    stopSequences?: string[]
    topK?: number
    seed?: number
    logitBias?: Record<string, number>

    // Provider 高级配置
    advanced?: import('@shared/config/providers').AdvancedConfig

    /** 协议类型 - 用于 AI SDK provider 选择 */
    protocol?: 'openai' | 'anthropic' | 'google' | 'custom'
    /** 启用深度思考（如 Claude extended thinking） */
    enableThinking?: boolean
    /** 启用视觉能力 */
    enableVision?: boolean
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
// LLM 响应类型
// ============================================

/** LLM 返回的工具调用（无 UI 状态） */
export interface LLMToolCall {
    id: string
    name: string
    arguments: Record<string, unknown>
}

export interface LLMStreamChunk {
    type: 'text' | 'tool_call' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'reasoning' | 'error'
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
// 错误类型
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
// IPC 通信参数
// ============================================

export interface LLMSendMessageParams {
    config: LLMConfig
    messages: LLMMessage[]
    tools?: ToolDefinition[]
    systemPrompt?: string
    activeTools?: string[]  // 限制可用的工具列表
}

// ============================================
// 工具定义（发送给 LLM）
// ============================================

export interface ToolDefinition {
    name: string
    description: string
    /** 审批类型（可选） */
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
// 工具执行（Renderer 使用）
// ============================================

export type ToolStatus = 'pending' | 'awaiting' | 'running' | 'success' | 'error' | 'rejected'
export type ToolApprovalType = 'none' | 'terminal' | 'dangerous'
export type ToolResultType = 'tool_request' | 'running_now' | 'success' | 'tool_error' | 'rejected'

/** UI 层的工具调用记录（包含执行状态） */
export interface ToolCall {
    id: string
    name: string
    arguments: Record<string, unknown>
    status: ToolStatus
    result?: string
    error?: string
    /** 富内容结果（图片、代码、表格等） */
    richContent?: ToolRichContent[]
}

export interface ToolExecutionResult {
    success: boolean
    /** 文本结果 */
    result: string
    error?: string
    /** 元数据 */
    meta?: Record<string, unknown>
    /** 富内容结果（支持多种类型） */
    richContent?: ToolRichContent[]
}

/** 工具富内容类型 */
export type ToolRichContentType = 'text' | 'image' | 'code' | 'json' | 'markdown' | 'html' | 'file' | 'link' | 'table'

/** 工具富内容 */
export interface ToolRichContent {
    /** 内容类型 */
    type: ToolRichContentType
    /** 文本内容 */
    text?: string
    /** Base64 数据（用于图片等二进制内容） */
    data?: string
    /** MIME 类型 */
    mimeType?: string
    /** 文件路径或 URI */
    uri?: string
    /** 标题 */
    title?: string
    /** 代码语言（type 为 code 时使用） */
    language?: string
    /** 表格数据（type 为 table 时使用） */
    tableData?: {
        headers: string[]
        rows: string[][]
    }
    /** 链接 URL（type 为 link 时使用） */
    url?: string
}

export interface ToolExecutionContext {
    workspacePath: string | null
    currentAssistantId?: string | null
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
