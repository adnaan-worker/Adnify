/**
 * 统一的错误处理工具
 * 提供类型安全的错误处理和用户友好的错误消息
 */

import {
  APICallError,
  NoContentGeneratedError,
  InvalidPromptError,
  InvalidResponseDataError,
  EmptyResponseBodyError,
  LoadAPIKeyError,
  NoSuchModelError,
  TypeValidationError,
  UnsupportedFunctionalityError,
} from '@ai-sdk/provider'

import {
  NoOutputGeneratedError,
  RetryError,
} from 'ai'

export enum ErrorCode {
  // 通用错误
  UNKNOWN = 'UNKNOWN',
  NETWORK = 'NETWORK',
  TIMEOUT = 'TIMEOUT',
  ABORTED = 'ABORTED',
  
  // 文件系统错误
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_ACCESS_DENIED = 'FILE_ACCESS_DENIED',
  FILE_READ = 'FILE_READ',
  FILE_WRITE = 'FILE_WRITE',
  
  // API 错误
  API_KEY_INVALID = 'API_KEY_INVALID',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  API_CALL_FAILED = 'API_CALL_FAILED',
  
  // LSP 错误
  LSP_NOT_INITIALIZED = 'LSP_NOT_INITIALIZED',
  LSP_REQUEST_FAILED = 'LSP_REQUEST_FAILED',
  
  // MCP 错误
  MCP_NOT_INITIALIZED = 'MCP_NOT_INITIALIZED',
  MCP_SERVER_ERROR = 'MCP_SERVER_ERROR',
  MCP_TOOL_ERROR = 'MCP_TOOL_ERROR',
  
  // LLM 错误
  LLM_NO_CONTENT = 'LLM_NO_CONTENT',
  LLM_NO_OUTPUT = 'LLM_NO_OUTPUT',
  LLM_INVALID_PROMPT = 'LLM_INVALID_PROMPT',
  LLM_INVALID_RESPONSE = 'LLM_INVALID_RESPONSE',
  LLM_EMPTY_RESPONSE = 'LLM_EMPTY_RESPONSE',
  LLM_NO_SUCH_MODEL = 'LLM_NO_SUCH_MODEL',
  LLM_VALIDATION_FAILED = 'LLM_VALIDATION_FAILED',
  LLM_UNSUPPORTED = 'LLM_UNSUPPORTED',
}

/**
 * 标准错误类
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly retryable: boolean = false,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
    Error.captureStackTrace?.(this, AppError)
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      retryable: this.retryable,
      details: this.details,
    }
  }
}

/**
 * 错误消息映射表（支持国际化）
 */
const ERROR_MESSAGES: Record<ErrorCode, { en: string; zh: string }> = {
  [ErrorCode.UNKNOWN]: {
    en: 'An unexpected error occurred',
    zh: '发生了未知错误'
  },
  [ErrorCode.NETWORK]: {
    en: 'Network error. Please check your connection',
    zh: '网络错误，请检查网络连接'
  },
  [ErrorCode.TIMEOUT]: {
    en: 'Request timed out',
    zh: '请求超时'
  },
  [ErrorCode.ABORTED]: {
    en: 'Request was cancelled',
    zh: '请求已取消'
  },
  [ErrorCode.FILE_NOT_FOUND]: {
    en: 'File not found',
    zh: '文件不存在'
  },
  [ErrorCode.FILE_ACCESS_DENIED]: {
    en: 'Permission denied',
    zh: '没有权限访问'
  },
  [ErrorCode.FILE_READ]: {
    en: 'Failed to read file',
    zh: '读取文件失败'
  },
  [ErrorCode.FILE_WRITE]: {
    en: 'Failed to write file',
    zh: '写入文件失败'
  },
  [ErrorCode.API_KEY_INVALID]: {
    en: 'Invalid API key',
    zh: 'API Key 无效'
  },
  [ErrorCode.API_RATE_LIMIT]: {
    en: 'Rate limit exceeded',
    zh: 'API 请求频率超限'
  },
  [ErrorCode.API_CALL_FAILED]: {
    en: 'API call failed',
    zh: 'API 调用失败'
  },
  [ErrorCode.LSP_NOT_INITIALIZED]: {
    en: 'Language server not initialized',
    zh: '语言服务器未初始化'
  },
  [ErrorCode.LSP_REQUEST_FAILED]: {
    en: 'Language server request failed',
    zh: '语言服务器请求失败'
  },
  [ErrorCode.MCP_NOT_INITIALIZED]: {
    en: 'MCP not initialized',
    zh: 'MCP 未初始化'
  },
  [ErrorCode.MCP_SERVER_ERROR]: {
    en: 'MCP server error',
    zh: 'MCP 服务器错误'
  },
  [ErrorCode.MCP_TOOL_ERROR]: {
    en: 'MCP tool execution failed',
    zh: 'MCP 工具执行失败'
  },
  [ErrorCode.LLM_NO_CONTENT]: {
    en: 'Model did not generate any content',
    zh: '模型未生成任何内容'
  },
  [ErrorCode.LLM_NO_OUTPUT]: {
    en: 'No output was generated',
    zh: '未生成输出'
  },
  [ErrorCode.LLM_INVALID_PROMPT]: {
    en: 'Invalid prompt format',
    zh: '提示词格式无效'
  },
  [ErrorCode.LLM_INVALID_RESPONSE]: {
    en: 'Invalid response from model',
    zh: '模型响应格式无效'
  },
  [ErrorCode.LLM_EMPTY_RESPONSE]: {
    en: 'Empty response from model',
    zh: '模型返回空响应'
  },
  [ErrorCode.LLM_NO_SUCH_MODEL]: {
    en: 'Model not found',
    zh: '模型不存在'
  },
  [ErrorCode.LLM_VALIDATION_FAILED]: {
    en: 'Response validation failed',
    zh: '响应验证失败'
  },
  [ErrorCode.LLM_UNSUPPORTED]: {
    en: 'Functionality not supported',
    zh: '功能不支持'
  },
}

