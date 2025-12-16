/**
 * 文件引用弹出菜单
 * 在输入 @ 时显示文件列表供选择
 */

import { useState, useEffect, useRef } from 'react'
import { FileText, Search, Database, Sparkles, Code, GitBranch, Terminal } from 'lucide-react'
import { useStore } from '../store'
import { t, Language } from '../i18n'

interface FileMentionPopupProps {
	position: { x: number; y: number }
	searchQuery: string
	onSelect: (filePath: string) => void
	onClose: () => void
}

interface FileOption {
	name: string
	path: string
	isDirectory: boolean
	relativePath: string
}

// 特殊上下文选项
const getSpecialContexts = (lang: Language) => [
	{
		id: 'codebase',
		name: '@codebase',
		description: t('codebaseSearch', lang),
		icon: Database,
		color: 'text-purple-400',
	},
	{
		id: 'symbols',
		name: '@symbols',
		description: t('currentFileSymbols', lang),
		icon: Code,
		color: 'text-blue-400',
	},
	{
		id: 'git',
		name: '@git',
		description: t('gitChanges', lang),
		icon: GitBranch,
		color: 'text-orange-400',
	},
	{
		id: 'terminal',
		name: '@terminal',
		description: t('terminalOutput', lang),
		icon: Terminal,
		color: 'text-green-400',
	},
]

