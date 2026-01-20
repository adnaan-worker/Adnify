/**
 * 内嵌式 Toast 通知
 * 显示在底部状态栏上方，更加灵动简洁
 * 
 * 升级版：胶囊设计、超强模糊、细腻光影
 */

import { useState, useCallback, createContext, useContext, ReactNode, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastMessage {
  id: string
  type: ToastType
  message: string
  duration?: number
}

interface ToastContextType {
  toasts: ToastMessage[]
  addToast: (type: ToastType, message: string, durationOrDetail?: number | string) => string
  removeToast: (id: string) => void
  success: (message: string, durationOrDetail?: number | string) => string
  error: (message: string, durationOrDetail?: number | string) => string
  warning: (message: string, durationOrDetail?: number | string) => string
  info: (message: string, durationOrDetail?: number | string) => string
}

const ToastContext = createContext<ToastContextType | null>(null)

const TOAST_CONFIG = {
  success: {
    icon: CheckCircle2,
    bg: 'bg-background/80',
    border: 'border-status-success/30',
    text: 'text-status-success',
    glow: 'shadow-[0_8px_32px_-12px_rgba(var(--status-success),0.3)]'
  },
  error: {
    icon: XCircle,
    bg: 'bg-background/80',
    border: 'border-status-error/30',
    text: 'text-status-error',
    glow: 'shadow-[0_8px_32px_-12px_rgba(var(--status-error),0.3)]'
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-background/80',
    border: 'border-status-warning/30',
    text: 'text-status-warning',
    glow: 'shadow-[0_8px_32px_-12px_rgba(var(--status-warning),0.3)]'
  },
  info: {
    icon: Info,
    bg: 'bg-background/80',
    border: 'border-status-info/30',
    text: 'text-status-info',
    glow: 'shadow-[0_8px_32_px_-12px_rgba(var(--status-info),0.3)]'
  }
}

// 灵动岛风格容器
function ToastContainer({ toasts, removeToast }: { toasts: ToastMessage[]; removeToast: (id: string) => void }) {
  // 只关注最新的一条消息
  const activeToast = toasts[toasts.length - 1]

  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none flex justify-center">
      <AnimatePresence mode="wait">
        {activeToast && (
          <IslandToast key={activeToast.id} toast={activeToast} onDismiss={removeToast} />
        )}
      </AnimatePresence>
    </div>
  )
}

function IslandToast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: string) => void }) {
  const config = TOAST_CONFIG[toast.type]
  const Icon = config.icon

  useEffect(() => {
    if (toast.duration === 0) return
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration || 3000)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, onDismiss])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.9, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className="pointer-events-auto relative"
    >
      <div className={`
        flex items-center gap-3 pl-3 pr-4 py-2 rounded-full 
        bg-[#0a0a0c] text-white
        ring-1 ring-white/10 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.5)]
        min-w-[220px] max-w-[450px] overflow-hidden
      `}>
        {/* Progress Bar (Ultra Thin) */}
        {toast.duration !== 0 && (
          <motion.div 
            initial={{ width: '100%' }}
            animate={{ width: '0%' }}
            transition={{ duration: (toast.duration || 3000) / 1000, ease: 'linear' }}
            className={`absolute bottom-0 left-0 h-[1px] opacity-60 ${
              toast.type === 'error' ? 'bg-red-500' : 
              toast.type === 'success' ? 'bg-emerald-500' : 'bg-accent'
            }`}
          />
        )}

        {/* Icon with subtle background glow */}
        <div className={`
          w-7 h-7 rounded-full flex items-center justify-center shrink-0
          ${toast.type === 'error' ? 'bg-red-500/20 text-red-400' : 
            toast.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 
            'bg-accent/20 text-accent'}
        `}>
          <Icon className="w-4 h-4" strokeWidth={2.5} />
        </div>

        <span className="text-[13px] font-bold truncate flex-1 tracking-tight text-white/90">
          {toast.message}
        </span>

        <button
          onClick={() => onDismiss(toast.id)}
          className="p-1 -mr-1 rounded-full hover:bg-white/10 transition-colors shrink-0 group/btn"
        >
          <X className="w-3.5 h-3.5 text-white/40 group-hover:text-white" />
        </button>
      </div>
    </motion.div>
  )
}

// Provider
export function InlineToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const addToast = useCallback((type: ToastType, message: string, durationOrDetail?: number | string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let finalMessage = message
    let duration = 3000
    if (typeof durationOrDetail === 'string' && durationOrDetail) {
      finalMessage = `${message}: ${durationOrDetail}`
    } else if (typeof durationOrDetail === 'number') {
      duration = durationOrDetail
    }
    setToasts((prev) => {
      // 限制最多显示 5 个
      const newToasts = prev.length >= 5 ? prev.slice(1) : prev
      return [...newToasts, { id, type, message: finalMessage, duration }]
    })
    return id
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const success = useCallback((message: string, durationOrDetail?: number | string) => addToast('success', message, durationOrDetail), [addToast])
  const error = useCallback((message: string, durationOrDetail?: number | string) => addToast('error', message, durationOrDetail), [addToast])
  const warning = useCallback((message: string, durationOrDetail?: number | string) => addToast('warning', message, durationOrDetail), [addToast])
  const info = useCallback((message: string, durationOrDetail?: number | string) => addToast('info', message, durationOrDetail), [addToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  )
}

// Hook
export function useInlineToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useInlineToast must be used within InlineToastProvider')
  }
  return context
}

// 全局实例
let globalToast: ToastContextType | null = null

export function setGlobalInlineToast(toast: ToastContextType) {
  globalToast = toast
}

export const toast = {
  success: (message: string, durationOrDetail?: number | string) => globalToast?.success(message, durationOrDetail),
  error: (message: string, durationOrDetail?: number | string) => globalToast?.error(message, durationOrDetail),
  warning: (message: string, durationOrDetail?: number | string) => globalToast?.warning(message, durationOrDetail),
  info: (message: string, durationOrDetail?: number | string) => globalToast?.info(message, durationOrDetail),
}