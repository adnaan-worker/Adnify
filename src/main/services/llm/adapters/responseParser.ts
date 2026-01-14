/**
 * 响应解析器
 * 
 * 解析不同协议的流式响应
 */

import type { ResponseConfig } from '@/shared/config/providers'
import type { ParsedStreamChunk } from './types'
import { getByPath } from '@shared/utils/jsonUtils'

/**
 * 流式响应解析器
 */
export class ResponseParser {
  private config: ResponseConfig
  private toolCallBuffers: Map<number, { id: string; name: string; argsBuffer: string }> = new Map()

  constructor(config: ResponseConfig) {
    this.config = config
  }

  /**
   * 解析 SSE 数据行
   */
  parseLine(line: string): ParsedStreamChunk[] {
    const trimmed = line.trim()
    if (!trimmed) return []

    // 提取 data 内容
    let data = trimmed
    const dataPrefix = this.config.dataPrefix || 'data:'
    if (trimmed.startsWith(dataPrefix)) {
      data = trimmed.slice(dataPrefix.length).trim()
    }

    // 检查结束标记
    const doneMarker = this.config.doneMarker || '[DONE]'
    if (data === doneMarker) {
      return [{ type: 'done' }]
    }

    // 解析 JSON
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(data)
    } catch {
      return []
    }

    // 检查是否是错误响应
    if (parsed.error) {
      const error = parsed.error as Record<string, unknown>
      const message = (error.message || error.msg || JSON.stringify(error)) as string
      return [{ type: 'error', content: message }]
    }

    return this.parseChunk(parsed)
  }

  /**
   * 解析单个 chunk
   */
  parseChunk(chunk: Record<string, unknown>): ParsedStreamChunk[] {
    const results: ParsedStreamChunk[] = []

    // 提取 usage
    if (chunk.usage) {
      const u = chunk.usage as Record<string, number>
      results.push({
        type: 'usage',
        usage: {
          promptTokens: u.prompt_tokens || u.promptTokens || u.input_tokens || 0,
          completionTokens: u.completion_tokens || u.completionTokens || u.output_tokens || 0,
          totalTokens: u.total_tokens || u.totalTokens || 0,
        },
      })
    }

    // 尝试从 contentField 路径直接获取内容（支持 DashScope 等非标准格式）
    const content = getByPath(chunk, this.config.contentField)
    if (content && typeof content === 'string') {
      results.push({ type: 'text', content })
    }

    // 提取推理内容
    if (this.config.reasoningField) {
      const reasoning = getByPath(chunk, this.config.reasoningField)
      if (reasoning && typeof reasoning === 'string') {
        results.push({ type: 'reasoning', content: reasoning })
      }
    }

    // 获取 choice（标准 OpenAI 格式）
    const choices = chunk.choices as Array<Record<string, unknown>> | undefined
    if (choices?.length) {
      const choice = choices[0]

      // 如果上面没有获取到内容，尝试从 choice 中获取
      if (!content) {
        const choiceContent = getByPath(choice, this.config.contentField)
        if (choiceContent && typeof choiceContent === 'string') {
          results.push({ type: 'text', content: choiceContent })
        }
      }

      // 如果上面没有获取到推理内容，尝试从 choice 中获取
      if (this.config.reasoningField && !getByPath(chunk, this.config.reasoningField)) {
        const reasoning = getByPath(choice, this.config.reasoningField)
        if (reasoning && typeof reasoning === 'string') {
          results.push({ type: 'reasoning', content: reasoning })
        }
      }

      // 提取工具调用
      const toolCallChunks = this.parseToolCalls(choice)
      results.push(...toolCallChunks)
    }

    // 尝试从根级别解析工具调用（非标准格式）
    if (!choices?.length) {
      const toolCallChunks = this.parseToolCalls(chunk)
      results.push(...toolCallChunks)
    }

    return results
  }

  /**
   * 解析工具调用
   */
  private parseToolCalls(choice: Record<string, unknown>): ParsedStreamChunk[] {
    const results: ParsedStreamChunk[] = []
    const toolCallField = this.config.toolCallField || 'delta.tool_calls'
    const toolCallsData = getByPath(choice, toolCallField)

    if (!toolCallsData || !Array.isArray(toolCallsData)) return results

    const toolNamePath = this.config.toolNamePath || 'function.name'
    const toolArgsPath = this.config.toolArgsPath || 'function.arguments'
    const toolIdPath = this.config.toolIdPath || 'id'

    for (const tc of toolCallsData) {
      const index = (tc as Record<string, unknown>).index as number ?? 0
      const id = getByPath(tc, toolIdPath) as string | undefined
      const name = getByPath(tc, toolNamePath) as string | undefined
      const args = getByPath(tc, toolArgsPath)

      let existing = this.toolCallBuffers.get(index)

      // 新的工具调用开始
      if (id && !existing) {
        existing = { id, name: name || '', argsBuffer: '' }
        this.toolCallBuffers.set(index, existing)
        results.push({
          type: 'tool_call_start',
          toolCall: { index, id, name: name || '' },
        })
      }

      if (existing) {
        // 更新名称
        if (name) {
          existing.name = name
        }

        // 累加参数
        if (args) {
          if (typeof args === 'string') {
            existing.argsBuffer += args
            results.push({
              type: 'tool_call_delta',
              toolCall: { index, id: existing.id, arguments: args },
            })
          } else if (typeof args === 'object' && args !== null) {
            // Anthropic 格式：参数是对象
            results.push({
              type: 'tool_call_delta',
              toolCall: { index, id: existing.id, arguments: args as Record<string, unknown> },
            })
          }
        }
      }
    }

    return results
  }

  /**
   * 完成解析，返回所有完整的工具调用
   */
  finalize(): ParsedStreamChunk[] {
    const results: ParsedStreamChunk[] = []

    for (const [index, tc] of this.toolCallBuffers) {
      if (tc.name) {
        let args: Record<string, unknown> = {}
        if (tc.argsBuffer) {
          try {
            args = JSON.parse(tc.argsBuffer)
          } catch {
            // 尝试修复常见的 JSON 问题
            try {
              const fixed = tc.argsBuffer
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t')
              args = JSON.parse(fixed)
            } catch {
              // 忽略解析错误
            }
          }
        }

        results.push({
          type: 'tool_call_end',
          toolCall: {
            index,
            id: tc.id,
            name: tc.name,
            arguments: args,
          },
        })
      }
    }

    this.toolCallBuffers.clear()
    return results
  }

  /**
   * 重置解析器状态
   */
  reset(): void {
    this.toolCallBuffers.clear()
  }
}

