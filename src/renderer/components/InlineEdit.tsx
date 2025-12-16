/**
 * 内联编辑组件
 * Cmd+K 风格的内联代码修改
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Sparkles, Check, Loader2, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { t } from '../i18n'
import DiffViewer from './DiffViewer'

interface InlineEditProps {
	// 编辑器位置信息
	position: { x: number; y: number }
	// 选中的代码
	selectedCode: string
	// 文件路径
	filePath: string
	// 选中的行范围
	lineRange: [number, number]
	// 关闭回调
	onClose: () => void
	// 应用修改回调
	onApply: (newCode: string) => void
}

type EditState = 'idle' | 'loading' | 'preview' | 'error'

export default function InlineEdit({
	position,
	selectedCode,
	filePath,
	lineRange,
	onClose,
	onApply,
}: InlineEditProps) {
	const [instruction, setInstruction] = useState('')
	const [state, setState] = useState<EditState>('idle')
	const [generatedCode, setGeneratedCode] = useState('')
	const [error, setError] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)
	const { llmConfig, language } = useStore()

	useEffect(() => {
		inputRef.current?.focus()
	}, [])

	const handleSubmit = useCallback(async () => {
		if (!instruction.trim() || state === 'loading') return
		
		setState('loading')
		setError('')
		setGeneratedCode('')
		
		try {
			// 构建提示词
			const prompt = buildEditPrompt(instruction, selectedCode, filePath, lineRange)
			
			// 调用 LLM
			const result = await generateEdit(llmConfig, prompt)
			
			if (result.success && result.code) {
				setGeneratedCode(result.code)
				setState('preview')
			} else {
				setError(result.error || 'Failed to generate code')
				setState('error')
			}
		} catch (err: unknown) {
			const error = err as { message?: string }
			setError(error.message || 'An error occurred')
			setState('error')
		}
	}, [instruction, state, selectedCode, filePath, lineRange, llmConfig])

	const handleApply = useCallback(() => {
		if (generatedCode) {
			onApply(generatedCode)
			onClose()
		}
	}, [generatedCode, onApply, onClose])
	
	const handleRetry = useCallback(() => {
	    setState('idle')
	    setTimeout(() => inputRef.current?.focus(), 100)
	}, [])

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			if (state === 'preview') {
				handleApply()
			} else {
				handleSubmit()
			}
		} else if (e.key === 'Escape') {
			onClose()
		}
	}

	return (
		<div
			className="fixed z-50 bg-surface border border-border-subtle rounded-lg shadow-2xl overflow-hidden animate-scale-in flex flex-col"
			style={{
				left: position.x,
				top: position.y,
				minWidth: 500,
				maxWidth: 800,
                maxHeight: '80vh'
			}}
		>
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 bg-surface-hover border-b border-border-subtle shrink-0">
				<div className="flex items-center gap-2">
					<Sparkles className="w-4 h-4 text-accent" />
					<span className="text-xs font-medium text-text-primary">{t('inlineAiEdit', language)}</span>
					<span className="text-[10px] text-text-muted">
						{filePath.split('/').pop()}:{lineRange[0]}-{lineRange[1]}
					</span>
				</div>
				<button
					onClick={onClose}
					className="p-1 rounded hover:bg-surface-active text-text-muted hover:text-text-primary transition-colors"
				>
					<X className="w-3.5 h-3.5" />
				</button>
			</div>

			{/* Input */}
			<div className="p-3 bg-background shrink-0">
				<input
					ref={inputRef}
					type="text"
					value={instruction}
					onChange={(e) => setInstruction(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={t('describeChangesInline', language)}
					disabled={state === 'loading'}
					className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors shadow-sm"
				/>
			</div>

			{/* Preview (Diff) */}
			{state === 'preview' && generatedCode && (
				<div className="flex-1 overflow-hidden flex flex-col bg-background/50 border-t border-border-subtle">
					<div className="px-3 py-1.5 flex justify-between items-center bg-surface/50 border-b border-border-subtle">
                        <span className="text-[10px] uppercase tracking-wider text-text-muted font-medium">{t('diffPreview', language)}</span>
                        <div className="flex gap-2">
                            <span className="flex items-center gap-1 text-[10px] text-red-400"><span className="w-2 h-2 rounded-full bg-red-400/20 flex items-center justify-center">-</span> {t('original', language)}</span>
                            <span className="flex items-center gap-1 text-[10px] text-green-400"><span className="w-2 h-2 rounded-full bg-green-400/20 flex items-center justify-center">+</span> {t('modified', language)}</span>
                        </div>
                    </div>
					<div className="flex-1 overflow-auto p-0 min-h-[150px]">
						<DiffViewer
                            originalContent={selectedCode}
                            modifiedContent={generatedCode}
                            filePath={filePath}
                            onAccept={handleApply}
                            onReject={handleRetry}
                            minimal={true}
                        />
					</div>
				</div>
			)}

			{/* Error */}
			{state === 'error' && error && (
				<div className="px-3 pb-3 shrink-0">
					<div className="p-2 bg-status-error/10 border border-status-error/20 rounded-lg flex items-center gap-2">
                        <X className="w-4 h-4 text-status-error" />
						<p className="text-xs text-status-error flex-1">{error}</p>
                        <button onClick={handleRetry} className="text-xs underline text-status-error hover:text-red-400">{t('retry', language)}</button>
					</div>
				</div>
			)}

			{/* Actions */}
			<div className="flex items-center justify-between px-3 py-2 bg-surface-hover border-t border-border-subtle shrink-0">
				<span className="text-[10px] text-text-muted">
					{state === 'preview' ? t('pressEnterApply', language) : t('pressEnterGenerate', language)}
				</span>
				<div className="flex items-center gap-2">
					{state === 'loading' && (
						<div className="flex items-center gap-2 text-xs text-text-muted">
                            <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
                            {t('generating', language)}
                        </div>
					)}
					{state === 'preview' && (
                        <>
                            <button
                                onClick={handleRetry}
                                className="flex items-center gap-1 px-3 py-1.5 rounded bg-surface border border-border-subtle text-text-secondary text-xs hover:bg-surface-hover transition-colors"
                            >
                                <RefreshCw className="w-3 h-3" />
                                {t('retry', language)}
                            </button>
                            <button
                                onClick={handleApply}
                                className="flex items-center gap-1 px-3 py-1.5 rounded bg-accent text-white text-xs hover:bg-accent-hover transition-colors shadow-glow"
                            >
                                <Check className="w-3 h-3" />
                                {t('apply', language)}
                            </button>
                        </>
					)}
					{(state === 'idle' || state === 'error') && (
						<button
							onClick={handleSubmit}
							disabled={!instruction.trim()}
							className="flex items-center gap-1 px-3 py-1.5 rounded bg-accent text-white text-xs hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-glow"
						>
							<Sparkles className="w-3 h-3" />
							{t('generate', language)}
						</button>
					)}
				</div>
			</div>
		</div>
	)
}

