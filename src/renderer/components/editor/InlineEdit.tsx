/**
 * 内联编辑组件 - 悬浮胶囊形态 (Inline Intent Sparkles)
 * 极简的交互形态，接入 Composer Service 实现原生 Monaco 流式 Diff。
 */

import { api } from '@renderer/services/electronAPI'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, Loader2, StopCircle, Check, X } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t } from '@renderer/i18n'
import { composerService } from '@renderer/agent/services/composerService'
import { toast } from '../common/ToastProvider'

interface InlineEditProps {
	position: { x: number; y: number }
	selectedCode: string
	filePath: string
	lineRange: [number, number]
	onClose: () => void
}

type EditState = 'idle' | 'generating' | 'preview'

export default function InlineEdit({
	position,
	selectedCode,
	filePath,
	lineRange,
	onClose,
}: InlineEditProps) {
	const [instruction, setInstruction] = useState('')
	const [state, setState] = useState<EditState>('idle')
	const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
	const [originalContent, setOriginalContent] = useState<string>('')
	const inputRef = useRef<HTMLInputElement>(null)
	const { llmConfig, language, updateFileContent } = useStore(useShallow(s => ({ llmConfig: s.llmConfig, language: s.language, updateFileContent: s.updateFileContent })))
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (state === 'idle') {
			inputRef.current?.focus()
		}

		const handleClickOutside = (event: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(event.target as Node) && state === 'idle') {
				onClose()
			}
		}
		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [state, onClose])

	const handleSubmit = useCallback(async () => {
		if (!instruction.trim() || state !== 'idle') return

		const { openFiles } = useStore.getState()
		const currentFile = openFiles.find(f => f.path === filePath)
		if (!currentFile) {
			onClose()
			return
		}

		setState('generating')
		setOriginalContent(currentFile.content)

		// Create a composer session so inline diff rendering kicks in
		composerService.ensureSession('Inline Edit', 'AI Inline Edit')
		composerService.addChange({
			filePath,
			relativePath: filePath.split(/[\\/]/).pop() || filePath,
			oldContent: currentFile.content,
			newContent: currentFile.content,
			changeType: 'modify',
			linesAdded: 0,
			linesRemoved: 0
		})

		try {
			const prompt = buildEditPrompt(instruction, selectedCode, filePath, lineRange)
			const config = llmConfig
			const requestId = crypto.randomUUID()
			setActiveRequestId(requestId)

			let generatedBlock = ''
			const unsubStream = api.llm.onStream(requestId, (chunk: { type: string; content?: string }) => {
				if (chunk.type === 'text' && chunk.content) {
					generatedBlock += chunk.content

					let cleanBlock = generatedBlock.trim()
					if (cleanBlock.startsWith('```')) {
						cleanBlock = cleanBlock.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
					}

					const oldContentLines = currentFile.content.split('\n')
					const preContent = oldContentLines.slice(0, lineRange[0] - 1)
					const postContent = oldContentLines.slice(lineRange[1])

					const newFullContent = [...preContent, cleanBlock, ...postContent].join('\n')

					// Update editor buffer in real-time -> triggers useComposerInlineDiff
					updateFileContent(filePath, newFullContent)

					// Update composer service explicitly so diff logic has newContent
					composerService.addChange({
						filePath,
						relativePath: filePath.split(/[\\/]/).pop() || filePath,
						oldContent: currentFile.content,
						newContent: newFullContent,
						changeType: 'modify',
						linesAdded: 0,
						linesRemoved: 0
					})
				}
			})

			const cleanup = () => {
				unsubStream()
				unsubDone()
				unsubError()
			}

			const unsubDone = api.llm.onDone(requestId, () => {
				cleanup()
				setState('preview')
				setActiveRequestId(null)
			})

			const unsubError = api.llm.onError(requestId, (err) => {
				cleanup()
				console.error('[InlineEdit] AI Edit stream error:', err)
				toast.error(t('error', language) || 'Error', err.message || 'AI request failed')
				updateFileContent(filePath, currentFile.content)
				composerService.rejectChange(filePath)
				setState('idle')
				setActiveRequestId(null)
			})

			await api.llm.send({
				config,
				messages: [{ role: 'user', content: prompt }],
				systemPrompt: 'You are a helpful code editor assistant. Respond ONLY with the raw replacement code. No markdown code blocks, no trailing/leading text.',
				requestId,
			})
		} catch (err: any) {
			console.error(err)
			toast.error(t('error', language) || 'Error', err.message || 'Generation failed')
			updateFileContent(filePath, currentFile.content)
			composerService.rejectChange(filePath)
			setState('idle')
			setActiveRequestId(null)
		}
	}, [instruction, state, selectedCode, filePath, lineRange, llmConfig, updateFileContent, onClose])

	const handleAccept = useCallback(() => {
		// Just clear composer change pending status by "accepting" it
		composerService.acceptChange(filePath)
		onClose()
	}, [filePath, onClose])

	const handleReject = useCallback(() => {
		// Restore original content
		updateFileContent(filePath, originalContent)
		composerService.rejectChange(filePath)
		onClose()
	}, [filePath, originalContent, updateFileContent, onClose])

	const handleCancelStream = useCallback(() => {
		if (activeRequestId) {
			updateFileContent(filePath, originalContent)
			composerService.rejectChange(filePath)
			setState('idle')
			setActiveRequestId(null)
		}
	}, [activeRequestId, filePath, originalContent, updateFileContent])

	// 当进入非 idle 状态（input 被摧毁）时，需要全局监听按键
	useEffect(() => {
		if (state === 'idle') return

		const handleGlobalKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault()
				if (state === 'preview') handleAccept()
			} else if (e.key === 'Escape') {
				e.preventDefault()
				if (state === 'generating') handleCancelStream()
				else if (state === 'preview') handleReject()
			}
		}

		document.addEventListener('keydown', handleGlobalKeyDown)
		return () => document.removeEventListener('keydown', handleGlobalKeyDown)
	}, [state, handleAccept, handleReject, handleCancelStream])

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.nativeEvent.isComposing) return

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			if (state === 'idle') handleSubmit()
		} else if (e.key === 'Escape') {
			if (state === 'idle') onClose()
		}
	}

	return (
		<div
			ref={containerRef}
			className="fixed z-50 animate-scale-in"
			style={{
				left: position.x - 20,
				top: position.y - 40,
			}}
		>
			<div className={`flex items-center gap-2 bg-background/90 backdrop-blur-md border border-border/60 shadow-xl overflow-hidden py-1.5 px-3 transition-all ${state === 'preview' ? 'rounded-md w-auto' : 'rounded-full w-[400px]'
				}`}>
				{state === 'idle' && (
					<>
						<Sparkles className="w-4 h-4 text-accent flex-shrink-0" />
						<input
							ref={inputRef}
							type="text"
							value={instruction}
							onChange={(e) => setInstruction(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={t('describeChangesInline', language) || 'Ask AI to edit...'}
							spellCheck={false}
							className="flex-1 bg-transparent border-none text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:ring-0 py-0.5"
						/>
					</>
				)}

				{state === 'generating' && (
					<>
						<Loader2 className="w-4 h-4 text-accent animate-spin flex-shrink-0" />
						<span className="flex-1 text-[13px] text-text-secondary truncate">{instruction}</span>
						<button
							onClick={handleCancelStream}
							className="p-1 rounded-full text-text-muted hover:text-status-error hover:bg-status-error/10 transition-colors tooltip"
							title={t('cancel', language) || 'Cancel'}
						>
							<StopCircle className="w-4 h-4" />
						</button>
					</>
				)}

				{state === 'preview' && (
					<>
						<span className="text-[12px] text-text-secondary pr-2 border-r border-border/50">
							{t('apply' as any, language) || 'Accept'} (Enter) / {t('cancel' as any, language) || 'Reject'} (Esc)
						</span>
						<button
							onClick={handleAccept}
							className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[12px] font-medium text-status-success hover:bg-status-success/15 transition-colors"
						>
							<Check className="w-3.5 h-3.5" /> Y
						</button>
						<button
							onClick={handleReject}
							className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[12px] font-medium text-status-error hover:bg-status-error/15 transition-colors"
						>
							<X className="w-3.5 h-3.5" /> N
						</button>
					</>
				)}
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

	return `Task: Edit the code according to the instruction.

File: ${filePath}
Target Lines: ${lineRange[0]}-${lineRange[1]}

Current code of target lines:
\`\`\`${lang}
${code}
\`\`\`

User instruction: ${instruction}

CRITICAL: Respond with ONLY the exactly modified replacement code, without any explanations or formatting wrappers. It is literally being dropped into a regex replace operation.`
}