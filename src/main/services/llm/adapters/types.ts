/**
 * 适配器层类型定义
 */

import type { ApiProtocol, LLMAdapterConfig } from '@/shared/config/providers'

// ============================================
// 通用消息格式（适配器内部使用）
// ============================================

/** OpenAI 格式的消息 */
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

/** Anthropic 格式的消息 */
export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | Array<AnthropicContentBlock>
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

/** 转换后的请求参数 */
export interface ConvertedRequest {
  messages: unknown[]
  systemPrompt?: string | unknown[] // Anthropic 需要数组格式
  tools?: unknown[]
  extraParams?: Record<string, unknown>
}

// ============================================
// 工具格式
// ============================================

/** OpenAI 格式的工具定义 */
export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

/** Anthropic 格式的工具定义 */
export interface AnthropicTool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

// ============================================
// 响应解析
// ============================================

/** 解析后的流式块 */
export interface ParsedStreamChunk {
  type: 'text' | 'reasoning' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'usage' | 'done' | 'error'
  content?: string
  toolCall?: {
    index?: number
    id?: string
    name?: string
    arguments?: string | Record<string, unknown>
  }
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/** 适配器上下文 */
export interface AdapterContext {
  protocol: ApiProtocol
  config: LLMAdapterConfig
}
