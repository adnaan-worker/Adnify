/**
 * 上下文管理服务
 * 智能选择和管理 AI 对话的上下文
 */

import { useStore } from '../store'
import { getEditorConfig } from '../config/editorConfig'
import { terminalService } from './terminalService'

export interface FileContext {
	path: string
	content: string
	type: 'active' | 'open' | 'referenced' | 'related' | 'semantic'
	relevance: number // 0-1
	startLine?: number
	endLine?: number
}

export interface ContextSelection {
	type: 'file' | 'code' | 'folder'
	path: string
	content?: string
	range?: [number, number] // [startLine, endLine]
}

// 上下文统计信息（用于 UI 显示）
export interface ContextStats {
	totalChars: number
	maxChars: number
	fileCount: number
	maxFiles: number
	messageCount: number
	maxMessages: number
	semanticResultCount: number
	terminalChars: number
}

// 获取配置的限制值
const getContextLimits = () => {
	const config = getEditorConfig()
	return {
		maxContextChars: config.ai.maxContextChars,
		maxFiles: config.ai.maxContextFiles,
		maxSemanticResults: config.ai.maxSemanticResults,
		maxTerminalChars: config.ai.maxTerminalChars,
		maxSingleFileChars: config.ai.maxSingleFileChars,
	}
}

/**
 * 解析消息中的 @file 引用
 * 支持格式: @file:path/to/file.ts 或 @path/to/file.ts
 */
export function parseFileReferences(message: string): string[] {
	const refs: string[] = []
	
	// 匹配 @file:path 或 @path 格式（排除 @codebase）
	const regex = /@(?:file:)?([^\s@]+\.[a-zA-Z0-9]+)/g
	let match
	
	while ((match = regex.exec(message)) !== null) {
		if (match[1] !== 'codebase') {
			refs.push(match[1])
		}
	}
	
	return [...new Set(refs)] // 去重
}

/**
 * 检查消息是否包含 @codebase 引用
 */
export function hasCodebaseReference(message: string): boolean {
	return /@codebase\b/i.test(message)
}

/**
 * 检查消息是否包含 @symbols 引用
 */
export function hasSymbolsReference(message: string): boolean {
	return /@symbols\b/i.test(message)
}

/**
 * 检查消息是否包含 @git 引用
 */
export function hasGitReference(message: string): boolean {
	return /@git\b/i.test(message)
}

/**
 * 检查消息是否包含 @terminal 引用
 */
export function hasTerminalReference(message: string): boolean {
	return /@terminal\b/i.test(message)
}

/**
 * 移除消息中的 @file 和特殊上下文引用，返回清理后的消息
 */
export function cleanFileReferences(message: string): string {
	return message
		.replace(/@codebase\b/gi, '')
		.replace(/@symbols\b/gi, '')
		.replace(/@git\b/gi, '')
		.replace(/@terminal\b/gi, '')
		.replace(/@(?:file:)?[^\s@]+\.[a-zA-Z0-9]+/g, '')
		.trim()
}

/**
 * 获取文件扩展名对应的语言
 */
function getLanguageFromPath(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase() || ''
	const langMap: Record<string, string> = {
		ts: 'typescript',
		tsx: 'typescript',
		js: 'javascript',
		jsx: 'javascript',
		py: 'python',
		rs: 'rust',
		go: 'go',
		java: 'java',
		cpp: 'cpp',
		c: 'c',
		h: 'c',
		hpp: 'cpp',
		css: 'css',
		scss: 'scss',
		less: 'less',
		html: 'html',
		json: 'json',
		yaml: 'yaml',
		yml: 'yaml',
		md: 'markdown',
		sql: 'sql',
		sh: 'bash',
		bash: 'bash',
		zsh: 'bash',
	}
	return langMap[ext] || ext
}

/**
 * 格式化文件内容为上下文字符串
 */
export function formatFileContext(file: FileContext): string {
	const lang = getLanguageFromPath(file.path)
	const lines = file.content.split('\n')
	const lineCount = lines.length
	const { maxSingleFileChars } = getContextLimits()
	
	// 如果文件太大，截断并添加提示
	let content = file.content
	if (content.length > maxSingleFileChars) {
		content = content.slice(0, maxSingleFileChars) + '\n\n... (truncated, file has ' + lineCount + ' lines)'
	}
	
	return `**${file.path}** (${lineCount} lines):\n\`\`\`${lang}\n${content}\n\`\`\``
}

export async function formatProjectStructure(rootPath: string): Promise<string> {
    const tree = await window.electronAPI.getFileTree(rootPath, 3) // 限制深度为3
    return `**Project Structure:**\n\`\`\`\n${tree}\n\`\`\``
}

