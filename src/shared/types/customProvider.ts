/**
 * Custom Provider 类型定义
 * 
 * 复用 providers.ts 中的核心类型，只定义自定义 Provider 特有的类型
 */

// 从统一配置中心导入核心类型
export type {
  AuthType,
  AuthConfig,
  RequestConfig,
  ResponseConfig,
  LLMAdapterConfig,
  ProviderFeatures,
  LLMDefaults,
  BaseProviderConfig,
  CustomProviderConfig,
  UserProviderConfig,
} from '@/shared/config/providers'

// ============================================
// 预设模板类型
// ============================================

/** 预设模板 ID */
export type PresetTemplateId =
  | 'openai-compatible'
  | 'deepseek-compatible'
  | 'anthropic-compatible'
  | 'custom-blank'

/** 预设模板 */
export interface PresetTemplate {
  id: PresetTemplateId | string
  name: string
  description: string
  config: Partial<import('@/shared/config/providers').CustomProviderConfig>
  adapterPreset?: Partial<import('@/shared/config/providers').LLMAdapterConfig>
}

// ============================================
// Store 类型
// ============================================

/** API Key 存储 (与配置分离，安全考虑) */
export interface ProviderApiKey {
  providerId: string
  apiKey: string
}

/** 自定义 Provider Store 状态 */
export interface CustomProviderStore {
  customProviders: import('@/shared/config/providers').CustomProviderConfig[]
  providerApiKeys: ProviderApiKey[]
}

// ============================================
// 辅助类型
// ============================================

/** Provider 列表项 (用于 UI 展示) */
export interface ProviderListItem {
  id: string
  name: string
  description?: string
  isBuiltin: boolean
  baseUrl?: string
  hasApiKey: boolean
}

/** 连接测试结果 */
export interface ConnectionTestResult {
  success: boolean
  message: string
  latency?: number
  models?: string[]
}
