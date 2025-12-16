/**
 * 全局 Toast 通知组件
 * 支持 success、error、warning、info 四种类型
 */

import { useEffect, useState, useCallback, createContext, useContext, ReactNode } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastMessage {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number // 毫秒，0 表示不自动关闭
  action?: {
    label: string
    onClick: () => void
  }
}

interface ToastContextType {
  toasts: ToastMessage[]
  addToast: (toast: Omit<ToastMessage, 'id'>) => string
  removeToast: (id: string) => void
  success: (title: string, message?: string) => string
  error: (title: string, message?: string) => string
  warning: (title: string, message?: string) => string
  info: (title: string, message?: string) => string
}

const ToastContext = createContext<ToastContextType | null>(null)

// Toast 图标配置
const TOAST_ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

// Toast 样式配置
const TOAST_STYLES = {
  success: {
    bg: 'bg-status-success/10',
    border: 'border-status-success/30',
    icon: 'text-status-success',
    title: 'text-status-success',
  },
  error: {
    bg: 'bg-status-error/10',
    border: 'border-status-error/30',
    icon: 'text-status-error',
    title: 'text-status-error',
  },
  warning: {
    bg: 'bg-status-warning/10',
    border: 'border-status-warning/30',
    icon: 'text-status-warning',
    title: 'text-status-warning',
  },
  info: {
    bg: 'bg-accent/10',
    border: 'border-accent/30',
    icon: 'text-accent',
    title: 'text-accent',
  },
}

// 默认持续时间
const DEFAULT_DURATION = {
  success: 3000,
  error: 5000,
  warning: 4000,
  info: 3000,
}

// 单个 Toast 组件
function ToastItem({ toast, onRemove }: { toast: ToastMessage; onRemove: () => void }) {
  const [isExiting, setIsExiting] = useState(false)
  const Icon = TOAST_ICONS[toast.type]
  const styles = TOAST_STYLES[toast.type]

  const handleRemove = useCallback(() => {
    setIsExiting(true)
    setTimeout(onRemove, 200)
  }, [onRemove])

  useEffect(() => {
    if (toast.duration !== 0) {
      const duration = toast.duration || DEFAULT_DURATION[toast.type]
      const timer = setTimeout(handleRemove, duration)
      return () => clearTimeout(timer)
    }
  }, [toast.duration, toast.type, handleRemove])

  return (
    <div
      className={`
        flex items-start gap-3 p-4 rounded-lg border shadow-lg backdrop-blur-sm
        ${styles.bg} ${styles.border}
        transition-all duration-200 ease-out
        ${isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}
        animate-slide-in
      `}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${styles.icon}`} />
      
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${styles.title}`}>{toast.title}</p>
        {toast.message && (
          <p className="text-xs text-text-muted mt-1 break-words">{toast.message}</p>
        )}
        {toast.action && (
          <button
            onClick={() => { toast.action?.onClick(); handleRemove() }}
            className="text-xs text-accent hover:underline mt-2"
          >
            {toast.action.label}
          </button>
        )}
      </div>

      <button
        onClick={handleRemove}
        className="p-1 rounded hover:bg-surface-hover transition-colors flex-shrink-0"
      >
        <X className="w-4 h-4 text-text-muted" />
      </button>
    </div>
  )
}

// Toast 容器组件
function ToastContainer({ toasts, removeToast }: { toasts: ToastMessage[]; removeToast: (id: string) => void }) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onRemove={() => removeToast(toast.id)} />
        </div>
      ))}
    </div>
  )
}

// Toast Provider
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts((prev) => [...prev, { ...toast, id }])
    return id
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const success = useCallback((title: string, message?: string) => {
    return addToast({ type: 'success', title, message })
  }, [addToast])

  const error = useCallback((title: string, message?: string) => {
    return addToast({ type: 'error', title, message })
  }, [addToast])

  const warning = useCallback((title: string, message?: string) => {
    return addToast({ type: 'warning', title, message })
  }, [addToast])

  const info = useCallback((title: string, message?: string) => {
    return addToast({ type: 'info', title, message })
  }, [addToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  )
}

// Hook
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

// 全局 toast 实例（用于非组件环境）
let globalToast: ToastContextType | null = null

export function setGlobalToast(toast: ToastContextType) {
  globalToast = toast
}

export const toast = {
  success: (title: string, message?: string) => globalToast?.success(title, message),
  error: (title: string, message?: string) => globalToast?.error(title, message),
  warning: (title: string, message?: string) => globalToast?.warning(title, message),
  info: (title: string, message?: string) => globalToast?.info(title, message),
  add: (t: Omit<ToastMessage, 'id'>) => globalToast?.addToast(t),
  remove: (id: string) => globalToast?.removeToast(id),
}
