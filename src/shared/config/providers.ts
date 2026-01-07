/**
 * 统一的 LLM Provider 配置中心
 *
 * 设计原则：
 * 1. 单一数据源：所有 Provider 信息集中管理
 * 2. 多协议支持：OpenAI、Anthropic、Gemini、自定义协议
 * 3. 清晰路由：基于 providerId 和 protocol 决定使用哪个 Provider 实现
 */

// ============================================
// 核心类型定义
// ============================================

/** 认证类型 */
export type AuthType = 'bearer' | 'api-key' | 'header' | 'query' | 'none'

/** API 协议类型 */
export type ApiProtocol = 'openai' | 'anthropic' | 'gemini' | 'custom'

/** 认证配置 */
export interface AuthConfig {
  type: AuthType
  headerName?: string // 自定义 header 名称，如 'x-api-key'
  headerTemplate?: string // 自定义 header 值模板，如 'Bearer {{apiKey}}'
  queryParam?: string // query 参数名
  placeholder?: string // UI 显示的占位符
  helpUrl?: string // 帮助链接
}

/** 请求配置 */
export interface RequestConfig {
  endpoint: string
  method: 'POST' | 'GET'
  headers: Record<string, string>
  bodyTemplate: Record<string, unknown>
}

/** 响应解析配置（用于 custom 协议） */
export interface ResponseConfig {
  // SSE 配置
  dataPrefix?: string // SSE data 前缀，默认 'data:'
  doneMarker?: string // 结束标记，如 '[DONE]' 或 'message_stop'

  // 流式响应字段路径
  contentField: string // 内容字段，如 'delta.content' 或 'delta.text'
  reasoningField?: string // 推理字段，如 'delta.reasoning_content'
  finishReasonField?: string // 结束原因字段

  // 工具调用字段路径
  toolCallField?: string // 工具调用字段，如 'delta.tool_calls' 或 'content_block'
  toolNamePath?: string // 工具名称路径
  toolArgsPath?: string // 工具参数路径
  toolIdPath?: string // 工具 ID 路径
  argsIsObject?: boolean // 参数是否为对象（Anthropic 是 true，OpenAI 是 false）
}

/** 消息格式配置（用于 custom 协议） */
export interface MessageFormatConfig {
  // 系统消息处理
  systemMessageMode: 'message' | 'parameter' | 'first-user' // 作为消息、单独参数、合并到第一条用户消息
  systemParameterName?: string // 系统消息参数名，如 'system'

  // 工具结果消息
  toolResultRole: 'tool' | 'user' | 'function' // 工具结果的 role
  toolResultIdField: string // 工具调用 ID 字段名，如 'tool_call_id' 或 'tool_use_id'
  toolResultWrapper?: string // 包装类型，如 'tool_result'（Anthropic 需要）

  // 助手消息中的工具调用
  assistantToolCallField: string // 如 'tool_calls'（OpenAI）或 'content'（Anthropic）
  assistantToolCallFormat: 'openai' | 'anthropic' // 工具调用格式
}

/** 图片格式配置 - 完整的图片内容块模板 */
export interface ImageFormatConfig {
  // 完整的图片内容块模板，支持变量：{{url}}, {{base64}}, {{mediaType}}
  // OpenAI: { "type": "image_url", "image_url": { "url": "{{url}}" } }
  // Anthropic: { "type": "image", "source": { "type": "base64", "media_type": "{{mediaType}}", "data": "{{base64}}" } }
  template: Record<string, unknown>
}

/** 视觉配置（用于所有协议） */
export interface VisionConfig {
  // 是否启用图片发送（覆盖 features.vision）
  enabled?: boolean
  // 图片格式配置（覆盖默认格式）
  imageFormat?: ImageFormatConfig
}

/** 工具格式配置（用于 custom 协议） */
export interface ToolFormatConfig {
  wrapMode: 'none' | 'function' | 'tool' // 包装模式
  wrapField?: string // 包装字段名，如 'function'
  parameterField: 'parameters' | 'input_schema' | 'schema' // 参数字段名
  includeType: boolean // 是否包含 type 字段
}

/** LLM 适配器配置（完整的自定义协议配置） */
export interface LLMAdapterConfig {
  id: string
  name: string
  description?: string
  protocol: ApiProtocol
  request: RequestConfig
  response: ResponseConfig
  messageFormat?: MessageFormatConfig
  toolFormat?: ToolFormatConfig
}

/** 功能支持声明 */
export interface ProviderFeatures {
  streaming: boolean
  tools: boolean
  vision?: boolean
  reasoning?: boolean
}

