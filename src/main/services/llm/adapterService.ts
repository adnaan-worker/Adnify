/**
 * Provider Adapter Service
 * 
 * 提供工具格式转换功能
 * 适配器配置已统一到 @shared/config/providers
 */

import type { ToolDefinition, LLMMessage } from './types'
import { BUILTIN_ADAPTERS, type LLMAdapterConfig } from '@shared/config/providers'

// ===== 类型定义 =====

/** 解析后的工具调用 */
export interface ParsedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/** 工具定义转换规则 */
interface ToolFormatConfig {
  wrapMode: 'none' | 'function' | 'tool'
  wrapField?: string
  parameterField: 'parameters' | 'input_schema' | 'schema'
  includeType: boolean
}

/** 消息格式配置 */
interface MessageFormatConfig {
  toolResultRole: 'tool' | 'user' | 'function'
  toolCallIdField: string
  wrapToolResult: boolean
  toolResultWrapper?: string
}

/** 适配器格式配置 */
interface AdapterFormatConfig {
  toolFormat: ToolFormatConfig
  messageFormat: MessageFormatConfig
}

// ===== 内置适配器格式配置 =====

const ADAPTER_FORMATS: Record<string, AdapterFormatConfig> = {
  openai: {
    toolFormat: {
      wrapMode: 'function',
      wrapField: 'function',
      parameterField: 'parameters',
      includeType: true,
    },
    messageFormat: {
      toolResultRole: 'tool',
      toolCallIdField: 'tool_call_id',
      wrapToolResult: false,
    },
  },
  anthropic: {
    toolFormat: {
      wrapMode: 'none',
      parameterField: 'input_schema',
      includeType: false,
    },
    messageFormat: {
      toolResultRole: 'user',
      toolCallIdField: 'tool_use_id',
      wrapToolResult: true,
      toolResultWrapper: 'tool_result',
    },
  },
  gemini: {
    toolFormat: {
      wrapMode: 'function',
      wrapField: 'function',
      parameterField: 'parameters',
      includeType: true,
    },
    messageFormat: {
      toolResultRole: 'tool',
      toolCallIdField: 'tool_call_id',
      wrapToolResult: false,
    },
  },
}

// ===== 适配器服务类 =====

class ProviderAdapterServiceClass {
  /**
   * 获取适配器配置
   */
  getAdapter(adapterId: string): LLMAdapterConfig | null {
    return BUILTIN_ADAPTERS[adapterId] || null
  }

  /**
   * 获取所有适配器
   */
  getAllAdapters(): LLMAdapterConfig[] {
    return Object.values(BUILTIN_ADAPTERS)
  }

  /**
   * 转换工具定义为指定适配器格式
   */
  convertTools(tools: ToolDefinition[], adapterId: string): unknown[] {
    const formatConfig = ADAPTER_FORMATS[adapterId] || ADAPTER_FORMATS.openai
    const config = formatConfig.toolFormat

    return tools.map((tool) => {
      const toolDef: Record<string, unknown> = {
        name: tool.name,
        description: tool.description,
        [config.parameterField]: tool.parameters,
      }

      if (config.wrapMode === 'function' && config.wrapField) {
        const wrapped: Record<string, unknown> = {
          [config.wrapField]: toolDef,
        }
        if (config.includeType) {
          wrapped.type = 'function'
        }
        return wrapped
      }

      if (config.includeType && config.wrapMode === 'tool') {
        return { type: 'tool', ...toolDef }
      }

      return toolDef
    })
  }

  /**
   * 格式化工具结果消息
   */
  formatToolResultMessage(
    toolCallId: string,
    result: string,
    adapterId: string
  ): LLMMessage {
    const formatConfig = ADAPTER_FORMATS[adapterId] || ADAPTER_FORMATS.openai
    const config = formatConfig.messageFormat

    const msg: LLMMessage = {
      role: config.toolResultRole as 'tool' | 'user',
      content: result,
      [config.toolCallIdField]: toolCallId,
    }

    if (config.wrapToolResult && config.toolResultWrapper) {
      msg.content = [
        {
          type: config.toolResultWrapper,
          content: result,
          tool_use_id: toolCallId,
        },
      ] as unknown as string
    }

    return msg
  }

  /**
   * 生成工具调用 ID
   */
  generateId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }
}

export const adapterService = new ProviderAdapterServiceClass()
