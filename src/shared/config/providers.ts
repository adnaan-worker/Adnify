/**
 * 统一的 LLM Provider 配置中心
 * 合并原 provider.ts 和 llmAdapter.ts 的定义
 * 
 * 设计原则：
 * 1. 单一数据源：所有 Provider 信息集中管理
 * 2. 可扩展性：支持自定义 Provider 和适配器
 * 3. 类型安全：完整的 TypeScript 类型定义
 */

// ============================================
// 类型定义
// ============================================

/** 认证类型 */
export type AuthType = 'api-key' | 'oauth' | 'none'

/** 请求配置 */
export interface RequestConfig {
    endpoint: string              // API 路径 (如 '/chat/completions')
    method: 'POST' | 'GET'
    headers: Record<string, string>
    bodyTemplate: Record<string, unknown>
}

/** 响应解析配置 */
export interface ResponseConfig {
    // 流式响应字段路径（相对于 choice.delta）
    contentField: string          // 内容字段 'content'
    reasoningField?: string       // 思考字段 'reasoning_content'
    toolCallField?: string        // 工具调用 'tool_calls'
    finishReasonField?: string    // 完成原因 'finish_reason'

    // 工具调用解析（相对于 tool_call 对象）
    toolNamePath?: string         // 工具名 'function.name'
    toolArgsPath?: string         // 参数 'function.arguments'
    toolIdPath?: string           // ID 'id'
    argsIsObject?: boolean        // 参数是否已是对象

    // 结束标记
    doneMarker?: string           // 流结束标记 '[DONE]'
}

// ============================================
// 工具调用配置（从 providerAdapter.ts 合并）
// ============================================

/** 工具定义格式配置 */
export interface ToolFormatConfig {
    /** 工具包装模式: none=直接输出, function=OpenAI风格, tool=Anthropic风格 */
    wrapMode: 'none' | 'function' | 'tool'
    /** 包装字段名 (如 "function", "tool") */
    wrapField?: string
    /** 参数字段映射 */
    parameterField: 'parameters' | 'input_schema' | 'schema'
    /** 是否需要 type 字段 */
    includeType: boolean
}

/** XML 解析配置 */
export interface XMLParseConfig {
    /** 工具调用标签名 (如 "tool_call", "function_call") */
    toolCallTag: string
    /** 工具名称来源 ("name"=子元素, "@name"=属性) */
    nameSource: string
    /** 参数标签名 */
    argsTag: string
    /** 参数内部格式 */
    argsFormat: 'json' | 'xml' | 'key-value'
}

/** 工具调用解析配置 */
export interface ToolParseConfig {
    /** 响应格式类型 */
    responseFormat: 'json' | 'xml' | 'mixed'
    /** 工具调用路径 (JSON) */
    toolCallPath?: string
    /** 工具名称路径 */
    toolNamePath?: string
    /** 工具参数路径 */
    toolArgsPath?: string
    /** 参数是否已是对象 */
    argsIsObject?: boolean
    /** 工具 ID 路径 */
    toolIdPath?: string
    /** 是否自动生成 ID */
    autoGenerateId?: boolean
    /** XML 配置 (当 responseFormat 为 xml 或 mixed 时) */
    xmlConfig?: XMLParseConfig
}

/** 消息格式配置 */
export interface MessageFormatConfig {
    /** tool 结果消息的角色名 */
    toolResultRole: 'tool' | 'user' | 'function'
    /** tool_call_id 字段名 */
    toolCallIdField: string
    /** 是否需要包装 tool_result */
    wrapToolResult: boolean
    /** tool_result 包装标签 */
    toolResultWrapper?: string
}

/** 解析后的工具调用 */
export interface ParsedToolCall {
    id: string
    name: string
    arguments: Record<string, unknown>
}

/** LLM 适配器配置 */
export interface LLMAdapterConfig {
    id: string
    name: string
    description?: string
    request: RequestConfig
    response: ResponseConfig
    isBuiltin?: boolean
    // 工具调用配置（可选，用于高级自定义）
    toolFormat?: ToolFormatConfig
    toolParse?: ToolParseConfig
    messageFormat?: MessageFormatConfig
}

/** 功能支持声明 */
export interface ProviderFeatures {
    streaming: boolean
    tools: boolean
    vision: boolean
    reasoning?: boolean
    codeCompletion?: boolean
}

/** 默认参数配置 */
export interface ProviderDefaults {
    temperature?: number
    topP?: number
    maxTokens?: number
    timeout?: number
}

/** 统一的 Provider 配置 */
export interface UnifiedProviderConfig {
    // 基础信息
    id: string
    name: string
    displayName: string
    description: string
    isLocal?: boolean