/**
 * 获取错误消息
 */
export function getErrorMessage(code: ErrorCode, language: 'en' | 'zh' = 'en'): string {
  return ERROR_MESSAGES[code]?.[language] || ERROR_MESSAGES[ErrorCode.UNKNOWN][language]
}

/**
 * 映射 Node.js 系统错误
 * 返回错误码和原始消息，不返回友好消息
 */
export function mapNodeError(error: NodeJS.ErrnoException): { code: ErrorCode; originalMessage: string; retryable: boolean } {
  const code = error.code || ''
  const originalMessage = error.message
  
  switch (code) {
    case 'ENOENT':
      return { code: ErrorCode.FILE_NOT_FOUND, originalMessage, retryable: false }
    
    case 'EACCES':
    case 'EPERM':
      return { code: ErrorCode.FILE_ACCESS_DENIED, originalMessage, retryable: false }
    
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return { code: ErrorCode.TIMEOUT, originalMessage, retryable: true }
    
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'ENETUNREACH':
      return { code: ErrorCode.NETWORK, originalMessage, retryable: true }
    
    default:
      return { code: ErrorCode.UNKNOWN, originalMessage: originalMessage || 'System error', retryable: false }
  }
}

/**
 * 映射 AI SDK 错误（使用类型安全的 isInstance 方法）
 * 返回 ErrorCode 和原始错误消息（用于日志），不返回友好消息
 */