/**
 * 格式化语义搜索结果
 */
export function formatSemanticResult(result: FileContext): string {
	const lang = getLanguageFromPath(result.path)
	const lineInfo = result.startLine && result.endLine 
		? ` (lines ${result.startLine}-${result.endLine})` 
		: ''
	const scoreInfo = result.relevance < 1 ? ` [relevance: ${(result.relevance * 100).toFixed(0)}%]` : ''
	
	return `**${result.path}**${lineInfo}${scoreInfo}:\n\`\`\`${lang}\n${result.content}\n\`\`\``
}

/**
 * 构建上下文字符串
 */
export function buildContextString(
	files: FileContext[], 
	projectStructure?: string, 
	semanticResults?: FileContext[],
	symbolsContext?: string,
	gitContext?: string,
	terminalContext?: string,
	attachedFilesContext?: string  // 附加的文件上下文
): string {
	let context = '---\n**Context:**\n\n'
	
	if (projectStructure) {
		context += projectStructure + '\n\n'
	}
	
	// 附加的文件（通过 @ 引用或拖放添加）
	if (attachedFilesContext) {
		context += attachedFilesContext + '\n\n'
	}
	
	// 语义搜索结果
	if (semanticResults && semanticResults.length > 0) {
		context += '**Relevant Code (from codebase search):**\n\n'
		context += semanticResults.map(formatSemanticResult).join('\n\n')
		context += '\n\n'
	}
	
	// 符号上下文
	if (symbolsContext) {
		context += symbolsContext + '\n\n'
	}
	
	// Git 上下文
	if (gitContext) {
		context += gitContext + '\n\n'
	}
	
	// 终端上下文
	if (terminalContext) {
		context += terminalContext + '\n\n'
	}
	
	// 文件引用
	if (files.length > 0) {
		context += '**Referenced Files:**\n\n'
        const sections = files.map(formatFileContext)
	    context += sections.join('\n\n')
    }
    
    return context
}

/**
 * 执行代码库语义搜索
 */
export async function searchCodebase(query: string, topK?: number): Promise<FileContext[]> {
	const state = useStore.getState()
	if (!state.workspacePath) return []
	
	const { maxSemanticResults } = getContextLimits()
	const limit = topK ?? maxSemanticResults
	
	try {
		const results = await window.electronAPI.indexSearch(state.workspacePath, query, limit)
		return results.map(r => ({
			path: r.relativePath,
			content: r.content,
			type: 'semantic' as const,
			relevance: r.score,
			startLine: r.startLine,
			endLine: r.endLine,
		}))
	} catch (e) {
		console.error('[Context] Codebase search failed:', e)
		return []
	}
}

/**
 * 提取当前文件的符号（函数、类、变量等）
 */
export function extractSymbols(content: string, language: string): string {
	const lines = content.split('\n')
	const symbols: string[] = []
	
	// 根据语言提取符号
	const patterns: Record<string, RegExp[]> = {
		typescript: [
			/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
			/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/,
			/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
			/^(?:export\s+)?class\s+(\w+)/,
			/^(?:export\s+)?interface\s+(\w+)/,
			/^(?:export\s+)?type\s+(\w+)/,
			/^(?:export\s+)?enum\s+(\w+)/,
		],
		javascript: [
			/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
			/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/,
			/^(?:export\s+)?class\s+(\w+)/,
		],
		python: [
			/^def\s+(\w+)/,
			/^async\s+def\s+(\w+)/,
			/^class\s+(\w+)/,
		],
		go: [
			/^func\s+(?:\([^)]+\)\s+)?(\w+)/,
			/^type\s+(\w+)\s+(?:struct|interface)/,
		],
		rust: [
			/^(?:pub\s+)?fn\s+(\w+)/,
			/^(?:pub\s+)?struct\s+(\w+)/,
			/^(?:pub\s+)?enum\s+(\w+)/,
			/^(?:pub\s+)?trait\s+(\w+)/,
			/^impl(?:<[^>]+>)?\s+(\w+)/,
		],
	}
	
	const langPatterns = patterns[language] || patterns.typescript
	
	lines.forEach((line, index) => {
		const trimmed = line.trim()
		for (const pattern of langPatterns) {
			const match = trimmed.match(pattern)
			if (match) {
				symbols.push(`Line ${index + 1}: ${trimmed.slice(0, 100)}`)
				break
			}
		}
	})
	
	return symbols.length > 0 
		? `**Symbols in current file:**\n\`\`\`\n${symbols.join('\n')}\n\`\`\``
		: ''
}

/**
 * 获取 Git 状态和最近提交
 */