/** LLM 参数默认值 */
export interface LLMDefaults {
  maxTokens: number
  temperature: number
  topP: number
  timeout: number
}

// ============================================
// 统一的 Provider 配置类型
// ============================================

/** Provider 基础配置（内置和自定义共用） */
export interface BaseProviderConfig {
  id: string
  name: string
  displayName: string
  description: string
  baseUrl: string
  models: string[]
  defaultModel: string
  protocol: ApiProtocol
  adapter: LLMAdapterConfig
  features: ProviderFeatures
  defaults: LLMDefaults
  auth: AuthConfig
}

/** 内置 Provider 定义 */
export interface BuiltinProviderDef extends BaseProviderConfig {
  readonly isBuiltin: true
}

/** 自定义 Provider 配置 */
export interface CustomProviderConfig extends BaseProviderConfig {
  isBuiltin: false
  createdAt?: number
  updatedAt?: number
}

/** 高级配置（覆盖默认行为） */
export interface AdvancedConfig {
  /** 认证配置 - 所有 provider 都可用 */
  auth?: { type?: AuthType; headerName?: string }
  /** 请求配置 */
  request?: { endpoint?: string; headers?: Record<string, string>; bodyTemplate?: Record<string, unknown> }
  /** 响应解析配置 - 仅用于 custom 协议 */
  response?: Partial<ResponseConfig>
  /** 消息格式配置 - 仅用于 custom 协议 */
  messageFormat?: Partial<MessageFormatConfig>
  /** 工具格式配置 - 仅用于 custom 协议 */
  toolFormat?: Partial<ToolFormatConfig>
  /** 视觉配置 - 所有 provider 都可用 */
  vision?: VisionConfig
}

/** 用户 Provider 配置（保存到配置文件，覆盖默认值） */
export interface UserProviderConfig {
  apiKey?: string
  baseUrl?: string
  timeout?: number
  model?: string
  customModels?: string[]
  adapterConfig?: LLMAdapterConfig
  advanced?: AdvancedConfig
  // 自定义厂商专用字段
  displayName?: string
  protocol?: ApiProtocol
  createdAt?: number
  updatedAt?: number
}

// ============================================
// 内置适配器预设
// ============================================

/** OpenAI 风格图片格式（大多数国产厂商兼容） */
export const OPENAI_IMAGE_FORMAT: ImageFormatConfig = {
  template: { type: 'image_url', image_url: { url: '{{url}}' } },
}

/** Anthropic 风格图片格式 */
export const ANTHROPIC_IMAGE_FORMAT: ImageFormatConfig = {
  template: { type: 'image', source: { type: 'base64', media_type: '{{mediaType}}', data: '{{base64}}' } },
}

export const OPENAI_ADAPTER: LLMAdapterConfig = {
  id: 'openai',
  name: 'OpenAI',
  description: 'OpenAI API 标准格式',
  protocol: 'openai',
  request: {
    endpoint: '/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: { stream: true },
  },
  response: {
    dataPrefix: 'data:',
    doneMarker: '[DONE]',
    contentField: 'delta.content',
    toolCallField: 'delta.tool_calls',
    toolNamePath: 'function.name',
    toolArgsPath: 'function.arguments',
    toolIdPath: 'id',
    argsIsObject: false,
    finishReasonField: 'finish_reason',
  },
  messageFormat: {
    systemMessageMode: 'message',
    toolResultRole: 'tool',
    toolResultIdField: 'tool_call_id',
    assistantToolCallField: 'tool_calls',
    assistantToolCallFormat: 'openai',
  },
  toolFormat: {
    wrapMode: 'function',
    wrapField: 'function',
    parameterField: 'parameters',
    includeType: true,
  },
}

export const ANTHROPIC_ADAPTER: LLMAdapterConfig = {
  id: 'anthropic',
  name: 'Anthropic',
  description: 'Claude API 格式',
  protocol: 'anthropic',
  request: {
    endpoint: '/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    bodyTemplate: { stream: true },
  },
  response: {
    dataPrefix: 'data:',
    doneMarker: 'message_stop',
    contentField: 'delta.text',
    reasoningField: 'thinking',
    toolCallField: 'content_block',
    toolNamePath: 'name',
    toolArgsPath: 'input',
    toolIdPath: 'id',
    argsIsObject: true,
    finishReasonField: 'stop_reason',
  },
  messageFormat: {
    systemMessageMode: 'parameter',
    systemParameterName: 'system',
    toolResultRole: 'user',
    toolResultIdField: 'tool_use_id',
    toolResultWrapper: 'tool_result',
    assistantToolCallField: 'content',
    assistantToolCallFormat: 'anthropic',
  },
  toolFormat: {
    wrapMode: 'none',
    parameterField: 'input_schema',
    includeType: false,
  },
}

