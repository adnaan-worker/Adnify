/**
 * LLM Provider 类型定义（渲染进程专用）
 */

import type { LLMAdapterConfig, AdvancedConfig } from '@/shared/config/providers'

export type { AdvancedConfig }

// ============ Provider 设置类型 ============

/** 单个 Provider 的用户配置 */
export interface ProviderModelConfig {
  enabledModels?: string[]
  customModels: string[]
  baseUrl?: string
  apiKey?: string
  timeout?: number
  adapterConfig?: LLMAdapterConfig
  model?: string
  advanced?: AdvancedConfig
}

/** 所有 Provider 设置 */
export interface ProviderSettings {
  configs: Record<string, ProviderModelConfig>
}

// ============ 模型选择类型 ============

export interface ModelSelection {
  providerType: 'builtin' | 'custom'
  providerName: string
  modelName: string
}

export type FeatureName = 'chat' | 'agent' | 'autocomplete' | 'apply'

export type ModelSelectionOfFeature = Record<FeatureName, ModelSelection | null>
