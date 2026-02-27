import React, { ButtonHTMLAttributes, forwardRef } from 'react'
import { Loader2 } from 'lucide-react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'icon' | 'danger' | 'success' | 'outline'
    size?: 'sm' | 'md' | 'lg' | 'icon'
    isLoading?: boolean
    leftIcon?: React.ReactNode
    rightIcon?: React.ReactNode
    glow?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className = '', variant = 'primary', size = 'md', isLoading, leftIcon, rightIcon, children, disabled, glow, ...props }, ref) => {

        const baseStyles = "relative inline-flex items-center justify-center font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50 select-none active:scale-[0.97] overflow-hidden group tracking-wide whitespace-nowrap"

        const variants = {
            primary: `
                btn-sweep bg-accent text-white rounded-xl border border-border-subtle
                shadow-[0_2px_8px_-2px_rgba(var(--accent)/0.5),inset_0_1px_1px_rgba(255,255,255,0.15)]
                hover:bg-accent-hover hover:shadow-[0_8px_16px_-4px_rgba(var(--accent)/0.4),inset_0_1px_1px_rgba(255,255,255,0.2)]
                hover:-translate-y-[1px]
            `,
            secondary: "bg-surface/50 backdrop-blur-md text-text-primary rounded-xl border border-border hover:bg-surface hover:border-border-active hover:shadow-sm",
            ghost: "bg-transparent text-text-secondary rounded-lg hover:bg-text-primary/[0.05] hover:text-text-primary",
            icon: "bg-transparent text-text-muted rounded-lg hover:bg-text-primary/[0.05] hover:text-text-primary p-0 aspect-square transition-colors",
            danger: "bg-status-error/10 text-status-error rounded-xl border border-status-error/20 hover:bg-status-error/20 hover:border-status-error/30 hover:shadow-[0_4px_12px_-4px_rgba(var(--status-error)/0.2)]",
            success: "bg-status-success/10 text-status-success rounded-xl border border-status-success/20 hover:bg-status-success/20 hover:border-status-success/30 hover:shadow-[0_4px_12px_-4px_rgba(var(--status-success)/0.2)]",
            outline: "bg-transparent border border-border-subtle text-text-secondary rounded-xl hover:border-accent/40 hover:text-text-primary hover:bg-accent/5"
        }

        const sizes = {
            sm: "h-8 px-3 text-xs gap-1.5",
            md: "h-10 px-5 text-sm gap-2",
            lg: "h-12 px-7 text-base gap-2.5",
            icon: "w-9 h-9"
        }

        return (
            <button
                ref={ref}
                className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
                disabled={disabled || isLoading}
                {...props}
            >
                {isLoading && <Loader2 className="animate-spin" size={size === 'icon' || size === 'sm' ? 14 : 16} />}
                {!isLoading && leftIcon && <span className="flex-shrink-0 transition-transform group-hover:scale-110 duration-200">{leftIcon}</span>}
                {children && <span className="relative z-10 flex items-center gap-2">{children}</span>}
                {!isLoading && rightIcon && <span className="flex-shrink-0 transition-transform group-hover:translate-x-0.5 duration-200">{rightIcon}</span>}
            </button>
        )
    }
)

Button.displayName = "Button"