export const GEMINI_ADAPTER: LLMAdapterConfig = {
  id: 'gemini',
  name: 'Google Gemini',
  description: 'Gemini 原生 API (使用 Google AI SDK)',
  protocol: 'gemini', // 使用原生 Gemini SDK
  request: {
    endpoint: '/models/{model}:streamGenerateContent',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: { stream: true },
  },
  response: {
    dataPrefix: 'data:',
    doneMarker: '',
    contentField: 'candidates.0.content.parts.0.text',
    toolCallField: 'candidates.0.content.parts',
    toolNamePath: 'functionCall.name',
    toolArgsPath: 'functionCall.args',
    toolIdPath: '',
    argsIsObject: true,
    finishReasonField: 'candidates.0.finishReason',
  },
  messageFormat: {
    systemMessageMode: 'parameter',
    systemParameterName: 'systemInstruction',
    toolResultRole: 'user',
    toolResultIdField: '',
    toolResultWrapper: 'functionResponse',
    assistantToolCallField: 'parts',
    assistantToolCallFormat: 'openai',
  },
  toolFormat: {
    wrapMode: 'none',
    parameterField: 'parameters',
    includeType: false,
  },
}

/** 智谱 GLM 适配器 - 原生 API */
export const ZHIPU_ADAPTER: LLMAdapterConfig = {
  id: 'zhipu',
  name: '智谱 GLM',
  description: '智谱 AI GLM 系列模型 (原生 API)',
  protocol: 'custom',
  request: {
    endpoint: '/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: { stream: true },
  },
  response: {
    dataPrefix: 'data:',
    doneMarker: '[DONE]',
    contentField: 'delta.content',
    reasoningField: 'delta.reasoning_content',
    toolCallField: 'delta.tool_calls',
    toolNamePath: 'function.name',
    toolArgsPath: 'function.arguments',
    toolIdPath: 'id',
    argsIsObject: false,
    finishReasonField: 'finish_reason',
  },
  messageFormat: {
    systemMessageMode: 'message',
    toolResultRole: 'tool',
    toolResultIdField: 'tool_call_id',
    assistantToolCallField: 'tool_calls',
    assistantToolCallFormat: 'openai',
  },
  toolFormat: {
    wrapMode: 'function',
    wrapField: 'function',
    parameterField: 'parameters',
    includeType: true,
  },
}

/** 阿里通义千问适配器 - DashScope 原生 API */
export const QWEN_ADAPTER: LLMAdapterConfig = {
  id: 'qwen',
  name: '阿里通义千问',
  description: '阿里云 DashScope 原生 API',
  protocol: 'custom',
  request: {
    endpoint: '/services/aigc/text-generation/generation',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DashScope-SSE': 'enable',
    },
    bodyTemplate: {
      input: {},
      parameters: {
        result_format: 'message',
        incremental_output: true,
      },
    },
  },
  response: {
    dataPrefix: 'data:',
    doneMarker: '',
    contentField: 'output.choices.0.message.content',
    reasoningField: 'output.choices.0.message.reasoning_content',
    toolCallField: 'output.choices.0.message.tool_calls',
    toolNamePath: 'function.name',
    toolArgsPath: 'function.arguments',
    toolIdPath: 'id',
    argsIsObject: false,
    finishReasonField: 'output.choices.0.finish_reason',
  },
  messageFormat: {
    systemMessageMode: 'message',
    toolResultRole: 'tool',
    toolResultIdField: 'tool_call_id',
    assistantToolCallField: 'tool_calls',
    assistantToolCallFormat: 'openai',
  },
  toolFormat: {
    wrapMode: 'function',
    wrapField: 'function',
    parameterField: 'parameters',
    includeType: true,
  },
}

/** 百度文心一言适配器 - ERNIE API */
export const ERNIE_ADAPTER: LLMAdapterConfig = {
  id: 'ernie',
  name: '百度文心一言',
  description: '百度 ERNIE API',
  protocol: 'custom',
  request: {
    endpoint: '/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: { stream: true },
  },
  response: {
    dataPrefix: 'data:',
    doneMarker: '[DONE]',
    contentField: 'result',
    reasoningField: '',
    toolCallField: 'function_call',
    toolNamePath: 'name',
    toolArgsPath: 'arguments',
    toolIdPath: 'id',
    argsIsObject: false,
    finishReasonField: 'is_end',
  },
  messageFormat: {
    systemMessageMode: 'parameter',
    systemParameterName: 'system',
    toolResultRole: 'function',
    toolResultIdField: 'name',
    assistantToolCallField: 'function_call',
    assistantToolCallFormat: 'openai',
  },
  toolFormat: {
    wrapMode: 'none',
    parameterField: 'parameters',
    includeType: false,
  },
}

