/**
 * 统一的 LLM Provider 配置中心
 *
 * 设计原则：
 * 1. 单一数据源：所有 Provider 信息集中管理
 * 2. 统一配置类型：BuiltinProviderDef 和 CustomProviderConfig 共用核心类型
 * 3. 清晰路由：基于 providerId 决定使用哪个 Provider 实现
 */

// ============================================
// 核心类型定义
// ============================================

/** 认证类型 */
export type AuthType = 'bearer' | 'api-key' | 'header' | 'query' | 'none'

/** 认证配置 */
export interface AuthConfig {
  type: AuthType
  headerName?: string
  headerTemplate?: string
  queryParam?: string
  placeholder?: string
  helpUrl?: string
}

/** 请求配置 */
export interface RequestConfig {
  endpoint: string
  method: 'POST' | 'GET'
  headers: Record<string, string>
  bodyTemplate: Record<string, unknown>
}

/** 响应解析配置 */
export interface ResponseConfig {
  contentField: string
  reasoningField?: string
  toolCallField?: string
  finishReasonField?: string
  toolNamePath?: string
  toolArgsPath?: string
  toolIdPath?: string
  argsIsObject?: boolean
  doneMarker?: string
}

/** LLM 适配器配置 */
export interface LLMAdapterConfig {
  id: string
  name: string
  description?: string
  request: RequestConfig
  response: ResponseConfig
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

/** Provider 模式 */
export type ProviderMode = 'openai' | 'anthropic' | 'gemini' | 'custom'

/** 自定义模式配置 */
export interface CustomModeConfig {
  request: {
    endpoint: string
    method: 'POST' | 'GET'
    headers?: Record<string, string>
    bodyTemplate: Record<string, unknown>
  }
  response: {
    sseConfig: { dataPrefix?: string; doneMarker: string }
    streaming: {
      contentField: string
      reasoningField?: string
      toolCallsField?: string
      toolNameField?: string
      toolArgsField?: string
      toolIdField?: string
      finishReasonField?: string
    }
    toolCall: { mode: string; argsIsObject?: boolean }
  }
  auth: { type: string; headerName?: string }
}

/** Provider 基础配置（内置和自定义共用） */
export interface BaseProviderConfig {
  id: string
  name: string
  displayName: string
  description: string
  baseUrl: string
  models: string[]
  defaultModel: string
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
  mode: ProviderMode
  customConfig?: CustomModeConfig
  createdAt?: number
  updatedAt?: number
}

/** 高级配置（覆盖默认行为） */
export interface AdvancedConfig {
  auth?: { type?: AuthType; headerName?: string }
  request?: { endpoint?: string; headers?: Record<string, string>; bodyTemplate?: Record<string, unknown> }
  response?: {
    contentField?: string
    reasoningField?: string
    toolCallField?: string
    toolNamePath?: string
    toolArgsPath?: string
    argsIsObject?: boolean
    doneMarker?: string
  }
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
}

// ============================================
// 内置适配器预设
// ============================================

export const OPENAI_ADAPTER: LLMAdapterConfig = {
  id: 'openai',
  name: 'OpenAI',
  description: 'OpenAI API 标准格式',
  request: {
    endpoint: '/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    bodyTemplate: {
      stream: true,
    },
  },
  response: {
    contentField: 'delta.content',
    toolCallField: 'delta.tool_calls',
    toolNamePath: 'function.name',
    toolArgsPath: 'function.arguments',
    toolIdPath: 'id',
    argsIsObject: false,
    finishReasonField: 'finish_reason',
    doneMarker: '[DONE]',
  },
}

export const ANTHROPIC_ADAPTER: LLMAdapterConfig = {
  id: 'anthropic',
  name: 'Anthropic',
  description: 'Claude API 格式',
  request: {
    endpoint: '/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    bodyTemplate: {
      stream: true,
    },
  },
  response: {
    contentField: 'delta.text',
    reasoningField: 'thinking',
    toolCallField: 'content_block',
    toolNamePath: 'name',
    toolArgsPath: 'input',
    toolIdPath: 'id',
    argsIsObject: true,
    finishReasonField: 'stop_reason',
    doneMarker: 'message_stop',
  },
}

export const GEMINI_ADAPTER: LLMAdapterConfig = {
  id: 'gemini',
  name: 'Google Gemini',
  description: 'Gemini API 格式 (OpenAI 兼容)',
  request: {
    endpoint: '/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    bodyTemplate: {
      stream: true,
    },
  },
  response: {
    contentField: 'delta.content',
    toolCallField: 'delta.tool_calls',
    toolNamePath: 'function.name',
    toolArgsPath: 'function.arguments',
    toolIdPath: 'id',
    argsIsObject: false,
    finishReasonField: 'finish_reason',
    doneMarker: '[DONE]',
  },
}

/** 所有内置适配器 */
export const BUILTIN_ADAPTERS: Record<string, LLMAdapterConfig> = {
  openai: OPENAI_ADAPTER,
  anthropic: ANTHROPIC_ADAPTER,
  gemini: GEMINI_ADAPTER,
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
    adapter: OPENAI_ADAPTER,
    features: {
      streaming: true,
      tools: true,
      vision: true,
      reasoning: true,
    },
    defaults: {
      maxTokens: 8192,
      temperature: 0.7,
      topP: 1,
      timeout: 120000,
    },
    auth: {
      type: 'bearer',
      placeholder: 'sk-proj-...',
      helpUrl: 'https://platform.openai.com/api-keys',
    },
    isBuiltin: true,
  },

  anthropic: {
    id: 'anthropic',
    name: 'anthropic',
    displayName: 'Anthropic',
    description: 'Claude 3.5, Claude 4 等模型',
    baseUrl: 'https://api.anthropic.com',
    models: [
      'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
    defaultModel: 'claude-sonnet-4-20250514',
    adapter: ANTHROPIC_ADAPTER,
    features: {
      streaming: true,
      tools: true,
      vision: true,
      reasoning: true,
    },
    defaults: {
      maxTokens: 8192,
      temperature: 0.7,
      topP: 1,
      timeout: 120000,
    },
    auth: {
      type: 'api-key',
      placeholder: 'sk-ant-...',
      helpUrl: 'https://console.anthropic.com/settings/keys',
    },
    isBuiltin: true,
  },

  gemini: {
    id: 'gemini',
    name: 'gemini',
    displayName: 'Google Gemini',
    description: 'Gemini Pro, Gemini Flash 等模型',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    defaultModel: 'gemini-2.0-flash-exp',
    adapter: GEMINI_ADAPTER,
    features: {
      streaming: true,
      tools: true,
      vision: true,
    },
    defaults: {
      maxTokens: 8192,
      temperature: 0.7,
      topP: 1,
      timeout: 120000,
    },
    auth: {
      type: 'bearer',
      placeholder: 'AIzaSy...',
      helpUrl: 'https://aistudio.google.com/apikey',
    },
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
  auth: {
    type: string
    placeholder: string
    helpUrl?: string
  }
  endpoint: {
    default: string
  }
  defaults: {
    timeout: number
  }
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
      auth: {
        type: def.auth.type,
        placeholder: def.auth.placeholder || '',
        helpUrl: def.auth.helpUrl,
      },
      endpoint: {
        default: def.baseUrl,
      },
      defaults: {
        timeout: def.defaults.timeout,
      },
    }
  }
  return result
}

/** PROVIDERS 常量（用于 UI 组件） */
export const PROVIDERS = getProviders()
