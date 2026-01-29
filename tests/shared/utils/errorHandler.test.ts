/**
 * errorHandler 单元测试
 */

import { describe, it, expect } from 'vitest'
import { 
  toAppError, 
  AppError, 
  ErrorCode,
  getErrorMessage,
  mapAISDKError,
  mapNodeError,
} from '@shared/utils/errorHandler'

describe('errorHandler', () => {
  describe('toAppError', () => {
    it('should return AppError as-is', () => {
      const appError = new AppError('Test error', ErrorCode.FILE_NOT_FOUND)
      const result = toAppError(appError)
      
      expect(result).toBe(appError)
      expect(result.code).toBe(ErrorCode.FILE_NOT_FOUND)
    })

    it('should convert Error to AppError', () => {
      const error = new Error('Test error')
      const result = toAppError(error)
      
      expect(result).toBeInstanceOf(AppError)
      expect(result.message).toBe('Test error')
      expect(result.code).toBe(ErrorCode.UNKNOWN)
    })

    it('should convert string to AppError', () => {
      const result = toAppError('String error')
      
      expect(result).toBeInstanceOf(AppError)
      expect(result.message).toBe('String error')
      expect(result.code).toBe(ErrorCode.UNKNOWN)
    })

    it('should handle unknown types', () => {
      const result = toAppError({ foo: 'bar' })
      
      expect(result).toBeInstanceOf(AppError)
      expect(result.message).toBe('An unexpected error occurred')
      expect(result.code).toBe(ErrorCode.UNKNOWN)
    })
  })

  describe('mapNodeError', () => {
    it('should map ENOENT to FILE_NOT_FOUND', () => {
      const error = Object.assign(new Error('File not found'), { code: 'ENOENT' }) as NodeJS.ErrnoException
      const result = mapNodeError(error)
      
      expect(result.code).toBe(ErrorCode.FILE_NOT_FOUND)
      expect(result.retryable).toBe(false)
    })

    it('should map EACCES to FILE_ACCESS_DENIED', () => {
      const error = Object.assign(new Error('Permission denied'), { code: 'EACCES' }) as NodeJS.ErrnoException
      const result = mapNodeError(error)
      
      expect(result.code).toBe(ErrorCode.FILE_ACCESS_DENIED)
      expect(result.retryable).toBe(false)
    })

    it('should map ETIMEDOUT to TIMEOUT', () => {
      const error = Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' }) as NodeJS.ErrnoException
      const result = mapNodeError(error)
      
      expect(result.code).toBe(ErrorCode.TIMEOUT)
      expect(result.retryable).toBe(true)
    })

    it('should map ECONNREFUSED to NETWORK', () => {
      const error = Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' }) as NodeJS.ErrnoException
      const result = mapNodeError(error)
      
      expect(result.code).toBe(ErrorCode.NETWORK)
      expect(result.retryable).toBe(true)
    })
  })

  describe('mapAISDKError', () => {
    it('should map NoContentGeneratedError', () => {
      const error = new Error('No content')
      error.name = 'NoContentGeneratedError'
      const result = mapAISDKError(error)
      
      expect(result.code).toBe(ErrorCode.LLM_NO_CONTENT)
      expect(result.retryable).toBe(true)
    })

    it('should map APICallError with 429 status', () => {
      const error = Object.assign(new Error('Rate limit'), { 
        name: 'APICallError',
        statusCode: 429 
      })
      const result = mapAISDKError(error)
      
      expect(result.code).toBe(ErrorCode.API_RATE_LIMIT)
      expect(result.retryable).toBe(true)
    })

    it('should map APICallError with 401 status', () => {
      const error = Object.assign(new Error('Unauthorized'), { 
        name: 'APICallError',
        statusCode: 401 
      })
      const result = mapAISDKError(error)
      
      expect(result.code).toBe(ErrorCode.API_KEY_INVALID)
      expect(result.retryable).toBe(false)
    })

    it('should map AbortError', () => {
      const error = new Error('Aborted')
      error.name = 'AbortError'
      const result = mapAISDKError(error)
      
      expect(result.code).toBe(ErrorCode.ABORTED)
      expect(result.retryable).toBe(false)
    })
  })

  describe('AppError', () => {
    it('should create AppError with all properties', () => {
      const error = new AppError(
        'Test message',
        ErrorCode.API_KEY_INVALID,
        true,
        { key: 'value' }
      )
      
      expect(error.message).toBe('Test message')
      expect(error.code).toBe(ErrorCode.API_KEY_INVALID)
      expect(error.retryable).toBe(true)
      expect(error.details).toEqual({ key: 'value' })
      expect(error.name).toBe('AppError')
    })

    it('should have default values', () => {
      const error = new AppError('Test', ErrorCode.UNKNOWN)
      
      expect(error.retryable).toBe(false)
      expect(error.details).toBeUndefined()
    })

    it('should serialize to JSON', () => {
      const error = new AppError('Test', ErrorCode.FILE_NOT_FOUND, false, { path: '/test' })
      const json = error.toJSON()
      
      expect(json.name).toBe('AppError')
      expect(json.message).toBe('Test')
      expect(json.code).toBe(ErrorCode.FILE_NOT_FOUND)
      expect(json.details).toEqual({ path: '/test' })
    })
  })

  describe('getErrorMessage', () => {
    it('should return English message by default', () => {
      const message = getErrorMessage(ErrorCode.FILE_NOT_FOUND, 'en')
      expect(message).toBe('File not found')
    })

    it('should return Chinese message', () => {
      const message = getErrorMessage(ErrorCode.FILE_NOT_FOUND, 'zh')
      expect(message).toBe('文件不存在')
    })

    it('should handle all error codes', () => {
      const codes = [
        ErrorCode.UNKNOWN,
        ErrorCode.NETWORK,
        ErrorCode.TIMEOUT,
        ErrorCode.ABORTED,
        ErrorCode.FILE_NOT_FOUND,
        ErrorCode.FILE_ACCESS_DENIED,
        ErrorCode.FILE_READ,
        ErrorCode.FILE_WRITE,
        ErrorCode.API_KEY_INVALID,
        ErrorCode.API_RATE_LIMIT,
        ErrorCode.API_CALL_FAILED,
        ErrorCode.LSP_NOT_INITIALIZED,
        ErrorCode.LSP_REQUEST_FAILED,
        ErrorCode.MCP_NOT_INITIALIZED,
        ErrorCode.MCP_SERVER_ERROR,
        ErrorCode.MCP_TOOL_ERROR,
        ErrorCode.LLM_NO_CONTENT,
        ErrorCode.LLM_NO_OUTPUT,
        ErrorCode.LLM_INVALID_PROMPT,
        ErrorCode.LLM_INVALID_RESPONSE,
        ErrorCode.LLM_EMPTY_RESPONSE,
        ErrorCode.LLM_NO_SUCH_MODEL,
        ErrorCode.LLM_VALIDATION_FAILED,
        ErrorCode.LLM_UNSUPPORTED,
      ]

      codes.forEach(code => {
        const enMessage = getErrorMessage(code, 'en')
        const zhMessage = getErrorMessage(code, 'zh')
        
        expect(enMessage).toBeTruthy()
        expect(zhMessage).toBeTruthy()
        expect(enMessage).not.toBe(zhMessage) // Different languages
      })
    })
  })
})