export default function FileMentionPopup({
	position,
	searchQuery,
	onSelect,
	onClose,
}: FileMentionPopupProps) {
	const [files, setFiles] = useState<FileOption[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [loading, setLoading] = useState(true)
	const listRef = useRef<HTMLDivElement>(null)
	const { workspacePath, openFiles, language } = useStore()
	
	// 获取国际化的特殊上下文
	const SPECIAL_CONTEXTS = getSpecialContexts(language)

	// 加载文件列表
	useEffect(() => {
		loadFiles()
	}, [workspacePath])

	const loadFiles = async () => {
		if (!workspacePath) {
			setFiles([])
			setLoading(false)
			return
		}

		setLoading(true)
		try {
			const allFiles = await collectFiles(workspacePath, workspacePath, 3)
			setFiles(allFiles)
		} catch (e) {
			console.error('Failed to load files:', e)
			setFiles([])
		}
		setLoading(false)
	}

	// 递归收集文件
	const collectFiles = async (
		dirPath: string,
		rootPath: string,
		maxDepth: number,
		currentDepth = 0
	): Promise<FileOption[]> => {
		if (currentDepth >= maxDepth) return []

		const items = await window.electronAPI.readDir(dirPath)
		if (!items) return []

		const result: FileOption[] = []
		const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv']

		for (const item of items) {
			// 跳过隐藏文件和忽略的目录
			if (item.name.startsWith('.') && item.name !== '.env') continue
			if (item.isDirectory && ignoreDirs.includes(item.name)) continue

			const relativePath = item.path.replace(rootPath, '').replace(/^[/\\]/, '')

			if (!item.isDirectory) {
				result.push({
					name: item.name,
					path: item.path,
					isDirectory: false,
					relativePath,
				})
			} else if (currentDepth < maxDepth - 1) {
				// 递归子目录
				const subFiles = await collectFiles(item.path, rootPath, maxDepth, currentDepth + 1)
				result.push(...subFiles)
			}
		}

		return result
	}

	// 过滤特殊上下文
	const filteredSpecialContexts = SPECIAL_CONTEXTS.filter(ctx => {
		if (!searchQuery) return true
		return ctx.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			ctx.id.toLowerCase().includes(searchQuery.toLowerCase())
	})

	// 过滤文件
	const filteredFiles = files.filter(file => {
		if (!searchQuery) return true
		const query = searchQuery.toLowerCase()
		return (
			file.name.toLowerCase().includes(query) ||
			file.relativePath.toLowerCase().includes(query)
		)
	}).slice(0, 10 - filteredSpecialContexts.length) // 为特殊上下文留出空间

	// 优先显示打开的文件
	const sortedFiles = [...filteredFiles].sort((a, b) => {
		const aOpen = openFiles.some(f => f.path === a.path)
		const bOpen = openFiles.some(f => f.path === b.path)
		if (aOpen && !bOpen) return -1
		if (!aOpen && bOpen) return 1
		return a.relativePath.localeCompare(b.relativePath)
	})

	// 合并列表：特殊上下文 + 文件
	const totalItems = filteredSpecialContexts.length + sortedFiles.length

	// 获取当前选中项
	const getSelectedItem = (): { type: 'special'; item: typeof SPECIAL_CONTEXTS[0] } | { type: 'file'; item: FileOption } => {
		if (selectedIndex < filteredSpecialContexts.length) {
			return { type: 'special' as const, item: filteredSpecialContexts[selectedIndex] }
		}
		const fileIndex = selectedIndex - filteredSpecialContexts.length
		return { type: 'file' as const, item: sortedFiles[fileIndex] }
	}

	// 键盘导航 - 使用 capture 阶段来优先处理
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			switch (e.key) {
				case 'ArrowDown':
					e.preventDefault()
					e.stopPropagation()
					setSelectedIndex(i => Math.min(i + 1, totalItems - 1))
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
					const selected = getSelectedItem()
					if (selected.type === 'special') {
						onSelect(selected.item.id)
					} else if (selected.item) {
						onSelect((selected.item as FileOption).relativePath)
					}
					break
				case 'Escape':
					e.preventDefault()
					e.stopPropagation()
					onClose()
					break
			}
		}

		// 使用 capture: true 来在冒泡阶段之前捕获事件
		window.addEventListener('keydown', handleKeyDown, true)
		return () => window.removeEventListener('keydown', handleKeyDown, true)
	}, [sortedFiles, filteredSpecialContexts, selectedIndex, totalItems, onSelect, onClose])

	// 滚动到选中项
	useEffect(() => {
		if (listRef.current) {
			const selectedEl = listRef.current.children[selectedIndex] as HTMLElement
			if (selectedEl) {
				selectedEl.scrollIntoView({ block: 'nearest' })
			}
		}
	}, [selectedIndex])

	// 重置选中索引
	useEffect(() => {
		setSelectedIndex(0)
	}, [searchQuery])

	return (
		<div
			className="fixed z-50 bg-surface border border-border-subtle rounded-lg shadow-xl overflow-hidden animate-fade-in"
			style={{
				left: position.x,
				bottom: `calc(100vh - ${position.y}px + 8px)`,
				minWidth: 300,
				maxWidth: 400,
				maxHeight: 320,
			}}
		>
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-surface-hover">
				<Search className="w-3.5 h-3.5 text-text-muted" />
				<span className="text-xs text-text-muted">
					{searchQuery ? `${t('searching', language)}: ${searchQuery}` : t('selectFileToReference', language)}
				</span>
			</div>

			{/* List */}
			<div ref={listRef} className="overflow-y-auto max-h-[240px]">
				{loading ? (
					<div className="flex items-center justify-center py-8">
						<div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
					</div>
				) : totalItems === 0 ? (
					<div className="py-8 text-center text-text-muted text-sm">
						{searchQuery ? t('noResultsFound', language) : t('noFilesInWorkspace', language)}
					</div>
				) : (
					<>
						{/* Special Contexts */}
						{filteredSpecialContexts.map((ctx, index) => {
							const Icon = ctx.icon
							return (
								<div
									key={ctx.id}
									onClick={() => onSelect(ctx.id)}
									className={`
										flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors
										${index === selectedIndex ? 'bg-accent/20 text-text-primary' : 'hover:bg-surface-hover text-text-secondary'}
									`}
								>
									<Icon className={`w-4 h-4 flex-shrink-0 ${ctx.color}`} />
									<div className="flex-1 min-w-0">
										<div className="text-sm font-medium">{ctx.name}</div>
										<div className="text-[10px] text-text-muted">{ctx.description}</div>
									</div>
									<Sparkles className="w-3 h-3 text-purple-400" />
								</div>
							)
						})}
						
						{/* Separator */}
						{filteredSpecialContexts.length > 0 && sortedFiles.length > 0 && (
							<div className="border-t border-border-subtle my-1" />
						)}
						
						{/* Files */}
						{sortedFiles.map((file, index) => {
							const actualIndex = index + filteredSpecialContexts.length
							const isOpen = openFiles.some(f => f.path === file.path)
							return (
								<div
									key={file.path}
									onClick={() => onSelect(file.relativePath)}
									className={`
										flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors
										${actualIndex === selectedIndex ? 'bg-accent/20 text-text-primary' : 'hover:bg-surface-hover text-text-secondary'}
									`}
								>
									<FileText className={`w-4 h-4 flex-shrink-0 ${isOpen ? 'text-accent' : 'text-text-muted'}`} />
									<div className="flex-1 min-w-0">
										<div className="text-sm truncate">{file.name}</div>
										<div className="text-[10px] text-text-muted truncate">{file.relativePath}</div>
									</div>
									{isOpen && (
										<span className="text-[10px] text-accent px-1.5 py-0.5 bg-accent/10 rounded">open</span>
									)}
								</div>
							)
						})}
					</>
				)}
			</div>

			{/* Footer */}
			<div className="px-3 py-1.5 border-t border-border-subtle bg-surface-hover text-[10px] text-text-muted flex items-center justify-between">
				<span>↑↓ {t('navigate', language)}</span>
				<span>↵ {t('selectItem', language)}</span>
				<span>Esc {t('closeMenu', language)}</span>
			</div>
		</div>
	)
}