export async function getGitContext(workspacePath: string): Promise<string> {
	try {
		// 使用 gitExecSecure API
		const statusResult = await window.electronAPI.gitExecSecure(['status', '--short'], workspacePath)
		const status = statusResult.success ? statusResult.stdout || '' : ''
		
		const logResult = await window.electronAPI.gitExecSecure(['log', '--oneline', '-5', '--no-decorate'], workspacePath)
		const log = logResult.success ? logResult.stdout || '' : ''
		
		const branchResult = await window.electronAPI.gitExecSecure(['branch', '--show-current'], workspacePath)
		const branch = branchResult.success ? branchResult.stdout || '' : ''
		
		const diffResult = await window.electronAPI.gitExecSecure(['diff', '--stat', 'HEAD'], workspacePath)
		const diff = diffResult.success ? diffResult.stdout || '' : ''
		
		let context = '**Git Context:**\n\n'
		
		if (branch) {
			context += `Current branch: \`${branch.trim()}\`\n\n`
		}
		
		if (status) {
			context += `**Changed files:**\n\`\`\`\n${status}\n\`\`\`\n\n`
		} else {
			context += `No uncommitted changes.\n\n`
		}
		
		if (diff) {
			context += `**Diff summary:**\n\`\`\`\n${diff}\n\`\`\`\n\n`
		}
		
		if (log) {
			context += `**Recent commits:**\n\`\`\`\n${log}\n\`\`\`\n`
		}
		
		return context
	} catch (e) {
		console.error('[Context] Git context failed:', e)
		return ''
	}
}

/**
 * 获取终端输出内容
 */
export function getTerminalContext(): string {
	// 从 terminalService 获取所有终端的输出
	const terminals = terminalService.getAllTerminals()

	if (terminals.length === 0) {
		return '**Terminal:** No active terminals.'
	}

	// 收集所有终端的输出
	let output = ''
	terminals.forEach((terminal) => {
		if (terminal.output.length > 0) {
			output += `**Terminal [${terminal.name}]:**\n\`\`\`\n`
			output += terminal.output.slice(-50).join('\n') // 只取最近50行
			output += '\n\`\`\`\n\n'
		}
	})

	if (!output) {
		return '**Terminal:** All terminals have empty output.'
	}

	// 限制输出长度
	const { maxTerminalChars } = getContextLimits()
	if (output.length > maxTerminalChars) {
		output = '...(truncated)\n' + output.slice(-maxTerminalChars)
	}

	return `**Terminal Output:**\n${output}`
}

// 上下文项类型（统一的上下文系统）
interface ContextItemForService {
	type: 'File' | 'CodeSelection' | 'Folder' | 'Codebase' | 'Git' | 'Terminal' | 'Symbols'
	uri?: string
	range?: [number, number]
	query?: string  // for Codebase
}

/**
 * 智能收集上下文
 * 统一处理所有上下文类型（文件、代码片段、@codebase、@git、@terminal、@symbols）
 */