/** 字节豆包适配器 - 火山引擎 API */
export const DOUBAO_ADAPTER: LLMAdapterConfig = {
  id: 'doubao',
  name: '字节豆包',
  description: '火山引擎豆包大模型 API',
  protocol: 'custom',
  request: {
    endpoint: '/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: { stream: true },
  },
  response: {
    dataPrefix: 'data:',
    doneMarker: '[DONE]',
    contentField: 'delta.content',
    reasoningField: 'delta.reasoning_content',
    toolCallField: 'delta.tool_calls',
    toolNamePath: 'function.name',
    toolArgsPath: 'function.arguments',
    toolIdPath: 'id',
    argsIsObject: false,
    finishReasonField: 'finish_reason',
  },
  messageFormat: {
    systemMessageMode: 'message',
    toolResultRole: 'tool',
    toolResultIdField: 'tool_call_id',
    assistantToolCallField: 'tool_calls',
    assistantToolCallFormat: 'openai',
  },
  toolFormat: {
    wrapMode: 'function',
    wrapField: 'function',
    parameterField: 'parameters',
    includeType: true,
  },
}

/** DeepSeek 适配器 */
export const DEEPSEEK_ADAPTER: LLMAdapterConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  description: 'DeepSeek API',
  protocol: 'custom',
  request: {
    endpoint: '/chat/completions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: { stream: true },
  },
  response: {
    dataPrefix: 'data:',
    doneMarker: '[DONE]',
    contentField: 'delta.content',
    reasoningField: 'delta.reasoning_content',
    toolCallField: 'delta.tool_calls',
    toolNamePath: 'function.name',
    toolArgsPath: 'function.arguments',
    toolIdPath: 'id',
    argsIsObject: false,
    finishReasonField: 'finish_reason',
  },
  messageFormat: {
    systemMessageMode: 'message',
    toolResultRole: 'tool',
    toolResultIdField: 'tool_call_id',
    assistantToolCallField: 'tool_calls',
    assistantToolCallFormat: 'openai',
  },
  toolFormat: {
    wrapMode: 'function',
    wrapField: 'function',
    parameterField: 'parameters',
    includeType: true,
  },
}

/** 所有内置适配器 */
export const BUILTIN_ADAPTERS: Record<string, LLMAdapterConfig> = {
  openai: OPENAI_ADAPTER,
  anthropic: ANTHROPIC_ADAPTER,
  gemini: GEMINI_ADAPTER,
  zhipu: ZHIPU_ADAPTER,
  qwen: QWEN_ADAPTER,
  ernie: ERNIE_ADAPTER,
  doubao: DOUBAO_ADAPTER,
  deepseek: DEEPSEEK_ADAPTER,
}

// ============================================
// 内置 Provider 定义
// ============================================

export const BUILTIN_PROVIDERS: Record<string, BuiltinProviderDef> = {
  openai: {
    id: 'openai',
    name: 'openai',
    displayName: 'OpenAI',
    description: 'GPT-4, GPT-4o, o1 等模型',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
    defaultModel: 'gpt-4o',
    protocol: 'openai',
    adapter: OPENAI_ADAPTER,
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-proj-...', helpUrl: 'https://platform.openai.com/api-keys' },
    isBuiltin: true,
  },

  anthropic: {
    id: 'anthropic',
    name: 'anthropic',
    displayName: 'Anthropic',
    description: 'Claude 3.5, Claude 4 等模型',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    defaultModel: 'claude-sonnet-4-20250514',
    protocol: 'anthropic',
    adapter: ANTHROPIC_ADAPTER,
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'api-key', headerName: 'x-api-key', placeholder: 'sk-ant-...', helpUrl: 'https://console.anthropic.com/settings/keys' },
    isBuiltin: true,
  },

  gemini: {
    id: 'gemini',
    name: 'gemini',
    displayName: 'Google Gemini',
    description: 'Gemini Pro, Gemini Flash 等模型',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.5-pro-preview-05-06'],
    defaultModel: 'gemini-2.0-flash-exp',
    protocol: 'gemini', // 使用原生 Gemini SDK
    adapter: GEMINI_ADAPTER,
    features: { streaming: true, tools: true, vision: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'query', queryParam: 'key', placeholder: 'AIzaSy...', helpUrl: 'https://aistudio.google.com/apikey' },
    isBuiltin: true,
  },
}

