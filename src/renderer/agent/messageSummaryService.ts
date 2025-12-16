/**
 * 消息截断服务
 * 硬截断策略，参考 Claude Code / Warp 的做法
 */

import { getEditorConfig } from '../config/editorConfig'

/**
 * 获取截断配置
 */
function getTruncateConfig() {
  const config = getEditorConfig()
  return {
    maxToolResultChars: config.ai.maxToolResultChars,
    maxHistoryMessages: config.ai.maxHistoryMessages,
    maxSingleFileChars: config.ai.maxSingleFileChars,
  }
}

/**
 * 截断工具结果
 * 超过限制的内容直接截断，添加提示
 */
export function truncateToolResult(content: string, customLimit?: number): string {
  const { maxToolResultChars } = getTruncateConfig()
  const limit = customLimit ?? maxToolResultChars

  if (content.length <= limit) {
    return content
  }

  const truncated = content.slice(0, limit)
  const remaining = content.length - limit
  return `${truncated}\n\n[... truncated ${remaining} characters ...]`
}

/**
 * 截断文件内容
 * 按行截断，保留文件结构
 */
export function truncateFileContent(content: string, customLimit?: number): string {
  const { maxSingleFileChars } = getTruncateConfig()
  const limit = customLimit ?? maxSingleFileChars

  if (content.length <= limit) {
    return content
  }

  const lines = content.split('\n')
  let result = ''
  let lineCount = 0

  for (const line of lines) {
    if (result.length + line.length + 1 > limit) {
      break
    }
    result += (lineCount > 0 ? '\n' : '') + line
    lineCount++
  }

  const totalLines = lines.length
  const remainingLines = totalLines - lineCount
  return `${result}\n\n[... truncated ${remainingLines} more lines (${content.length - result.length} chars) ...]`
}

/**
 * 估算 token 数量（粗略：1 token ≈ 4 字符）
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export const truncateService = {
  truncateToolResult,
  truncateFileContent,
  estimateTokens,
  getTruncateConfig,
}