export function mapAISDKError(error: unknown): { code: ErrorCode; originalMessage: string; retryable: boolean } {
  // 确保是 Error 对象
  if (!(error instanceof Error)) {
    return {
      code: ErrorCode.UNKNOWN,
      originalMessage: String(error),
      retryable: false,
    }
  }

  const originalMessage = error.message

  // NoOutputGeneratedError - 通常包装了其他错误，优先提取 cause
  if (NoOutputGeneratedError.isInstance(error)) {
    const cause = (error as any).cause
    if (cause) {
      return mapAISDKError(cause)
    }
    return {
      code: ErrorCode.LLM_NO_OUTPUT,
      originalMessage,
      retryable: true,
    }
  }

  // RetryError - 提取 lastError
  if (RetryError.isInstance(error)) {
    const lastError = (error as any).lastError
    if (lastError) {
      return mapAISDKError(lastError)
    }
    return {
      code: ErrorCode.UNKNOWN,
      originalMessage,
      retryable: false,
    }
  }

  // NoContentGeneratedError
  if (NoContentGeneratedError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_NO_CONTENT,
      originalMessage,
      retryable: true,
    }
  }

  // APICallError - 根据状态码细分
  if (APICallError.isInstance(error)) {
    const statusCode = (error as any).statusCode
    const responseBody = (error as any).responseBody
    
    // 尝试从 responseBody 提取详细信息
    let detailMessage = originalMessage
    if (responseBody && typeof responseBody === 'string') {
      try {
        const body = JSON.parse(responseBody)
        if (body.detail) {
          detailMessage = `${originalMessage}: ${body.detail}`
        } else if (body.message) {
          detailMessage = `${originalMessage}: ${body.message}`
        }
      } catch {
        // JSON 解析失败，使用原始消息
      }
    }
    
    if (statusCode === 429) {
      return {
        code: ErrorCode.API_RATE_LIMIT,
        originalMessage: detailMessage,
        retryable: true,
      }
    }
    if (statusCode === 401 || statusCode === 403) {
      return {
        code: ErrorCode.API_KEY_INVALID,
        originalMessage: detailMessage,
        retryable: false,
      }
    }
    return {
      code: ErrorCode.API_CALL_FAILED,
      originalMessage: detailMessage,
      retryable: (error as any).isRetryable ?? true,
    }
  }

  // InvalidPromptError
  if (InvalidPromptError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_INVALID_PROMPT,
      originalMessage,
      retryable: false,
    }
  }

  // InvalidResponseDataError
  if (InvalidResponseDataError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_INVALID_RESPONSE,
      originalMessage,
      retryable: true,
    }
  }

  // EmptyResponseBodyError
  if (EmptyResponseBodyError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_EMPTY_RESPONSE,
      originalMessage,
      retryable: true,
    }
  }

  // LoadAPIKeyError
  if (LoadAPIKeyError.isInstance(error)) {
    return {
      code: ErrorCode.API_KEY_INVALID,
      originalMessage,
      retryable: false,
    }
  }

  // NoSuchModelError
  if (NoSuchModelError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_NO_SUCH_MODEL,
      originalMessage,
      retryable: false,
    }
  }

  // TypeValidationError
  if (TypeValidationError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_VALIDATION_FAILED,
      originalMessage,
      retryable: false,
    }
  }

  // UnsupportedFunctionalityError
  if (UnsupportedFunctionalityError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_UNSUPPORTED,
      originalMessage,
      retryable: false,
    }
  }

  // AbortError (标准 DOM 错误)
  if (error.name === 'AbortError') {
    return {
      code: ErrorCode.ABORTED,
      originalMessage,
      retryable: false,
    }
  }

  // 兜底：按 error.name 识别（兼容非 SDK 实例，如测试或 RPC 序列化后的错误）
  if (error.name === 'NoContentGeneratedError') {
    return {
      code: ErrorCode.LLM_NO_CONTENT,
      originalMessage,
      retryable: true,
    }
  }
  const statusCode = (error as any).statusCode
  if (error.name === 'APICallError' && typeof statusCode === 'number') {
    if (statusCode === 429) {
      return { code: ErrorCode.API_RATE_LIMIT, originalMessage, retryable: true }
    }
    if (statusCode === 401 || statusCode === 403) {
      return { code: ErrorCode.API_KEY_INVALID, originalMessage, retryable: false }
    }
    return {
      code: ErrorCode.API_CALL_FAILED,
      originalMessage,
      retryable: (error as any).isRetryable ?? true,
    }
  }

  // 检查错误消息中的关键词（兜底）
  const msg = originalMessage.toLowerCase()
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
    return {
      code: ErrorCode.NETWORK,
      originalMessage,
      retryable: true,
    }
  }
  if (msg.includes('timeout')) {
    return {
      code: ErrorCode.TIMEOUT,
      originalMessage,
      retryable: true,
    }
  }

  // 未知错误
  return {
    code: ErrorCode.UNKNOWN,
    originalMessage,
    retryable: false,
  }
}

/**
 * 将任意错误转换为 AppError
 * 使用英文友好消息（前端可根据用户语言转换）
 */
export function toAppError(error: unknown, language: 'en' | 'zh' = 'en'): AppError {
  if (error instanceof AppError) {
    return error
  }

  if (error instanceof Error) {
    // Node.js 系统错误
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code) {
      const mapped = mapNodeError(nodeError)
      const friendlyMessage = getErrorMessage(mapped.code, language)
      return new AppError(friendlyMessage, mapped.code, mapped.retryable, error)
    }
    
    // 普通 Error：保留原始消息便于排查
    return new AppError(error.message, ErrorCode.UNKNOWN, false, error)
  }

  if (typeof error === 'string') {
    return new AppError(error, ErrorCode.UNKNOWN, false)
  }

  const friendlyMessage = getErrorMessage(ErrorCode.UNKNOWN, language)
  return new AppError(friendlyMessage, ErrorCode.UNKNOWN, false, error)
}