/**
 * 构建编辑提示词
 */
function buildEditPrompt(
	instruction: string,
	code: string,
	filePath: string,
	lineRange: [number, number]
): string {
	const lang = filePath.split('.').pop() || 'code'
	
	return `You are a code editor assistant. Edit the following code according to the user's instruction.

File: ${filePath}
Lines: ${lineRange[0]}-${lineRange[1]}

Current code:
\`\`${lang}
${code}
\`\`

User instruction: ${instruction}

Respond with ONLY the modified code, no explanations or markdown formatting. The code should be ready to replace the original selection.`
}

interface LLMConfigForEdit {
	provider: string
	model: string
	apiKey: string
	baseUrl?: string
}

/**
 * 调用 LLM 生成编辑
 */
async function generateEdit(
	config: LLMConfigForEdit,
	prompt: string
): Promise<{ success: boolean; code?: string; error?: string }> {
	return new Promise((resolve) => {
		let result = ''
		let resolved = false
		const unsubscribers: (() => void)[] = []

		const cleanup = () => {
			if (!resolved) {
				resolved = true
				unsubscribers.forEach(unsub => unsub())
			}
		}

		// 监听流式响应
		unsubscribers.push(
			window.electronAPI.onLLMStream((chunk) => {
				if (chunk.type === 'text' && chunk.content) {
					result += chunk.content
				}
			})
		)

		// 监听完成
		unsubscribers.push(
			window.electronAPI.onLLMDone(() => {
				cleanup()
				// 清理可能的 markdown 代码块
				let code = result.trim()
				if (code.startsWith('```')) {
					code = code.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
				}
				resolve({ success: true, code })
			})
		)

		// 监听错误
		unsubscribers.push(
			window.electronAPI.onLLMError((error) => {
				cleanup()
				resolve({ success: false, error: error.message })
			})
		)

		// 超时
		setTimeout(() => {
			if (!resolved) {
				cleanup()
				resolve({ success: false, error: 'Request timeout' })
			}
		}, 60000)

		// 发送请求
		window.electronAPI.sendMessage({
			config,
			messages: [{ role: 'user', content: prompt }],
			systemPrompt: 'You are a helpful code editor assistant. Respond only with code, no explanations.',
		}).catch((err) => {
			if (!resolved) {
				cleanup()
				resolve({ success: false, error: err.message })
			}
		})
	})
}