/**
 * 通用输入弹窗组件
 * 用于 @ mention 和 / slash command
 */

import { useState, useEffect, useRef, ReactNode, useCallback } from 'react'
import { useStore } from '@/renderer/store'
import { t } from '@/renderer/i18n'

export interface InputPopupItem {
    id: string
    label: string
    description?: string
    icon?: React.ComponentType<{ className?: string }>
    data?: unknown
}

interface InputPopupProps<T extends InputPopupItem> {
    position: { x: number; y: number }
    items: T[]
    loading?: boolean
    onSelect: (item: T) => void
    onClose: () => void
    header?: ReactNode
    emptyText?: string
    renderItem?: (item: T, index: number, isSelected: boolean) => ReactNode
}

export function InputPopup<T extends InputPopupItem>({
    position,
    items,
    loading = false,
    onSelect,
    onClose,
    header,
    emptyText,
    renderItem,
}: InputPopupProps<T>) {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const listRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const language = useStore(s => s.language)

    useEffect(() => {
        setSelectedIndex(0)
    }, [items])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault()
                    e.stopPropagation()
                    setSelectedIndex(i => Math.min(i + 1, items.length - 1))
                    break
                case 'ArrowUp':
                    e.preventDefault()
                    e.stopPropagation()
                    setSelectedIndex(i => Math.max(i - 1, 0))
                    break
                case 'Enter':
                case 'Tab':
                    e.preventDefault()
                    e.stopPropagation()
                    if (items[selectedIndex]) {
                        onSelect(items[selectedIndex])
                    }
                    break
                case 'Escape':
                    e.preventDefault()
                    e.stopPropagation()
                    onClose()
                    break
            }
        }

        window.addEventListener('keydown', handleKeyDown, true)
        return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [items, selectedIndex, onSelect, onClose])

    useEffect(() => {
        if (listRef.current && listRef.current.children[selectedIndex]) {
            const selectedEl = listRef.current.children[selectedIndex] as HTMLElement
            selectedEl.scrollIntoView({ block: 'nearest' })
        }
    }, [selectedIndex])

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                onClose()
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [onClose])

    const defaultRenderItem = useCallback((item: T, _index: number, isSelected: boolean) => {
        const Icon = item.icon
        return (
            <div
                key={item.id}
                onClick={() => onSelect(item)}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${isSelected ? 'bg-accent/20 text-text-primary' : 'hover:bg-surface-hover text-text-secondary'}`}
            >
                {Icon && <Icon className="w-4 h-4 flex-shrink-0 text-accent" />}
                <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{item.label}</div>
                    {item.description && (
                        <div className="text-[10px] text-text-muted truncate">{item.description}</div>
                    )}
                </div>
            </div>
        )
    }, [onSelect])

    return (
        <div
            ref={containerRef}
            className="fixed z-50 bg-surface border border-border-subtle rounded-lg shadow-xl overflow-hidden animate-fade-in"
            style={{
                left: position.x,
                bottom: `calc(100vh - ${position.y}px + 8px)`,
                minWidth: 280,
                maxWidth: 400,
                maxHeight: 320,
            }}
        >
            {header && (
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-surface-hover text-xs text-text-muted">
                    {header}
                </div>
            )}

            <div ref={listRef} className="overflow-y-auto max-h-[240px]">
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : items.length === 0 ? (
                    <div className="py-8 text-center text-text-muted text-sm">
                        {emptyText || t('noResultsFound', language)}
                    </div>
                ) : (
                    items.map((item, index) => (
                        renderItem
                            ? renderItem(item, index, index === selectedIndex)
                            : defaultRenderItem(item, index, index === selectedIndex)
                    ))
                )}
            </div>

            <div className="px-3 py-1.5 border-t border-border-subtle bg-surface-hover text-[10px] text-text-muted flex items-center justify-between">
                <span>↑↓ {t('navigate', language)}</span>
                <span>↵ {t('selectItem', language)}</span>
                <span>Esc {t('closeMenu', language)}</span>
            </div>
        </div>
    )
}
