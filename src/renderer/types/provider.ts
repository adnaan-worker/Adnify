/**
 * LLM Provider 类型定义（渲染进程专用）
 * 
 * 统一管理内置厂商和自定义厂商的配置
 * - 内置厂商：只存储用户覆盖的配置（apiKey, baseUrl, customModels 等）
 * - 自定义厂商：存储完整配置，通过 id 以 "custom-" 前缀区分
 */

import type { LLMAdapterConfig, AdvancedConfig, ProviderMode } from '@/shared/config/providers'

export type { AdvancedConfig }

// ============ Provider 设置类型 ============

/** 单个 Provider 的用户配置（内置和自定义厂商统一使用） */
export interface ProviderModelConfig {
  // 通用字段
  apiKey?: string
  baseUrl?: string
  timeout?: number
  model?: string
  customModels?: string[]           // 模型列表（内置厂商是额外添加的，自定义厂商是全部模型）
  adapterConfig?: LLMAdapterConfig
  advanced?: AdvancedConfig
  
  // 自定义厂商专用字段（custom- 前缀的 provider）
  displayName?: string              // 显示名称
  mode?: ProviderMode               // 兼容模式：openai/anthropic/gemini/custom
  createdAt?: number                // 创建时间
  updatedAt?: number                // 更新时间
}

/** 所有 Provider 设置 */
export interface ProviderSettings {
  configs: Record<string, ProviderModelConfig>
}

// ============ 辅助函数 ============

/** 判断是否为自定义厂商 */
export function isCustomProvider(providerId: string): boolean {
  return providerId.startsWith('custom-')
}

/** 生成自定义厂商 ID */
export function generateCustomProviderId(): string {
  return `custom-${Date.now()}`
}