export async function collectContext(
	message: string,
	options?: {
		includeActiveFile?: boolean
		includeOpenFiles?: boolean
		includeProjectStructure?: boolean
		maxChars?: number
		contextItems?: ContextItemForService[]  // 统一的上下文项列表
	}
): Promise<{
	files: FileContext[]
	semanticResults: FileContext[]
	projectStructure?: string
	symbolsContext?: string
	gitContext?: string
	terminalContext?: string
	attachedFilesContext?: string  // 附加的文件上下文
	cleanedMessage: string
	totalChars: number
	stats: ContextStats
}> {
	const limits = getContextLimits()
	const {
		includeActiveFile = true,
		includeOpenFiles = false,
		includeProjectStructure = true,
		maxChars = limits.maxContextChars,
		contextItems = [],
	} = options || {}
	
	const state = useStore.getState()
	const files: FileContext[] = []
	let semanticResults: FileContext[] = []
	let totalChars = 0
	let projectStructure = ''
	let symbolsContext = ''
	let gitContext = ''
	let terminalContext = ''
	let terminalChars = 0

	// 0. 获取项目结构
	if (includeProjectStructure && state.workspacePath) {
		projectStructure = await formatProjectStructure(state.workspacePath)
		totalChars += projectStructure.length
	}
	
	// 1. 从 contextItems 中提取各类上下文
	const fileItems = contextItems.filter(item => item.type === 'File' || item.type === 'CodeSelection')
	const hasCodebase = contextItems.some(item => item.type === 'Codebase')
	const hasSymbols = contextItems.some(item => item.type === 'Symbols')
	const hasGit = contextItems.some(item => item.type === 'Git')
	const hasTerminal = contextItems.some(item => item.type === 'Terminal')
	
	// 消息不需要清理（@ 引用已经通过 contextItems 处理）
	const cleanedMessage = message
	
	// 2. 如果使用 @codebase，执行语义搜索
	if (hasCodebase && cleanedMessage.trim()) {
		semanticResults = await searchCodebase(cleanedMessage)
		for (const result of semanticResults) {
			totalChars += result.content.length + 100
		}
	}
	
	// 3. 如果使用 @symbols，提取当前文件符号
	if (hasSymbols && state.activeFilePath) {
		const activeFile = state.openFiles.find(f => f.path === state.activeFilePath)
		if (activeFile) {
			const lang = getLanguageFromPath(activeFile.path)
			symbolsContext = extractSymbols(activeFile.content, lang)
			totalChars += symbolsContext.length
		}
	}
	
	// 4. 如果使用 @git，获取 Git 上下文
	if (hasGit && state.workspacePath) {
		gitContext = await getGitContext(state.workspacePath)
		totalChars += gitContext.length
	}
	
	// 5. 如果使用 @terminal，获取终端输出
	if (hasTerminal) {
		terminalContext = getTerminalContext()
		terminalChars = terminalContext.length
		totalChars += terminalChars
	}
	
	// 6. 处理文件和代码片段上下文
	const attachedParts: string[] = []
	for (const item of fileItems) {
		if (!item.uri) continue
		
		try {
			const content = await window.electronAPI.readFile(item.uri)
			if (content !== null) {
				if (item.type === 'CodeSelection' && item.range) {
					const lines = content.split('\n')
					const selectedLines = lines.slice(item.range[0] - 1, item.range[1])
					attachedParts.push(
						`<file path="${item.uri}" lines="${item.range[0]}-${item.range[1]}">\n${selectedLines.join('\n')}\n</file>`
					)
					totalChars += selectedLines.join('\n').length + 100
				} else {
					attachedParts.push(
						`<file path="${item.uri}">\n${content}\n</file>`
					)
					totalChars += content.length + 100
				}
			}
		} catch (e) {
			console.warn(`[Context] Failed to read file: ${item.uri}`, e)
		}
	}
	
	const attachedFilesContext = attachedParts.length > 0 
		? '<attached_files>\n' + attachedParts.join('\n\n') + '\n</attached_files>'
		: ''
	
	// 7. 添加当前活动文件（如果没有在 contextItems 中）
	if (includeActiveFile && state.activeFilePath) {
		const alreadyIncluded = fileItems.some(item => item.uri === state.activeFilePath)
		if (!alreadyIncluded) {
			const activeFile = state.openFiles.find(f => f.path === state.activeFilePath)
			if (activeFile && !files.some(f => f.path === activeFile.path)) {
				if (totalChars + activeFile.content.length <= maxChars) {
					files.push({
						path: activeFile.path,
						content: activeFile.content,
						type: 'active',
						relevance: 0.9,
					})
					totalChars += activeFile.content.length
				}
			}
		}
	}
	
	// 8. 添加其他打开的文件（可选）
	if (includeOpenFiles) {
		for (const openFile of state.openFiles) {
			if (files.length >= limits.maxFiles) break
			if (files.some(f => f.path === openFile.path)) continue
			if (totalChars + openFile.content.length > maxChars) continue
			
			files.push({
				path: openFile.path,
				content: openFile.content,
				type: 'open',
				relevance: 0.5,
			})
			totalChars += openFile.content.length
		}
	}
	
	// 按相关性排序
	files.sort((a, b) => b.relevance - a.relevance)
	
	// 构建统计信息
	const stats: ContextStats = {
		totalChars,
		maxChars: limits.maxContextChars,
		fileCount: files.length + fileItems.length,
		maxFiles: limits.maxFiles,
		messageCount: 0, // 由 useAgent 填充
		maxMessages: getEditorConfig().ai.maxHistoryMessages,
		semanticResultCount: semanticResults.length,
		terminalChars,
	}
	
	return { files, semanticResults, projectStructure, symbolsContext, gitContext, terminalContext, attachedFilesContext, cleanedMessage, totalChars, stats }
}

/**
 * 获取当前上下文限制配置
 */
export function getContextLimitsConfig() {
	return getContextLimits()
}

/**
 * 上下文服务单例
 */
export const contextService = {
	parseFileReferences,
	cleanFileReferences,
	hasCodebaseReference,
	hasSymbolsReference,
	hasGitReference,
	hasTerminalReference,
	formatFileContext,
	formatSemanticResult,
    formatProjectStructure,
	buildContextString,
	searchCodebase,
	extractSymbols,
	getGitContext,
	getTerminalContext,
	collectContext,
	getContextLimitsConfig,
}