    // 认证配置
    auth: {
        type: AuthType
        placeholder?: string
        helpUrl?: string
    }

    // 端点配置
    endpoint: {
        default: string
        customizable: boolean
    }

    // 模型配置
    models: {
        default: string[]
        recommended?: string
    }

    // 适配器配置
    adapter: LLMAdapterConfig

    // 功能支持
    features: ProviderFeatures

    // 默认参数
    defaults: ProviderDefaults
}

// ============================================
// 内置适配器预设
// ============================================

const OPENAI_ADAPTER: LLMAdapterConfig = {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI API 标准格式',
    isBuiltin: true,
    request: {
        endpoint: '/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        bodyTemplate: {
            model: '{{model}}',
            messages: '{{messages}}',
            stream: true,
            max_tokens: 8192,
        }
    },
    response: {
        contentField: 'content',
        toolCallField: 'tool_calls',
        toolNamePath: 'function.name',
        toolArgsPath: 'function.arguments',
        toolIdPath: 'id',
        argsIsObject: false,
        finishReasonField: 'finish_reason',
        doneMarker: '[DONE]',
    },
    // 工具调用配置
    toolFormat: {
        wrapMode: 'function',
        wrapField: 'function',
        parameterField: 'parameters',
        includeType: true,
    },
    toolParse: {
        responseFormat: 'json',
        toolCallPath: 'tool_calls',
        toolNamePath: 'function.name',
        toolArgsPath: 'function.arguments',
        argsIsObject: false,
        toolIdPath: 'id',
        autoGenerateId: false,
    },
    messageFormat: {
        toolResultRole: 'tool',
        toolCallIdField: 'tool_call_id',
        wrapToolResult: false,
    },
}

const ANTHROPIC_ADAPTER: LLMAdapterConfig = {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude API 格式',
    isBuiltin: true,
    request: {
        endpoint: '/messages',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2024-01-01',
        },
        bodyTemplate: {
            model: '{{model}}',
            messages: '{{messages}}',
            stream: true,
            max_tokens: 8192,
        }
    },
    response: {
        contentField: 'text',
        toolCallField: 'content_block',
        toolNamePath: 'name',
        toolArgsPath: 'input',
        toolIdPath: 'id',
        argsIsObject: true,
        finishReasonField: 'stop_reason',
        doneMarker: 'message_stop',
    },
    // Anthropic 特有的工具调用格式
    toolFormat: {
        wrapMode: 'none',
        parameterField: 'input_schema',
        includeType: false,
    },
    toolParse: {
        responseFormat: 'json',
        toolCallPath: 'tool_use',
        toolNamePath: 'name',
        toolArgsPath: 'input',
        argsIsObject: true,
        toolIdPath: 'id',
        autoGenerateId: false,
    },
    messageFormat: {
        toolResultRole: 'user',
        toolCallIdField: 'tool_use_id',
        wrapToolResult: true,
        toolResultWrapper: 'tool_result',
    },
}

const GEMINI_ADAPTER: LLMAdapterConfig = {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Gemini API 格式',
    isBuiltin: true,
    request: {
        endpoint: '/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        bodyTemplate: {
            model: '{{model}}',
            messages: '{{messages}}',
            stream: true,
            max_tokens: 8192,
        }
    },
    response: {
        contentField: 'content',
        toolCallField: 'tool_calls',
        toolNamePath: 'function.name',
        toolArgsPath: 'function.arguments',
        toolIdPath: 'id',
        argsIsObject: false,
        finishReasonField: 'finish_reason',
        doneMarker: '[DONE]',
    }
}

const DEEPSEEK_ADAPTER: LLMAdapterConfig = {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek API 格式 (支持 Reasoning)',
    isBuiltin: true,
    request: {
        endpoint: '/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        bodyTemplate: {
            model: '{{model}}',
            messages: '{{messages}}',
            stream: true,
            max_tokens: 8192,
        }
    },
    response: {
        contentField: 'content',
        reasoningField: 'reasoning_content',
        toolCallField: 'tool_calls',
        toolNamePath: 'function.name',
        toolArgsPath: 'function.arguments',
        toolIdPath: 'id',
        argsIsObject: false,
        finishReasonField: 'finish_reason',
        doneMarker: '[DONE]',
    }
}

