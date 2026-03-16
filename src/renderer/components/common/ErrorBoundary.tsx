/**
 * React Error Boundary 组件
 * 统一捕获和处理 UI 渲染错误
 */

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import { AppError, formatErrorMessage } from '@/shared/errors'
import { logger } from '@shared/utils/Logger'
import { t } from '@renderer/i18n'
import { useStore } from '@store'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  showDetails?: boolean
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })

    // 调用外部错误处理器
    this.props.onError?.(error, errorInfo)

    // 记录错误日志
    logger.ui.error('[ErrorBoundary] Caught error:', error)
    logger.ui.error('[ErrorBoundary] Component stack:', { componentStack: errorInfo.componentStack })
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  handleGoHome = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // 如果提供了自定义 fallback，使用它
      if (this.props.fallback) {
        return this.props.fallback
      }

      const { error, errorInfo } = this.state
      const language = useStore.getState().language
      const appError = error ? AppError.fromError(error) : null
      const { title, description, suggestion } = appError?.getUserMessage() || {
        title: t('errorBoundary.somethingWentWrong', language),
        description: t('errorBoundary.unexpectedError', language),
        suggestion: t('errorBoundary.trySuggestion', language),
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8 bg-[var(--bg-primary)] text-[var(--text-primary)]">
          <div className="flex flex-col items-center max-w-md text-center">
            {/* 错误图标 */}
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>

            {/* 错误标题 */}
            <h2 className="text-xl font-semibold mb-2">{title}</h2>

            {/* 错误描述 */}
            <p className="text-[var(--text-secondary)] mb-4">{description}</p>

            {/* 建议 */}
            {suggestion && (
              <p className="text-sm text-[var(--text-tertiary)] mb-6">
                💡 {suggestion}
              </p>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3">
              <button
                onClick={this.handleRetry}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-primary)] text-white rounded-lg hover:bg-[var(--accent-primary-hover)] transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                {t('errorBoundary.tryAgain', language)}
              </button>
              <button
                onClick={this.handleGoHome}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Home className="w-4 h-4" />
                {t('errorBoundary.reloadApp', language)}
              </button>
            </div>

            {/* 详细错误信息（开发模式） */}
            {this.props.showDetails && error && (
              <details className="mt-6 w-full text-left">
                <summary className="cursor-pointer text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                  {t('errorBoundary.showDetails', language)}
                </summary>
                <div className="mt-2 p-4 bg-[var(--bg-secondary)] rounded-lg overflow-auto max-h-[200px]">
                  <pre className="text-xs text-red-400 whitespace-pre-wrap">
                    {error.message}
                    {errorInfo?.componentStack && (
                      <>
                        {'\n\nComponent Stack:'}
                        {errorInfo.componentStack}
                      </>
                    )}
                  </pre>
                </div>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * 带有错误边界的高阶组件
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options?: Omit<Props, 'children'>
): React.FC<P> {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component'

  const ComponentWithErrorBoundary: React.FC<P> = (props) => (
    <ErrorBoundary {...options}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  )

  ComponentWithErrorBoundary.displayName = `withErrorBoundary(${displayName})`

  return ComponentWithErrorBoundary
}

/**
 * 错误提示组件（用于非致命错误）
 */
interface ErrorAlertProps {
  error: Error | string | null
  onDismiss?: () => void
  className?: string
}

export const ErrorAlert: React.FC<ErrorAlertProps> = ({ error, onDismiss, className = '' }) => {
  if (!error) return null

  const message = typeof error === 'string' ? error : formatErrorMessage(error)

  return (
    <div className={`flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg ${className}`}>
      <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-red-400 whitespace-pre-wrap">{message}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-red-400 hover:text-red-300 transition-colors"
        >
          ×
        </button>
      )}
    </div>
  )
}

export default ErrorBoundary
