/** @type {import('tailwindcss').Config} */
export default {
	content: [
		"./index.html",
		"./src/**/*.{js,ts,jsx,tsx}",
	],
	theme: {
		extend: {
			colors: {
				// 使用 CSS 变量实现主题切换 (RGB 格式支持透明度)
				background: {
					DEFAULT: 'rgb(var(--color-background) / <alpha-value>)',
					secondary: 'rgb(var(--color-background-secondary) / <alpha-value>)',
					tertiary: 'rgb(var(--color-surface) / <alpha-value>)',
				},
				surface: {
					DEFAULT: 'rgb(var(--color-surface) / <alpha-value>)',
					hover: 'rgb(var(--color-surface-hover) / <alpha-value>)',
					active: 'rgb(var(--color-surface-active) / <alpha-value>)',
				},
				border: {
					DEFAULT: 'rgb(var(--color-border-strong) / <alpha-value>)',
					subtle: 'rgb(var(--color-border-subtle) / <alpha-value>)',
					highlight: 'rgb(var(--color-border-strong) / <alpha-value>)',
				},
				text: {
					primary: 'rgb(var(--color-text-primary) / <alpha-value>)',
					secondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
					muted: 'rgb(var(--color-text-muted) / <alpha-value>)',
				},
				accent: {
					DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
					hover: 'rgb(var(--color-accent-hover) / <alpha-value>)',
					muted: 'rgb(var(--color-accent-muted) / 0.2)',
					glow: 'rgb(var(--color-accent) / 0.5)',
				},
				status: {
					success: 'rgb(var(--color-status-success) / <alpha-value>)',
					warning: 'rgb(var(--color-status-warning) / <alpha-value>)',
					error: 'rgb(var(--color-status-error) / <alpha-value>)',
					info: 'rgb(var(--color-status-info) / <alpha-value>)',
				},
				// 保留 editor 命名空间以兼容部分旧代码
				'editor': {
					'bg': 'rgb(var(--color-background) / <alpha-value>)',
					'sidebar': 'rgb(var(--color-background-secondary) / <alpha-value>)',
					'border': 'rgb(var(--color-border-subtle) / <alpha-value>)',
					'hover': 'rgb(var(--color-surface-hover) / <alpha-value>)',
					'active': 'rgb(var(--color-accent) / <alpha-value>)',
					'text': 'rgb(var(--color-text-primary) / <alpha-value>)',
					'text-muted': 'rgb(var(--color-text-muted) / <alpha-value>)',
					'accent': 'rgb(var(--color-accent) / <alpha-value>)',
				}
			},
			fontFamily: {
				'mono': ['JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
				'sans': ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
			},
			boxShadow: {
				'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
				'glow': '0 0 20px rgb(var(--color-accent) / 0.15)',
			},
			animation: {
				'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
				'fade-in': 'fadeIn 0.2s ease-out',
				'slide-in': 'slideIn 0.3s ease-out',
			},
			keyframes: {
				fadeIn: {
					'0%': { opacity: '0' },
					'100%': { opacity: '1' },
				},
				slideIn: {
					'0%': { transform: 'translateX(20px)', opacity: '0' },
					'100%': { transform: 'translateX(0)', opacity: '1' },
				}
			}
		},
	},
	plugins: [],
}
