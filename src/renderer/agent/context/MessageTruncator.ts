/**
 * 消息截断器
 * 
 * 提供智能的消息内容截断策略
 */

import type { ContextConfig } from './types'
import { DEFAULT_CONTEXT_CONFIG } from './types'
import { AGENT_DEFAULTS } from '@shared/config/defaults'

// 文件读取工具（需要保留头尾）
const FILE_READ_TOOLS = ['read_file', 'read_multiple_files']
// 搜索工具（保留前面的结果）
const SEARCH_TOOLS = ['search_files', 'codebase_search', 'list_directory', 'search_in_file', 'get_dir_tree']

/**
 * 智能截断工具结果
 * 根据工具类型和内容重要性动态调整
 */
export function truncateToolResult(
  content: string,
  toolName: string,
  config: Partial<ContextConfig> = {}
): string {
  if (!content) return content

  const cfg = { ...DEFAULT_CONTEXT_CONFIG, ...config }
  const isImportant = cfg.importantTools.includes(toolName)
  const isReadOnly = cfg.readOnlyTools.includes(toolName)

  // 重要工具保留更多内容
  const maxChars = isImportant
    ? cfg.maxToolResultChars
    : isReadOnly
      ? Math.floor(cfg.maxToolResultChars / 2)
      : cfg.maxToolResultChars

  if (content.length <= maxChars) return content

  // 检查是否是错误信息（保留完整）
  const isError = /error|failed|exception|denied/i.test(content.slice(0, 500))
  if (isError && content.length <= maxChars * 1.5) {
    return content
  }

  // 对于文件读取，保留头尾
  if (FILE_READ_TOOLS.includes(toolName)) {
    const headSize = Math.floor(maxChars * 0.6)
    const tailSize = Math.floor(maxChars * 0.3)
    const head = content.slice(0, headSize)
    const tail = content.slice(-tailSize)
    const omitted = content.length - headSize - tailSize
    return `${head}\n\n... [${omitted} characters omitted] ...\n\n${tail}`
  }

  // 对于搜索结果，保留前面的结果
  if (SEARCH_TOOLS.includes(toolName)) {
    const lines = content.split('\n')
    let result = ''
    let lineCount = 0
    for (const line of lines) {
      if (result.length + line.length > maxChars) break
      result += line + '\n'
      lineCount++
    }
    if (lineCount < lines.length) {
      result += `\n... [${lines.length - lineCount} more results omitted]`
    }
    return result.trim()
  }

  // 默认：保留头部 + 简短尾部
  const headSize = Math.floor(maxChars * 0.8)
  const tailSize = Math.floor(maxChars * 0.15)
  return `${content.slice(0, headSize)}\n\n... [truncated] ...\n\n${content.slice(-tailSize)}`
}

/**
 * 截断普通消息内容
 */
export function truncateMessage(
  content: string,
  maxChars?: number,
  preserveEnds: boolean = true
): string {
  // 使用配置中的默认值
  const limit = maxChars ?? AGENT_DEFAULTS.maxToolResultChars

  if (content.length <= limit) return content

  if (preserveEnds) {
    const headSize = Math.floor(limit * 0.6)
    const tailSize = Math.floor(limit * 0.3)
    return `${content.slice(0, headSize)}\n...[truncated]...\n${content.slice(-tailSize)}`
  }

  return content.slice(0, limit) + '...[truncated]'
}
