/**
 * 上下文管理服务
 * 智能选择和管理 AI 对话的上下文
 */

import { useStore } from '../store'

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

// 上下文限制
const MAX_CONTEXT_CHARS = 50000
const MAX_FILES = 10

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
	
	// 如果文件太大，截断并添加提示
	let content = file.content
	if (content.length > 10000) {
		content = content.slice(0, 10000) + '\n\n... (truncated, file has ' + lineCount + ' lines)'
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
	terminalContext?: string
): string {
    let context = '---\n**Context:**\n\n'
    
    if (projectStructure) {
        context += projectStructure + '\n\n'
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
export async function searchCodebase(query: string, topK: number = 8): Promise<FileContext[]> {
	const state = useStore.getState()
	if (!state.workspacePath) return []
	
	try {
		const results = await window.electronAPI.indexSearch(state.workspacePath, query, topK)
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
		// 使用 gitExec API
		const statusResult = await window.electronAPI.gitExec(['status', '--short'], workspacePath)
		const status = statusResult.exitCode === 0 ? statusResult.stdout : ''
		
		const logResult = await window.electronAPI.gitExec(['log', '--oneline', '-5', '--no-decorate'], workspacePath)
		const log = logResult.exitCode === 0 ? logResult.stdout : ''
		
		const branchResult = await window.electronAPI.gitExec(['branch', '--show-current'], workspacePath)
		const branch = branchResult.exitCode === 0 ? branchResult.stdout : ''
		
		const diffResult = await window.electronAPI.gitExec(['diff', '--stat', 'HEAD'], workspacePath)
		const diff = diffResult.exitCode === 0 ? diffResult.stdout : ''
		
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
	const state = useStore.getState()
	const terminalOutputArr = state.terminalOutput || []
	
	if (terminalOutputArr.length === 0) {
		return '**Terminal:** No recent output.'
	}
	
	// 合并数组为字符串
	let output = terminalOutputArr.join('\n')
	
	// 限制输出长度
	const maxLength = 5000
	if (output.length > maxLength) {
		output = '...(truncated)\n' + output.slice(-maxLength)
	}
	
	return `**Terminal Output:**\n\`\`\`\n${output}\n\`\`\``
}

/**
 * 智能收集上下文
 */
export async function collectContext(
	message: string,
	options?: {
		includeActiveFile?: boolean
		includeOpenFiles?: boolean
        includeProjectStructure?: boolean
		maxChars?: number
	}
): Promise<{
	files: FileContext[]
	semanticResults: FileContext[]
    projectStructure?: string
	symbolsContext?: string
	gitContext?: string
	terminalContext?: string
	cleanedMessage: string
	totalChars: number
}> {
	const {
		includeActiveFile = true,
		includeOpenFiles = false,
        includeProjectStructure = true,
		maxChars = MAX_CONTEXT_CHARS,
	} = options || {}
	
	const state = useStore.getState()
	const files: FileContext[] = []
	let semanticResults: FileContext[] = []
	let totalChars = 0
    let projectStructure = ''
	let symbolsContext = ''
	let gitContext = ''
	let terminalContext = ''

    // 0. 获取项目结构
    if (includeProjectStructure && state.workspacePath) {
        projectStructure = await formatProjectStructure(state.workspacePath)
        totalChars += projectStructure.length
    }
	
	// 1. 解析 @file 引用和特殊上下文
	const refs = parseFileReferences(message)
	const useCodebase = hasCodebaseReference(message)
	const useSymbols = hasSymbolsReference(message)
	const useGit = hasGitReference(message)
	const useTerminal = hasTerminalReference(message)
	const cleanedMessage = cleanFileReferences(message)
	
	// 2. 如果使用 @codebase，执行语义搜索
	if (useCodebase && cleanedMessage.trim()) {
		semanticResults = await searchCodebase(cleanedMessage, 8)
		// 计算语义结果的字符数
		for (const result of semanticResults) {
			totalChars += result.content.length + 100 // 额外的格式化开销
		}
	}
	
	// 3. 如果使用 @symbols，提取当前文件符号
	if (useSymbols && state.activeFilePath) {
		const activeFile = state.openFiles.find(f => f.path === state.activeFilePath)
		if (activeFile) {
			const lang = getLanguageFromPath(activeFile.path)
			symbolsContext = extractSymbols(activeFile.content, lang)
			totalChars += symbolsContext.length
		}
	}
	
	// 4. 如果使用 @git，获取 Git 上下文
	if (useGit && state.workspacePath) {
		gitContext = await getGitContext(state.workspacePath)
		totalChars += gitContext.length
	}
	
	// 5. 如果使用 @terminal，获取终端输出
	if (useTerminal) {
		terminalContext = getTerminalContext()
		totalChars += terminalContext.length
	}
	
	// 6. 加载引用的文件
	for (const ref of refs) {
		if (files.length >= MAX_FILES) break
		
		// 尝试在工作区中查找文件
		let fullPath = ref
		if (state.workspacePath && !ref.startsWith('/') && !ref.includes(':')) {
			fullPath = `${state.workspacePath}/${ref}`
		}
		
		const content = await window.electronAPI.readFile(fullPath)
		if (content && totalChars + content.length <= maxChars) {
			files.push({
				path: ref,
				content,
				type: 'referenced',
				relevance: 1.0,
			})
			totalChars += content.length
		}
	}
	
	// 7. 添加当前活动文件
	if (includeActiveFile && state.activeFilePath) {
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
	
	// 8. 添加其他打开的文件（可选）
	if (includeOpenFiles) {
		for (const openFile of state.openFiles) {
			if (files.length >= MAX_FILES) break
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
	
	return { files, semanticResults, projectStructure, symbolsContext, gitContext, terminalContext, cleanedMessage, totalChars }
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
}
