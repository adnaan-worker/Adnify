/**
 * 底部栏弹出框公共组件
 * 在底部状态栏显示图标，点击后向上展开一个面板
 */

import { useState, useRef, useEffect, ReactNode } from 'react'
import { X } from 'lucide-react'

export interface BottomBarPopoverProps {
    /** 触发按钮的图标 */
    icon: ReactNode
    /** 按钮提示文字 */
    tooltip?: string
    /** 面板标题 */
    title?: string
    /** 面板内容 */
    children: ReactNode
    /** 面板宽度 */
    width?: number
    /** 面板高度 */
    height?: number
    /** 角标内容（如数量） */
    badge?: string | number
    /** 语言 */
    language?: 'en' | 'zh'
}

export default function BottomBarPopover({
    icon,
    tooltip,
    title,
    children,
    width = 400,
    height = 300,
    badge,
}: BottomBarPopoverProps) {
    const [isOpen, setIsOpen] = useState(false)
    const popoverRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)

    // 点击外部关闭
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                popoverRef.current &&
                !popoverRef.current.contains(e.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false)
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
        }
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [isOpen])

    // ESC 键关闭
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false)
        }
        if (isOpen) {
            document.addEventListener('keydown', handleEsc)
        }
        return () => document.removeEventListener('keydown', handleEsc)
    }, [isOpen])

    return (
        <div className="relative">
            {/* 触发按钮 */}
            <button
                ref={buttonRef}
                onClick={() => setIsOpen(!isOpen)}
                className={`
          flex items-center justify-center p-1.5 rounded
          transition-colors relative
          ${isOpen
                        ? 'bg-accent/20 text-accent'
                        : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
                    }
        `}
                title={tooltip}
            >
                {icon}
                {badge !== undefined && (
                    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center px-0.5 text-[9px] font-medium bg-accent text-white rounded-full">
                        {badge}
                    </span>
                )}
            </button>

            {/* 弹出面板 */}
            {isOpen && (
                <div
                    ref={popoverRef}
                    className="absolute bottom-full right-0 mb-3 bg-surface/80 backdrop-blur-2xl border border-border/50 rounded-2xl shadow-2xl shadow-black/20 overflow-hidden animate-slide-up z-50 origin-bottom-right"
                    style={{ width, height }}
                >
                    {/* 面板头部 */}
                    {title && (
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-white/[0.02] z-10 shrink-0">
                            <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">{title}</span>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}

                    {/* 面板内容 */}
                    <div className="overflow-auto custom-scrollbar" style={{ height: title ? height - 40 : height }}>
                        {children}
                    </div>
                </div>
            )}
        </div>
    )
}

// 添加动画样式
const style = document.createElement('style')
style.textContent = `
  @keyframes slide-up {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .animate-slide-up {
    animation: slide-up 0.15s ease-out;
  }
`
if (typeof document !== 'undefined' && !document.getElementById('bottom-bar-popover-style')) {
    style.id = 'bottom-bar-popover-style'
    document.head.appendChild(style)
}