const ZHIPU_ADAPTER: LLMAdapterConfig = {
    id: 'zhipu',
    name: '智谱 GLM',
    description: 'GLM API 格式 (支持 Thinking)',
    isBuiltin: true,
    request: {
        endpoint: '/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        bodyTemplate: {
            model: '{{model}}',
            messages: '{{messages}}',
            stream: true,
            max_tokens: 8192,
        }
    },
    response: {
        contentField: 'content',
        reasoningField: 'reasoning_content',
        toolCallField: 'tool_calls',
        toolNamePath: 'function.name',
        toolArgsPath: 'function.arguments',
        toolIdPath: 'id',
        argsIsObject: true,
        finishReasonField: 'finish_reason',
        doneMarker: '[DONE]',
    }
}

const OLLAMA_ADAPTER: LLMAdapterConfig = {
    id: 'ollama',
    name: 'Ollama',
    description: '本地模型 API',
    isBuiltin: true,
    request: {
        endpoint: '/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        bodyTemplate: {
            model: '{{model}}',
            messages: '{{messages}}',
            stream: true,
        }
    },
    response: {
        contentField: 'content',
        toolCallField: 'tool_calls',
        toolNamePath: 'function.name',
        toolArgsPath: 'function.arguments',
        toolIdPath: 'id',
        argsIsObject: false,
        finishReasonField: 'finish_reason',
        doneMarker: '[DONE]',
    }
}

// ============================================
// 内置 Provider 配置
// ============================================

