/**
 * 自定义确认对话框组件
 * 替代原生 window.confirm，支持国际化和自定义样式
 */
import { logger } from '@utils/Logger'
import { useState, useCallback, createContext, useContext, ReactNode, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'

interface ConfirmDialogProps {
  isOpen: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  variant = 'warning',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const language = useStore(s => s.language)

  const variantStyles = {
    danger: {
      icon: 'text-red-400 bg-red-500/10',
      buttonVariant: 'danger' as const,
    },
    warning: {
      icon: 'text-yellow-400 bg-yellow-500/10',
      buttonVariant: 'primary' as const,
    },
    info: {
      icon: 'text-blue-400 bg-blue-500/10',
      buttonVariant: 'primary' as const,
    },
  }

  const styles = variantStyles[variant]

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} size="sm">
      <div className="flex items-start gap-4">
        <div className={`p-2 rounded-lg ${styles.icon}`}>
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0 pt-1">
          <p className="text-sm text-text-secondary leading-relaxed">
            {message}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 mt-6">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {cancelText || t('cancel', language)}
        </Button>
        <Button variant={styles.buttonVariant} size="sm" onClick={onConfirm}>
          {confirmText || 'OK'}
        </Button>
      </div>
    </Modal>
  )
}

// ============ Hook 版本 ============

interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
}

export function useConfirmDialog() {
  const [state, setState] = useState<{
    isOpen: boolean
    options: ConfirmOptions | null
    resolve: ((value: boolean) => void) | null
  }>({
    isOpen: false,
    options: null,
    resolve: null,
  })

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        options,
        resolve,
      })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    state.resolve?.(true)
    setState({ isOpen: false, options: null, resolve: null })
  }, [state.resolve])

  const handleCancel = useCallback(() => {
    state.resolve?.(false)
    setState({ isOpen: false, options: null, resolve: null })
  }, [state.resolve])

  const DialogComponent = state.options ? (
    <ConfirmDialog
      isOpen={state.isOpen}
      {...state.options}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null

  return { confirm, DialogComponent }
}

// ============ 全局确认对话框 ============

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextType | null>(null)

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { confirm, DialogComponent } = useConfirmDialog()

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {DialogComponent}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const context = useContext(ConfirmContext)
  if (!context) {
    throw new Error('useConfirm must be used within ConfirmDialogProvider')
  }
  return context.confirm
}

// ============ 简单的全局 confirm 函数（不依赖 Context） ============

let globalResolve: ((value: boolean) => void) | null = null
let globalSetState: ((state: { isOpen: boolean; options: ConfirmOptions | null }) => void) | null = null

export function GlobalConfirmDialog() {
  const [state, setState] = useState<{
    isOpen: boolean
    options: ConfirmOptions | null
  }>({
    isOpen: false,
    options: null,
  })

  useEffect(() => {
    globalSetState = setState
    return () => {
      globalSetState = null
    }
  }, [])

  const handleConfirm = useCallback(() => {
    globalResolve?.(true)
    globalResolve = null
    setState({ isOpen: false, options: null })
  }, [])

  const handleCancel = useCallback(() => {
    globalResolve?.(false)
    globalResolve = null
    setState({ isOpen: false, options: null })
  }, [])

  if (!state.options) return null

  return (
    <ConfirmDialog
      isOpen={state.isOpen}
      {...state.options}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )
}

/**
 * 全局确认函数，可以在任何地方调用
 * 需要在 App 根组件中渲染 <GlobalConfirmDialog />
 */
export function globalConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!globalSetState) {
      // 如果没有挂载 GlobalConfirmDialog，回退到原生 confirm
      logger.ui.warn('GlobalConfirmDialog not mounted, falling back to native confirm')
      resolve(window.confirm(options.message))
      return
    }
    globalResolve = resolve
    globalSetState({ isOpen: true, options })
  })
}
