import React, { memo, useMemo } from 'react'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useEscapeKey } from '@/renderer/hooks/usePerformance'

interface ModalProps {
    isOpen: boolean
    onClose: () => void
    title?: string
    children: React.ReactNode
    size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | 'full'
    noPadding?: boolean
    className?: string
    showCloseButton?: boolean
}

const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    'full': 'max-w-full mx-4 h-[90vh]'
}

export const Modal: React.FC<ModalProps> = memo(function Modal({
    isOpen, onClose, title, children, size = 'md', noPadding = false, className = '', showCloseButton = true
}) {
    useEscapeKey(onClose, isOpen)

    const sizeClass = useMemo(() => sizes[size], [size])

    if (!isOpen) return null

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 bg-text-inverted/40 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal Content */}
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", duration: 0.5, bounce: 0.2 }}
                className={`
                    relative w-full ${sizeClass} 
                    bg-background/80 backdrop-blur-2xl 
                    border border-border/50 
                    rounded-3xl shadow-2xl shadow-black/20 
                    overflow-hidden 
                    flex flex-col ${className}
                `}
            >
                <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
                    <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-accent/5 rounded-full blur-[100px]" />
                    <div className="absolute bottom-[-20%] left-[-10%] w-[40%] h-[40%] bg-accent/3 rounded-full blur-[80px]" />
                </div>

                {title && (
                    <div className="relative flex items-center justify-between px-6 py-5 border-b border-border/50 bg-text-primary/[0.02] z-10 shrink-0">
                        <h3 className="text-lg font-bold text-text-primary tracking-tight">{title}</h3>
                        {showCloseButton && (
                            <button onClick={onClose} className="p-2 rounded-xl hover:bg-text-primary/[0.05] text-text-muted hover:text-text-primary transition-all duration-200 group">
                                <X className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                            </button>
                        )}
                    </div>
                )}

                <div className={`relative z-10 custom-scrollbar ${noPadding ? '' : 'p-6'} flex-1 overflow-auto`}>
                    {children}
                </div>
            </motion.div>
        </div>,
        document.body
    )
})