export const PROVIDERS: Record<string, UnifiedProviderConfig> = {
    openai: {
        id: 'openai',
        name: 'openai',
        displayName: 'OpenAI',
        description: 'GPT-4, GPT-4o, o1 等模型',
        auth: {
            type: 'api-key',
            placeholder: 'sk-proj-...',
            helpUrl: 'https://platform.openai.com/api-keys',
        },
        endpoint: {
            default: 'https://api.openai.com/v1',
            customizable: true,
        },
        models: {
            default: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
            recommended: 'gpt-4o',
        },
        adapter: OPENAI_ADAPTER,
        features: {
            streaming: true,
            tools: true,
            vision: true,
            reasoning: true,
        },
        defaults: {
            temperature: 0.7,
            topP: 1,
            maxTokens: 8192,
            timeout: 120000,
        },
    },

    anthropic: {
        id: 'anthropic',
        name: 'anthropic',
        displayName: 'Anthropic',
        description: 'Claude 3.5, Claude 3 等模型',
        auth: {
            type: 'api-key',
            placeholder: 'sk-ant-...',
            helpUrl: 'https://console.anthropic.com/settings/keys',
        },
        endpoint: {
            default: 'https://api.anthropic.com',
            customizable: true,
        },
        models: {
            default: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
            recommended: 'claude-sonnet-4-20250514',
        },
        adapter: ANTHROPIC_ADAPTER,
        features: {
            streaming: true,
            tools: true,
            vision: true,
        },
        defaults: {
            temperature: 0.7,
            topP: 1,
            maxTokens: 8192,
            timeout: 120000,
        },
    },

    gemini: {
        id: 'gemini',
        name: 'gemini',
        displayName: 'Google Gemini',
        description: 'Gemini Pro, Gemini Flash 等模型',
        auth: {
            type: 'api-key',
            placeholder: 'AIzaSy...',
            helpUrl: 'https://aistudio.google.com/apikey',
        },
        endpoint: {
            default: 'https://generativelanguage.googleapis.com/v1beta/openai',
            customizable: false,
        },
        models: {
            default: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'],
            recommended: 'gemini-2.0-flash-exp',
        },
        adapter: GEMINI_ADAPTER,
        features: {
            streaming: true,
            tools: true,
            vision: true,
        },
        defaults: {
            temperature: 0.7,
            topP: 1,
            maxTokens: 8192,
            timeout: 120000,
        },
    },

    deepseek: {
        id: 'deepseek',
        name: 'deepseek',
        displayName: 'DeepSeek',
        description: 'DeepSeek V3, R1 等模型',
        auth: {
            type: 'api-key',
            placeholder: 'sk-...',
            helpUrl: 'https://platform.deepseek.com/api_keys',
        },
        endpoint: {
            default: 'https://api.deepseek.com',
            customizable: true,
        },
        models: {
            default: ['deepseek-chat', 'deepseek-reasoner'],
            recommended: 'deepseek-chat',
        },
        adapter: DEEPSEEK_ADAPTER,
        features: {
            streaming: true,
            tools: true,
            vision: false,
            reasoning: true,
        },
        defaults: {
            temperature: 0.7,
            topP: 1,
            maxTokens: 8192,
            timeout: 120000,
        },
    },

    groq: {
        id: 'groq',
        name: 'groq',
        displayName: 'Groq',
        description: '超快推理，Llama, Mixtral 等',
        auth: {
            type: 'api-key',
            placeholder: 'gsk_...',
            helpUrl: 'https://console.groq.com/keys',
        },
        endpoint: {
            default: 'https://api.groq.com/openai/v1',
            customizable: false,
        },
        models: {
            default: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
            recommended: 'llama-3.3-70b-versatile',
        },
        adapter: OPENAI_ADAPTER,
        features: {
            streaming: true,
            tools: true,
            vision: false,
        },
        defaults: {
            temperature: 0.7,
            topP: 1,
            maxTokens: 8192,
            timeout: 60000,
        },
    },

    mistral: {
        id: 'mistral',
        name: 'mistral',
        displayName: 'Mistral AI',
        description: 'Mistral Large, Codestral 等',
        auth: {
            type: 'api-key',
            placeholder: 'api-...',
            helpUrl: 'https://console.mistral.ai/api-keys',
        },
        endpoint: {
            default: 'https://api.mistral.ai/v1',
            customizable: false,
        },
        models: {
            default: ['mistral-large-latest', 'codestral-latest', 'mistral-small-latest'],
            recommended: 'mistral-large-latest',
        },
        adapter: OPENAI_ADAPTER,
        features: {
            streaming: true,
            tools: true,
            vision: false,
            codeCompletion: true,
        },
        defaults: {
            temperature: 0.7,
            topP: 1,
            maxTokens: 8192,
            timeout: 120000,
        },
    },

    zhipu: {
        id: 'zhipu',
        name: 'zhipu',
        displayName: '智谱 GLM',
        description: 'GLM-4.7, GLM-4.5 系列',
        auth: {
            type: 'api-key',
            placeholder: 'api-...',
            helpUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
        },
        endpoint: {
            default: 'https://open.bigmodel.cn/api/paas/v4',
            customizable: true,
        },
        models: {
            default: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
            recommended: 'glm-4-plus',
        },
        adapter: ZHIPU_ADAPTER,
        features: {
            streaming: true,
            tools: true,
            vision: true,
            reasoning: true,
        },
        defaults: {
            temperature: 0.7,
            topP: 1,
            maxTokens: 8192,
            timeout: 120000,
        },
    },

    qwen: {
        id: 'qwen',
        name: 'qwen',
        displayName: '阿里 Qwen',
        description: 'Qwen 系列 (通义千问)',
        auth: {
            type: 'api-key',
            placeholder: 'sk-...',
            helpUrl: 'https://dashscope.console.aliyun.com/apiKey',
        },
        endpoint: {
            default: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            customizable: true,
        },
        models: {
            default: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
            recommended: 'qwen-plus',
        },
        adapter: OPENAI_ADAPTER,
        features: {
            streaming: true,
            tools: true,
            vision: true,
        },
        defaults: {
            temperature: 0.7,
            topP: 1,
            maxTokens: 8192,
            timeout: 120000,
        },
    },

    ollama: {
        id: 'ollama',
        name: 'ollama',
        displayName: 'Ollama',
        description: '本地运行开源模型',
        isLocal: true,
        auth: {
            type: 'none',
            placeholder: '(无需 API Key)',
        },
        endpoint: {
            default: 'http://localhost:11434/v1',
            customizable: true,
        },
        models: {
            default: ['llama3.2', 'codellama', 'deepseek-coder-v2', 'qwen2.5-coder'],
            recommended: 'llama3.2',
        },
        adapter: OLLAMA_ADAPTER,
        features: {
            streaming: true,
            tools: true,
            vision: false,
        },
        defaults: {
            temperature: 0.7,
            topP: 1,
            maxTokens: 4096,
            timeout: 300000, // 本地模型可能较慢
        },
    },

    custom: {
        id: 'custom',
        name: 'custom',
        displayName: 'Custom',
        description: '自定义 API 端点',
        auth: {
            type: 'api-key',
            placeholder: 'your-api-key',
        },
        endpoint: {
            default: 'https://api.example.com/v1',
            customizable: true,
        },
        models: {
            default: [],
            recommended: undefined,
        },
        adapter: OPENAI_ADAPTER,
        features: {
            streaming: true,
            tools: true,
            vision: false,
        },
        defaults: {
            temperature: 0.7,
            topP: 1,
            maxTokens: 8192,
            timeout: 120000,
        },
    },
}

// ============================================
// 辅助函数
// ============================================

/** 获取所有 Provider ID 列表 */
export function getProviderIds(): string[] {
    return Object.keys(PROVIDERS)
}

/** 获取 Provider 配置 */
export function getProvider(id: string): UnifiedProviderConfig | undefined {
    return PROVIDERS[id]
}