// ============================================
// 辅助函数
// ============================================

/** 获取内置 Provider ID 列表 */
export function getBuiltinProviderIds(): string[] {
  return Object.keys(BUILTIN_PROVIDERS)
}

/** 判断是否为内置 Provider */
export function isBuiltinProvider(providerId: string): boolean {
  return providerId in BUILTIN_PROVIDERS
}

/** 获取内置 Provider 定义 */
export function getBuiltinProvider(providerId: string): BuiltinProviderDef | undefined {
  return BUILTIN_PROVIDERS[providerId]
}

/** 获取 Provider 的适配器配置 */
export function getAdapterConfig(providerId: string): LLMAdapterConfig {
  const provider = BUILTIN_PROVIDERS[providerId]
  return provider?.adapter || OPENAI_ADAPTER
}

/** 获取所有内置适配器 */
export function getBuiltinAdapters(): LLMAdapterConfig[] {
  return Object.values(BUILTIN_ADAPTERS)
}

/** 获取 Provider 的默认模型 */
export function getProviderDefaultModel(providerId: string): string {
  const provider = BUILTIN_PROVIDERS[providerId]
  return provider?.defaultModel || provider?.models[0] || ''
}

/** 获取 Provider 的协议类型 */
export function getProviderProtocol(providerId: string): ApiProtocol {
  const provider = BUILTIN_PROVIDERS[providerId]
  return provider?.protocol || 'openai'
}

/**
 * 根据 provider 类型清理高级配置
 * 移除对特定 provider 无效的配置项
 */
export function cleanAdvancedConfig(providerId: string, advanced?: AdvancedConfig): AdvancedConfig | undefined {
  if (!advanced) return undefined

  const provider = getBuiltinProvider(providerId)
  const protocol = provider?.protocol || 'custom'
  const cleaned: AdvancedConfig = {}

  // auth 配置对所有 provider 都有效
  if (advanced.auth) {
    cleaned.auth = advanced.auth
  }

  // request 配置
  if (advanced.request) {
    const { headers, bodyTemplate } = advanced.request
    if (headers || bodyTemplate) {
      cleaned.request = {}
      if (headers) cleaned.request.headers = headers
      if (bodyTemplate) cleaned.request.bodyTemplate = bodyTemplate
    }
  }

  // response 配置仅对 custom 协议有效（内置协议使用 SDK 自动解析）
  if (protocol === 'custom' && advanced.response) {
    cleaned.response = advanced.response
  }

  // vision 配置对所有 provider 都有效
  if (advanced.vision) {
    cleaned.vision = advanced.vision
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

/** 获取 provider 支持的高级配置字段 */
export function getSupportedAdvancedFields(providerId: string): {
  auth: boolean
  request: { endpoint: boolean; headers: boolean; bodyTemplate: boolean }
  response: boolean
} {
  const provider = getBuiltinProvider(providerId)
  const protocol = provider?.protocol || 'custom'

  return {
    auth: true,
    request: {
      endpoint: protocol === 'custom',
      headers: true,
      bodyTemplate: true,
    },
    response: protocol === 'custom',
  }
}

// ============================================
// UI 组件使用的辅助类型和函数
// ============================================

/** Provider 信息（用于 UI 显示） */
export interface ProviderInfo {
  id: string
  name: string
  displayName: string
  description: string
  models: string[]
  protocol: ApiProtocol
  auth: { type: string; placeholder: string; helpUrl?: string; headerName?: string }
  endpoint: { default: string }
  defaults: { timeout: number }
}

/** 获取所有 Provider 信息（用于 UI） */
export function getProviders(): Record<string, ProviderInfo> {
  const result: Record<string, ProviderInfo> = {}
  for (const [id, def] of Object.entries(BUILTIN_PROVIDERS)) {
    result[id] = {
      id: def.id,
      name: def.name,
      displayName: def.displayName,
      description: def.description,
      models: def.models,
      protocol: def.protocol,
      auth: {
        type: def.auth.type,
        placeholder: def.auth.placeholder || '',
        helpUrl: def.auth.helpUrl,
        headerName: def.auth.headerName,
      },
      endpoint: { default: def.baseUrl },
      defaults: { timeout: def.defaults.timeout },
    }
  }
  return result
}

/** PROVIDERS 常量（用于 UI 组件） */
export const PROVIDERS = getProviders()
