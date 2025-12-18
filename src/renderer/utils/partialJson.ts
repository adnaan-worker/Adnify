/**
 * 部分 JSON 解析器
 * 用于解析流式传输中不完整的 JSON 字符串
 */

/**
 * 尝试解析部分 JSON 字符串
 * 支持不完整的 JSON，会尝试补全缺失的引号和括号
 */
export function parsePartialJson(jsonString: string): Record<string, unknown> | null {
  if (!jsonString || jsonString.trim().length === 0) {
    return null
  }

  // 首先尝试直接解析
  try {
    return JSON.parse(jsonString)
  } catch {
    // 继续尝试修复
  }

  // 尝试修复并解析
  try {
    const fixed = fixPartialJson(jsonString)
    return JSON.parse(fixed)
  } catch {
    // 如果修复后仍然失败，尝试提取已知字段
    return extractKnownFields(jsonString)
  }
}

/**
 * 修复不完整的 JSON 字符串
 */
function fixPartialJson(jsonString: string): string {
  let result = jsonString.trim()
  
  // 确保以 { 开头
  if (!result.startsWith('{')) {
    result = '{' + result
  }

  // 处理字符串内的特殊字符
  result = fixStringContent(result)

  // 计算括号平衡
  let braceCount = 0
  let bracketCount = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < result.length; i++) {
    const char = result[i]
    
    if (escaped) {
      escaped = false
      continue
    }
    
    if (char === '\\' && inString) {
      escaped = true
      continue
    }
    
    if (char === '"') {
      inString = !inString
      continue
    }
    
    if (!inString) {
      if (char === '{') braceCount++
      else if (char === '}') braceCount--
      else if (char === '[') bracketCount++
      else if (char === ']') bracketCount--
    }
  }

  // 如果在字符串中结束，关闭字符串
  if (inString) {
    result += '"'
  }

  // 关闭未闭合的括号
  while (bracketCount > 0) {
    result += ']'
    bracketCount--
  }
  while (braceCount > 0) {
    result += '}'
    braceCount--
  }

  return result
}

/**
 * 修复字符串内容中的特殊字符
 */
function fixStringContent(jsonString: string): string {
  let result = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < jsonString.length; i++) {
    const char = jsonString[i]
    const charCode = char.charCodeAt(0)

    if (escaped) {
      result += char
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      result += char
      continue
    }

    if (char === '"') {
      inString = !inString
      result += char
      continue
    }

    if (inString) {
      // 转义字符串内的控制字符
      if (char === '\n') {
        result += '\\n'
      } else if (char === '\r') {
        result += '\\r'
      } else if (char === '\t') {
        result += '\\t'
      } else if (charCode < 32) {
        result += `\\u${charCode.toString(16).padStart(4, '0')}`
      } else {
        result += char
      }
    } else {
      result += char
    }
  }

  return result
}

/**
 * 从不完整的 JSON 中提取已知字段
 */
function extractKnownFields(jsonString: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  // 提取 path 字段
  const pathMatch = jsonString.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (pathMatch) {
    result.path = unescapeString(pathMatch[1])
  }

  // 提取 content 字段（可能很长，包含换行）
  const contentMatch = jsonString.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (contentMatch) {
    result.content = unescapeString(contentMatch[1])
  }

  // 提取 search_replace_blocks 字段
  const searchReplaceMatch = jsonString.match(/"search_replace_blocks"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (searchReplaceMatch) {
    result.search_replace_blocks = unescapeString(searchReplaceMatch[1])
  }

  // 提取 command 字段
  const commandMatch = jsonString.match(/"command"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (commandMatch) {
    result.command = unescapeString(commandMatch[1])
  }

  // 提取 query 字段
  const queryMatch = jsonString.match(/"query"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (queryMatch) {
    result.query = unescapeString(queryMatch[1])
  }

  // 提取 pattern 字段
  const patternMatch = jsonString.match(/"pattern"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (patternMatch) {
    result.pattern = unescapeString(patternMatch[1])
  }

  return result
}

/**
 * 反转义 JSON 字符串
 */
function unescapeString(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

/**
 * 智能截断工具结果
 * 根据工具类型和内容特点进行截断
 */
export function truncateToolResult(
  result: string,
  toolName: string,
  maxLength?: number
): string {
  // 工具特定的限制
  const limits: Record<string, number> = {
    read_file: 15000,
    read_multiple_files: 20000,
    search_files: 8000,
    get_dir_tree: 5000,
    list_directory: 5000,
    run_command: 10000,
    codebase_search: 8000,
    find_references: 5000,
    get_document_symbols: 5000,
    default: 10000,
  }

  const limit = maxLength || limits[toolName] || limits.default

  if (result.length <= limit) {
    return result
  }

  // 智能截断策略
  if (toolName === 'search_files' || toolName === 'find_references') {
    // 搜索结果：保留更多开头（最相关的结果）
    const headSize = Math.floor(limit * 0.85)
    const tailSize = Math.floor(limit * 0.1)
    return (
      result.slice(0, headSize) +
      '\n\n... [truncated: showing first results] ...\n\n' +
      result.slice(-tailSize)
    )
  }

  if (toolName === 'read_file' || toolName === 'read_multiple_files') {
    // 文件内容：保留开头和结尾
    const headSize = Math.floor(limit * 0.6)
    const tailSize = Math.floor(limit * 0.35)
    return (
      result.slice(0, headSize) +
      '\n\n... [truncated: ' + (result.length - limit) + ' chars omitted] ...\n\n' +
      result.slice(-tailSize)
    )
  }

  if (toolName === 'run_command') {
    // 命令输出：保留更多结尾（通常错误信息在最后）
    const headSize = Math.floor(limit * 0.3)
    const tailSize = Math.floor(limit * 0.65)
    return (
      result.slice(0, headSize) +
      '\n\n... [truncated] ...\n\n' +
      result.slice(-tailSize)
    )
  }

  // 默认：均匀截断
  const headSize = Math.floor(limit * 0.7)
  const tailSize = Math.floor(limit * 0.25)
  return (
    result.slice(0, headSize) +
    '\n\n... [truncated] ...\n\n' +
    result.slice(-tailSize)
  )
}
