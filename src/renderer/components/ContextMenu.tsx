/**
 * 通用右键菜单组件
 */
import { useEffect, useRef, useCallback, useState, useLayoutEffect } from 'react'
import { LucideIcon } from 'lucide-react'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: LucideIcon
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  onClick?: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })

  // 在渲染后调整位置，确保菜单不超出视口
  useLayoutEffect(() => {
    if (!menuRef.current) return
    
    const rect = menuRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    
    let adjustedX = x
    let adjustedY = y
    
    // 右边超出
    if (x + rect.width > viewportWidth) {
      adjustedX = viewportWidth - rect.width - 8
    }
    // 下边超出 - 向上弹出
    if (y + rect.height > viewportHeight) {
      adjustedY = y - rect.height
      // 如果向上弹出后还是超出顶部，则贴近顶部
      if (adjustedY < 8) {
        adjustedY = 8
      }
    }
    
    setPosition({
      x: Math.max(8, adjustedX),
      y: Math.max(8, adjustedY)
    })
  }, [x, y])

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    
    // 延迟添加监听，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }, 0)
    
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const handleItemClick = (item: ContextMenuItem) => {
    if (item.disabled) return
    item.onClick?.()
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[180px] py-1 bg-surface border border-border-subtle rounded-lg shadow-xl animate-fade-in"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return <div key={index} className="my-1 border-t border-border-subtle" />
        }
        
        const Icon = item.icon
        
        return (
          <button
            key={item.id}
            onClick={() => handleItemClick(item)}
            disabled={item.disabled}
            className={`
              w-full px-3 py-1.5 flex items-center gap-2 text-left text-[13px] transition-colors
              ${item.disabled 
                ? 'text-text-muted/50 cursor-not-allowed' 
                : item.danger
                  ? 'text-text-secondary hover:bg-status-error/10 hover:text-status-error'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }
            `}
          >
            {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-[11px] text-text-muted">{item.shortcut}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// 右键菜单状态 hook
export interface ContextMenuState {
  x: number
  y: number
  data?: any
}

export function useContextMenu<T = any>() {
  const [menu, setMenu] = useState<ContextMenuState & { data?: T } | null>(null)
  
  const show = useCallback((e: React.MouseEvent, data?: T) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, data })
  }, [])
  
  const hide = useCallback(() => setMenu(null), [])
  
  return { menu, show, hide }
}


