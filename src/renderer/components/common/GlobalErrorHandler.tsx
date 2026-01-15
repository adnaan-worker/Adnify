/**
 * 全局错误处理器
 * 捕获未处理的 Promise 错误和全局异常
 */

import { useEffect } from 'react'
import { logger } from '@utils/Logger'
import { toast } from './ToastProvider'
import { AppError, ErrorCode, formatErrorMessage } from '@/shared/errors'

interface GlobalErrorHandlerProps {
  children: React.ReactNode
}

/**
 * 全局错误处理组件
 * 捕获 window 级别的未处理错误
 */
export function GlobalErrorHandler({ children }: GlobalErrorHandlerProps) {
  useEffect(() => {
    // 处理未捕获的 Promise 错误
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      
      const error = event.reason
      
      // 忽略 Monaco Editor 的取消操作（常见的无害错误）
      if (error?.message === 'Canceled' || error?.name === 'Canceled') {
        return
      }

      // 忽略 Monaco Editor 的 inmemory model 错误（DiffEditor 卸载时的已知问题）
      if (error?.message?.includes('inmemory://model')) {
        return
      }
      
      const appError = AppError.fromError(error)
      
      logger.system.error('[GlobalErrorHandler] Unhandled Promise rejection:', {
        message: appError.message,
        code: appError.code,
        stack: error?.stack,
      })

      // 根据错误类型决定是否显示 toast
      if (shouldShowToast(appError)) {
        const { title, description } = appError.getUserMessage()
        toast.error(title, description)
      }
    }

    // 处理未捕获的同步错误
    const handleError = (event: ErrorEvent) => {
      // 忽略 ResizeObserver 错误（常见的无害错误）
      if (event.message?.includes('ResizeObserver')) {
        return
      }

      // 忽略 Monaco Editor 的 inmemory model 错误（DiffEditor 卸载时的已知问题）
      if (event.message?.includes('inmemory://model')) {
        return
      }

      const appError = AppError.fromError(event.error || new Error(event.message))
      
      logger.system.error('[GlobalErrorHandler] Uncaught error:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      })

      if (shouldShowToast(appError)) {
        toast.error('Unexpected Error', formatErrorMessage(appError))
      }
    }

    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    window.addEventListener('error', handleError)

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
      window.removeEventListener('error', handleError)
    }
  }, [])

  return <>{children}</>
}

/**
 * 判断是否应该显示 toast
 * 过滤掉一些不需要用户关注的错误
 */
function shouldShowToast(error: AppError): boolean {
  // 网络错误在离线时不显示
  if (error.code === ErrorCode.NETWORK_ERROR && !navigator.onLine) {
    return false
  }

  // 用户主动取消的操作不显示
  if (error.code === ErrorCode.ABORTED || error.message?.includes('aborted')) {
    return false
  }

  // Monaco Editor 的取消操作不显示
  if (error.message === 'Canceled' || error.message?.includes('Canceled:')) {
    return false
  }

  // 开发环境的 HMR 错误不显示
  if (process.env.NODE_ENV === 'development') {
    if (error.message?.includes('HMR') || error.message?.includes('hot module')) {
      return false
    }
  }

  return true
}

/**
 * 错误恢复工具函数
 */
export const errorRecovery = {
  /**
   * 重试操作
   */
  async retry<T>(
    operation: () => Promise<T>,
    options: {
      maxRetries?: number
      delay?: number
      backoff?: number
      shouldRetry?: (error: Error) => boolean
    } = {}
  ): Promise<T> {
    const {
      maxRetries = 3,
      delay = 1000,
      backoff = 2,
      shouldRetry = () => true,
    } = options

    let lastError: Error | undefined
    let currentDelay = delay

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error as Error
        
        if (attempt === maxRetries || !shouldRetry(lastError)) {
          throw lastError
        }

        logger.system.warn(`[ErrorRecovery] Retry attempt ${attempt + 1}/${maxRetries}`, {
          error: lastError.message,
          nextDelay: currentDelay,
        })

        await new Promise(resolve => setTimeout(resolve, currentDelay))
        currentDelay *= backoff
      }
    }

    throw lastError
  },

  /**
   * 安全执行（不抛出错误）
   */
  async safe<T>(
    operation: () => Promise<T>,
    fallback: T
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      logger.system.warn('[ErrorRecovery] Safe execution failed, using fallback:', error)
      return fallback
    }
  },
}

export default GlobalErrorHandler