/** 获取 Provider 的端点 URL */
export function getProviderEndpoint(id: string, customUrl?: string): string {
    const provider = PROVIDERS[id]
    if (!provider) return customUrl || ''

    if (customUrl && provider.endpoint.customizable) {
        return customUrl
    }
    return provider.endpoint.default
}

/** 获取 Provider 的默认模型 */
export function getProviderDefaultModel(id: string): string {
    const provider = PROVIDERS[id]
    if (!provider) return ''
    return provider.models.recommended || provider.models.default[0] || ''
}

/** 获取适配器配置 */
export function getAdapterConfig(providerId: string): LLMAdapterConfig {
    const provider = PROVIDERS[providerId]
    return provider?.adapter || OPENAI_ADAPTER
}

const XML_GENERIC_ADAPTER: LLMAdapterConfig = {
    id: 'xml-generic',
    name: 'XML Format',
    description: '通用 XML 工具调用格式',
    isBuiltin: true,
    request: {
        endpoint: '/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        bodyTemplate: {
            model: '{{model}}',
            messages: '{{messages}}',
            stream: true,
        }
    },
    response: {
        contentField: 'content',
        // XML 模式下主要依赖 toolParse 配置
        doneMarker: '[DONE]',
    },
    toolFormat: {
        wrapMode: 'function',
        wrapField: 'function',
        parameterField: 'parameters',
        includeType: true,
    },
    toolParse: {
        responseFormat: 'xml',
        autoGenerateId: true,
        xmlConfig: {
            toolCallTag: 'tool_call',
            nameSource: 'name',
            argsTag: 'arguments',
            argsFormat: 'json',
        }
    },
    messageFormat: {
        toolResultRole: 'user',
        toolCallIdField: 'tool_call_id',
        wrapToolResult: true,
        toolResultWrapper: 'tool_result',
    }
}

const MIXED_ADAPTER: LLMAdapterConfig = {
    id: 'mixed',
    name: 'Mixed Format',
    description: '混合格式 (JSON 优先，XML 回退)',
    isBuiltin: true,
    request: {
        endpoint: '/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        bodyTemplate: {
            model: '{{model}}',
            messages: '{{messages}}',
            stream: true,
        }
    },
    response: {
        contentField: 'content',
        toolCallField: 'tool_calls',
        toolNamePath: 'function.name',
        toolArgsPath: 'function.arguments',
        toolIdPath: 'id',
        argsIsObject: false,
        doneMarker: '[DONE]',
    },
    toolFormat: {
        wrapMode: 'function',
        wrapField: 'function',
        parameterField: 'parameters',
        includeType: true,
    },
    toolParse: {
        responseFormat: 'mixed',
        toolCallPath: 'tool_calls',
        toolNamePath: 'function.name',
        toolArgsPath: 'function.arguments',
        argsIsObject: false,
        toolIdPath: 'id',
        autoGenerateId: true,
        xmlConfig: {
            toolCallTag: 'tool_call',
            nameSource: 'name',
            argsTag: 'arguments',
            argsFormat: 'json',
        }
    },
    messageFormat: {
        toolResultRole: 'tool',
        toolCallIdField: 'tool_call_id',
        wrapToolResult: false,
    }
}

/** 获取所有内置适配器 */
export function getBuiltinAdapters(): LLMAdapterConfig[] {
    return [
        OPENAI_ADAPTER,
        ANTHROPIC_ADAPTER,
        GEMINI_ADAPTER,
        DEEPSEEK_ADAPTER,
        ZHIPU_ADAPTER,
        OLLAMA_ADAPTER,
        XML_GENERIC_ADAPTER,
        MIXED_ADAPTER,
    ]
}

/** 根据 ID 获取适配器 */
export function getBuiltinAdapter(id: string): LLMAdapterConfig | undefined {
    return getBuiltinAdapters().find(a => a.id === id)
}

/** 创建自定义适配器 */
export function createCustomAdapter(baseId: string, overrides: Partial<LLMAdapterConfig>): LLMAdapterConfig {
    const base = getBuiltinAdapter(baseId) || OPENAI_ADAPTER
    return {
        ...base,
        ...overrides,
        id: overrides.id || `custom-${Date.now()}`,
        isBuiltin: false,
    }
}

// ============================================
// 类型导出（向后兼容）
// ============================================

/** Provider 类型（向后兼容） */
export type ProviderType = keyof typeof PROVIDERS

/** 内置 Provider 名称（向后兼容） */
export type BuiltinProviderName = Exclude<ProviderType, 'custom'>
