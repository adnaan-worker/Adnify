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
export type ApiProtocol = 'openai' | 'openai-responses' | 'anthropic' | 'google' | 'custom'

/** 认证配置（仅用于 UI 显示） */
export interface AuthConfig {
  type: AuthType
  placeholder?: string // UI 显示的占位符
  helpUrl?: string // 帮助链接
}

/** 协议特定配置 */
export interface ProtocolConfig {
  /** 认证头配置 */
  authHeader?: {
    name: string // 请求头名称
    template: string // 值模板，{{apiKey}} 会被替换为实际的 API Key
  }
  /** 额外的固定请求头 */
  staticHeaders?: Record<string, string>
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
  displayName: string
  description: string
  baseUrl: string
  models: string[]
  defaultModel: string
  protocol: ApiProtocol
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

/** 用户 Provider 配置（保存到配置文件，覆盖默认值） */
export interface UserProviderConfig {
  apiKey?: string
  baseUrl?: string
  timeout?: number
  model?: string
  customModels?: string[]
  headers?: Record<string, string>  // 每个 provider 独立的 headers
  // 自定义厂商专用字段
  displayName?: string
  protocol?: ApiProtocol
  createdAt?: number
  updatedAt?: number
}

// ============================================
// 协议配置映射表（用于自定义 provider）
// ============================================

/** 协议默认配置映射 */
const PROTOCOL_CONFIGS: Record<ApiProtocol, ProtocolConfig> = {
  openai: {
    authHeader: {
      name: 'Authorization',
      template: 'Bearer {{apiKey}}',
    },
  },
  'openai-responses': {
    authHeader: {
      name: 'Authorization',
      template: 'Bearer {{apiKey}}',
    },
  },
  anthropic: {
    authHeader: {
      name: 'x-api-key',
      template: '{{apiKey}}',
    },
    staticHeaders: {
      'anthropic-version': '2023-06-01',
    },
  },
  google: {
    authHeader: {
      name: 'x-goog-api-key',
      template: '{{apiKey}}',
    },
  },
  custom: {
    // 自定义协议没有默认配置
  },
}

/** 根据协议获取协议配置 */
export function getProtocolConfig(protocol: ApiProtocol): ProtocolConfig {
  return PROTOCOL_CONFIGS[protocol] || {}
}

/** 根据协议配置生成默认请求头模板（使用 {{apiKey}} 占位符） */
export function getDefaultHeadersByProtocol(protocol: ApiProtocol): Record<string, string> {
  const config = getProtocolConfig(protocol)
  const headers: Record<string, string> = {}

  // 1. 添加认证头模板（使用占位符）
  if (config.authHeader) {
    headers[config.authHeader.name] = config.authHeader.template
  }

  // 2. 添加静态头
  if (config.staticHeaders) {
    Object.assign(headers, config.staticHeaders)
  }

  return headers
}

/** 获取 Provider 的默认请求头模板（统一入口，支持内置和自定义 provider） */
export function getProviderDefaultHeaders(
  providerId: string,
  customProtocol?: ApiProtocol
): Record<string, string> {
  // 1. 如果是内置 provider，使用内置配置的协议
  const builtinProvider = BUILTIN_PROVIDERS[providerId]
  if (builtinProvider) {
    return getDefaultHeadersByProtocol(builtinProvider.protocol)
  }

  // 2. 如果是自定义 provider，使用传入的协议
  if (customProtocol) {
    return getDefaultHeadersByProtocol(customProtocol)
  }

  // 3. 默认返回空对象
  return {}
}

/** 将请求头模板替换为实际值 */
export function replaceHeaderTemplates(
  headers: Record<string, string>,
  apiKey: string
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = value.replace(/\{\{apiKey\}\}/g, apiKey)
  }
  return result
}

// ============================================
// 内置 Provider 定义
// ============================================

export const BUILTIN_PROVIDERS: Record<string, BuiltinProviderDef> = {
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    description: 'GPT-4, GPT-4o, o1 等模型',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
    defaultModel: 'gpt-4o',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-proj-...', helpUrl: 'https://platform.openai.com/api-keys' },
    isBuiltin: true,
  },

  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    description: 'Claude 3.5, Claude 4 等模型',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    defaultModel: 'claude-sonnet-4-20250514',
    protocol: 'anthropic',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'api-key', placeholder: 'sk-ant-...', helpUrl: 'https://console.anthropic.com/settings/keys' },
    isBuiltin: true,
  },

  gemini: {
    id: 'gemini',
    displayName: 'Google Gemini',
    description: 'Gemini Pro, Gemini Flash 等模型',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.5-pro-preview-05-06'],
    defaultModel: 'gemini-2.0-flash-exp',
    protocol: 'google',
    features: { streaming: true, tools: true, vision: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'query', placeholder: 'AIzaSy...', helpUrl: 'https://aistudio.google.com/apikey' },
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

// ============================================
// 向后兼容的导出（用于 UI 组件）
// ============================================

/** @deprecated 直接使用 BUILTIN_PROVIDERS */
export const PROVIDERS = BUILTIN_PROVIDERS
