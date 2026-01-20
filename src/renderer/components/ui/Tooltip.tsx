import React, { useState, useRef } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
    content: React.ReactNode
    children: React.ReactNode
    side?: 'top' | 'bottom' | 'left' | 'right'
    delay?: number
    className?: string
}

export function Tooltip({ content, children, side = 'top', delay = 300, className = '' }: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false)
    const [position, setPosition] = useState({ top: 0, left: 0 })
    const triggerRef = useRef<HTMLDivElement>(null)
    const tooltipRef = useRef<HTMLDivElement>(null)
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)

    const show = () => {
        timeoutRef.current = setTimeout(() => {
            setIsVisible(true)
            // Use requestAnimationFrame to ensure ref is populated before calculating
            requestAnimationFrame(updatePosition)
        }, delay)
    }

    const hide = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
        }
        setIsVisible(false)
    }

    const updatePosition = () => {
        if (!triggerRef.current) return

        const triggerRect = triggerRef.current.getBoundingClientRect()
        // If ref is not yet available (e.g. first render), assume some dimensions or update again
        const tooltipWidth = tooltipRef.current?.offsetWidth || 0
        const tooltipHeight = tooltipRef.current?.offsetHeight || 0

        const offset = 8

        let top = 0
        let left = 0

        switch (side) {
            case 'top':
                top = triggerRect.top - tooltipHeight - offset
                left = triggerRect.left + (triggerRect.width - tooltipWidth) / 2
                break
            case 'bottom':
                top = triggerRect.bottom + offset
                left = triggerRect.left + (triggerRect.width - tooltipWidth) / 2
                break
            case 'left':
                top = triggerRect.top + (triggerRect.height - tooltipHeight) / 2
                left = triggerRect.left - tooltipWidth - offset
                break
            case 'right':
                top = triggerRect.top + (triggerRect.height - tooltipHeight) / 2
                left = triggerRect.right + offset
                break
        }

        setPosition({ top, left })
    }

    // Portal tooltip to body to avoid clipping
    const tooltip = isVisible ? (
        <div
            ref={tooltipRef}
            className="fixed z-[9999] px-2.5 py-1 text-[11px] font-medium text-text-primary bg-surface-active/90 backdrop-blur-md border border-border rounded-lg shadow-xl animate-scale-in pointer-events-none whitespace-nowrap tracking-wide select-none origin-center"
            style={{ top: position.top, left: position.left }}
        >
            {content}
        </div>
    ) : null

    return (
        <div
            ref={triggerRef}
            onMouseEnter={show}
            onMouseLeave={hide}
            onMouseDown={hide} // Hide on click
            className={`relative inline-block ${className}`}
        >
            {children}
            {createPortal(tooltip, document.body)}
        </div>
    )
}