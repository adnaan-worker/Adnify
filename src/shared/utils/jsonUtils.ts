/**
 * JSON 工具函数
 * 
 * 提供 JSON 解析、修复、路径访问等公共功能
 */

// ============================================
// JSON 路径访问
// ============================================

/**
 * 从对象中按路径获取值
 * 
 * @param obj 要提取的对象
 * @param path 路径字符串，支持 . 和 [] 访问
 * @returns 提取的值，不存在返回 undefined
 * 
 * @example
 * getByPath({ a: { b: [1, 2] }}, 'a.b[1]') // => 2
 * getByPath({ choices: [{delta: {content: 'hi'}}]}, 'choices[0].delta.content') // => 'hi'
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined

  const tokens = parsePath(path)
  let current: unknown = obj

  for (const token of tokens) {
    if (current === null || current === undefined) {
      return undefined
    }

    if (typeof current !== 'object') {
      return undefined
    }

    if (/^\d+$/.test(token)) {
      if (!Array.isArray(current)) {
        return undefined
      }
      current = current[parseInt(token, 10)]
    } else {
      current = (current as Record<string, unknown>)[token]
    }
  }

  return current
}

/**
 * 在对象中按路径设置值
 */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (!obj || !path) return

  const tokens = parsePath(path)
  let current: unknown = obj

  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]
    const nextToken = tokens[i + 1]
    const isNextArray = /^\d+$/.test(nextToken)

    if (typeof current !== 'object' || current === null) {
      return
    }

    const record = current as Record<string, unknown>
    if (!(token in record)) {
      record[token] = isNextArray ? [] : {}
    }
    current = record[token]
  }

  if (typeof current === 'object' && current !== null) {
    const lastToken = tokens[tokens.length - 1]
    ;(current as Record<string, unknown>)[lastToken] = value
  }
}

/**
 * 检查路径是否存在
 */
export function hasPath(obj: unknown, path: string): boolean {
  return getByPath(obj, path) !== undefined
}

/**
 * 解析路径字符串为 token 数组
 */
function parsePath(path: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inBracket = false

  for (const char of path) {
    if (char === '[') {
      if (current) {
        tokens.push(current)
        current = ''
      }
      inBracket = true
    } else if (char === ']') {
      if (current) {
        tokens.push(current)
        current = ''
      }
      inBracket = false
    } else if (char === '.' && !inBracket) {
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

/**
 * 合并两个路径
 */
export function joinPath(...paths: (string | undefined)[]): string {
  return paths.filter(p => p).join('.')
}

// ============================================
// JSON 修复函数
// ============================================

/**
 * 清理工具调用参数字符串
 * 移除特殊标记，处理不完整的 JSON
 */
export function cleanToolCallArgs(argsStr: string): string {
  let cleaned = argsStr.trimStart()
  // 移除特殊标记 (如 <|...|>)
  cleaned = cleaned.replace(/<\|[^|]+\|>/g, '')
  cleaned = cleaned.trimEnd()

  if (cleaned.length > 0 && !cleaned.endsWith('}')) {
    let braceCount = 0
    let lastValidEnd = -1
    let inString = false
    let escaped = false

    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i]
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
        else if (char === '}') {
          braceCount--
          if (braceCount === 0) lastValidEnd = i
        }
      }
    }

    if (lastValidEnd !== -1) {
      cleaned = cleaned.slice(0, lastValidEnd + 1)
    }
  }

  return cleaned
}

/**
 * 修复字符串中未转义的换行符
 */
export function fixUnescapedNewlines(argsStr: string): string {
  let inString = false
  let escaped = false
  let result = ''

  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i]
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
      if (char === '\n') {
        result += '\\n'
        continue
      }
      if (char === '\r') {
        result += '\\r'
        continue
      }
      if (char === '\t') {
        result += '\\t'
        continue
      }
      if (charCode < 32) {
        result += `\\u${charCode.toString(16).padStart(4, '0')}`
        continue
      }
    }

    result += char
  }

  return result
}

/**
 * 修复格式错误的 JSON
 * 处理未闭合的字符串、括号等
 */
export function fixMalformedJson(argsStr: string): string {
  let result = ''
  let inString = false
  let escaped = false
  let i = 0

  while (i < argsStr.length) {
    const char = argsStr[i]
    const charCode = char.charCodeAt(0)

    if (escaped) {
      result += char
      escaped = false
      i++
      continue
    }
    if (char === '\\') {
      escaped = true
      result += char
      i++
      continue
    }
    if (char === '"') {
      inString = !inString
      result += char
      i++
      continue
    }

    if (inString) {
      if (char === '\n') result += '\\n'
      else if (char === '\r') result += '\\r'
      else if (char === '\t') result += '\\t'
      else if (charCode < 32) result += `\\u${charCode.toString(16).padStart(4, '0')}`
      else result += char
    } else {
      result += char
    }

    i++
  }

  // 闭合未结束的字符串
  if (inString) result += '"'

  // 计算并闭合未匹配的括号
  let braceCount = 0
  let bracketCount = 0
  inString = false
  escaped = false

  for (let j = 0; j < result.length; j++) {
    const c = result[j]
    if (escaped) {
      escaped = false
      continue
    }
    if (c === '\\') {
      escaped = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (!inString) {
      if (c === '{') braceCount++
      else if (c === '}') braceCount--
      else if (c === '[') bracketCount++
      else if (c === ']') bracketCount--
    }
  }

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
 * 安全解析 JSON，带自动修复
 */
export function safeParseJson<T = Record<string, unknown>>(
  jsonStr: string,
  defaultValue: T = {} as T
): T {
  if (!jsonStr || !jsonStr.trim()) {
    return defaultValue
  }

  // 第一次尝试：直接解析
  try {
    return JSON.parse(jsonStr)
  } catch {
    // 继续尝试修复
  }

  // 第二次尝试：清理后解析
  try {
    const cleaned = cleanToolCallArgs(jsonStr)
    return JSON.parse(cleaned)
  } catch {
    // 继续尝试修复
  }

  // 第三次尝试：修复换行符
  try {
    const fixed = fixUnescapedNewlines(jsonStr)
    return JSON.parse(fixed)
  } catch {
    // 继续尝试修复
  }

  // 第四次尝试：完整修复
  try {
    const fixed = fixMalformedJson(jsonStr)
    return JSON.parse(fixed)
  } catch {
    return defaultValue
  }
}

/**
 * 生成唯一 ID
 */
export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}