/**
 * Anthropic 专用响应解析器
 * Anthropic 的 SSE 格式与 OpenAI 不同
 */
export class AnthropicResponseParser {
  private toolCallBuffers: Map<string, { id: string; name: string; argsBuffer: string }> = new Map()
  private currentBlockId: string | null = null

  /**
   * 解析 Anthropic SSE 事件
   */
  parseEvent(eventType: string, data: Record<string, unknown>): ParsedStreamChunk[] {
    const results: ParsedStreamChunk[] = []

    switch (eventType) {
      case 'content_block_start': {
        const block = data.content_block as Record<string, unknown> | undefined
        if (block?.type === 'tool_use') {
          const id = block.id as string
          const name = block.name as string
          this.currentBlockId = id
          this.toolCallBuffers.set(id, { id, name, argsBuffer: '' })
          results.push({
            type: 'tool_call_start',
            toolCall: { id, name },
          })
        }
        break
      }

      case 'content_block_delta': {
        const delta = data.delta as Record<string, unknown> | undefined
        if (delta?.type === 'text_delta') {
          results.push({ type: 'text', content: delta.text as string })
        } else if (delta?.type === 'thinking_delta') {
          results.push({ type: 'reasoning', content: (delta as Record<string, string>).thinking || '' })
        } else if (delta?.type === 'input_json_delta') {
          const partialJson = delta.partial_json as string
          if (this.currentBlockId && partialJson) {
            const tc = this.toolCallBuffers.get(this.currentBlockId)
            if (tc) {
              tc.argsBuffer += partialJson
              results.push({
                type: 'tool_call_delta',
                toolCall: { id: tc.id, arguments: partialJson },
              })
            }
          }
        }
        break
      }

      case 'content_block_stop': {
        if (this.currentBlockId) {
          const tc = this.toolCallBuffers.get(this.currentBlockId)
          if (tc) {
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(tc.argsBuffer || '{}')
            } catch {
              // 忽略解析错误
            }
            results.push({
              type: 'tool_call_end',
              toolCall: { id: tc.id, name: tc.name, arguments: args },
            })
          }
          this.currentBlockId = null
        }
        break
      }

      case 'message_delta': {
        const usage = data.usage as Record<string, number> | undefined
        if (usage) {
          results.push({
            type: 'usage',
            usage: {
              promptTokens: usage.input_tokens || 0,
              completionTokens: usage.output_tokens || 0,
              totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
            },
          })
        }
        break
      }

      case 'message_stop':
        results.push({ type: 'done' })
        break
    }

    return results
  }

  /**
   * 重置解析器状态
   */
  reset(): void {
    this.toolCallBuffers.clear()
    this.currentBlockId = null
  }
}
