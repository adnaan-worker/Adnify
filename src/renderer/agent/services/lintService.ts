/**
 * Lint 错误服务
 * 参考 void 编辑器的 get_lint_errors 功能
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { LintError } from '../types'
import { CacheService } from '@shared/utils/CacheService'
import { getCacheConfig } from '@shared/config/agentConfig'
import { useDiagnosticsStore } from '@services/diagnosticsStore'
import { normalizePath } from '@shared/utils/pathUtils'
import { getServerIdForLanguage, LSP_SERVER_DEFINITIONS } from '@shared/languages'
import { getLanguageId } from '@services/lspService'

// 支持的语言和对应的 lint 命令
const LINT_COMMANDS: Record<string, { command: string; parser: (output: string, file: string) => LintError[] }> = {
	typescript: {
		command: 'npx tsc --noEmit --pretty false',
		parser: parseTscOutput,
	},
	javascript: {
		command: 'npx eslint --format json',
		parser: parseEslintOutput,
	},
	python: {
		command: 'python -m pylint --output-format=json',
		parser: parsePylintOutput,
	},
}

// 文件扩展名到语言的映射
const EXT_TO_LANG: Record<string, string> = {
	ts: 'typescript',
	tsx: 'typescript',
	js: 'javascript',
	jsx: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	py: 'python',
}

/**
 * 解析 TypeScript 编译器输出
 */
function parseTscOutput(output: string, file: string): LintError[] {
	const errors: LintError[] = []
	const lines = output.split('\n')

	// 格式: file(line,col): error TS1234: message
	const regex = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/

	for (const line of lines) {
		const match = line.match(regex)
		if (match) {
			const [, filePath, lineNum, , severity, code, message] = match

			// 只返回指定文件的错误
			if (filePath.includes(file) || file.includes(filePath)) {
				errors.push({
					code,
					message,
					severity: severity === 'error' ? 'error' : 'warning',
					startLine: parseInt(lineNum, 10),
					endLine: parseInt(lineNum, 10),
					file: filePath,
				})
			}
		}
	}

	return errors
}

/**
 * 解析 ESLint JSON 输出
 */
function parseEslintOutput(output: string, file: string): LintError[] {
	const errors: LintError[] = []

	try {
		const results = JSON.parse(output)

		for (const result of results) {
			if (!result.filePath.includes(file) && !file.includes(result.filePath)) {
				continue
			}

			for (const msg of result.messages || []) {
				errors.push({
					code: msg.ruleId || 'eslint',
					message: msg.message,
					severity: msg.severity === 2 ? 'error' : 'warning',
					startLine: msg.line || 1,
					endLine: msg.endLine || msg.line || 1,
					file: result.filePath,
				})
			}
		}
	} catch {
		// 解析失败，尝试文本格式
		const lines = output.split('\n')
		const regex = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(\S+)$/

		for (const line of lines) {
			const match = line.match(regex)
			if (match) {
				const [, lineNum, , severity, message, code] = match
				errors.push({
					code,
					message,
					severity: severity === 'error' ? 'error' : 'warning',
					startLine: parseInt(lineNum, 10),
					endLine: parseInt(lineNum, 10),
					file,
				})
			}
		}
	}

	return errors
}

/**
 * 解析 Pylint JSON 输出
 */
function parsePylintOutput(output: string, file: string): LintError[] {
	const errors: LintError[] = []

	try {
		const results = JSON.parse(output)

		for (const msg of results) {
			if (!msg.path.includes(file) && !file.includes(msg.path)) {
				continue
			}

			errors.push({
				code: msg.symbol || msg['message-id'] || 'pylint',
				message: msg.message,
				severity: msg.type === 'error' || msg.type === 'fatal' ? 'error' : 'warning',
				startLine: msg.line || 1,
				endLine: msg.endLine || msg.line || 1,
				file: msg.path,
			})
		}
	} catch {
		// 解析失败
	}

	return errors
}

/**
 * 从 useDiagnosticsStore 中查找指定文件路径对应的 LSP 诊断。
 * 与 StatusBar/ProblemsView 使用完全相同的数据源和路径规范化逻辑。
 */
function getLspDiagnosticsForFile(filePath: string): LintError[] | null {
	const { diagnostics } = useDiagnosticsStore.getState()
	if (diagnostics.size === 0) return null

	const normalizedTarget = normalizePath(filePath).toLowerCase()

	for (const [uri, diags] of diagnostics) {
		// 与 diagnosticsStore.getFileStats 相同的 URI→path 转换
		let uriPath = uri
		if (uri.startsWith('file:///')) {
			uriPath = decodeURIComponent(uri.slice(8))
		} else if (uri.startsWith('file://')) {
			uriPath = decodeURIComponent(uri.slice(7))
		}

		const normalizedUri = normalizePath(uriPath).toLowerCase()

		if (normalizedUri === normalizedTarget || normalizedUri.endsWith(normalizedTarget)) {
			return diags.map((d) => ({
				code: d.code?.toString() || 'lsp',
				message: d.message,
				severity: d.severity === 1 ? 'error' : 'warning',
				startLine: d.range.start.line + 1,
				endLine: d.range.end.line + 1,
				file: uriPath,
			}))
		}
	}

	return null
}

/** lint 检查结果 */
export interface LintResult {
	errors: LintError[]
	/** LSP 服务器未安装时的提示信息 */
	notInstalled?: string
}

// LSP 服务器安装状态缓存（避免每次 lint 都查询）
let _serverStatusCache: Record<string, { installed: boolean }> | null = null
let _serverStatusTimestamp = 0
const SERVER_STATUS_TTL = 60_000 // 60 秒

async function getServerStatus(): Promise<Record<string, { installed: boolean }>> {
	if (_serverStatusCache && Date.now() - _serverStatusTimestamp < SERVER_STATUS_TTL) {
		return _serverStatusCache
	}
	try {
		_serverStatusCache = await api.lsp.getServerStatus()
		_serverStatusTimestamp = Date.now()
	} catch {
		_serverStatusCache = {}
	}
	return _serverStatusCache!
}

class LintService {
	private cache: CacheService<LintError[]>

	constructor() {
		const cacheConfig = getCacheConfig('lint')

		this.cache = new CacheService<LintError[]>('LintErrors', {
			maxSize: cacheConfig.maxSize,
			defaultTTL: cacheConfig.ttlMs,
			cleanupInterval: 60000,
		})
	}

	/**
	 * 获取文件的 lint 错误
	 */
	async getLintErrors(filePath: string, forceRefresh: boolean = false): Promise<LintResult> {
		// 1. 优先使用 LSP 诊断信息（与面板完全相同的数据源，支持所有 LSP 语言）
		const lspErrors = getLspDiagnosticsForFile(filePath)
		if (lspErrors !== null) {
			// LSP 已推送过诊断，直接返回（空数组表示该文件无错误）
			return { errors: lspErrors }
		}

		// 2. 检查该语言是否有对应的 LSP 服务器
		const languageId = getLanguageId(filePath)
		const serverId = getServerIdForLanguage(languageId)

		if (serverId) {
			const status = await getServerStatus()
			const serverStatus = status[serverId]
			if (!serverStatus || !serverStatus.installed) {
				// LSP 未安装 → 提示用户
				const serverDef = LSP_SERVER_DEFINITIONS.find(s => s.id === serverId)
				const serverName = serverDef?.name || serverId
				const serverDesc = serverDef?.description || serverId
				return {
					errors: [],
					notInstalled: `Language server "${serverName}" (${serverDesc}) is not installed. Install it in Settings > LSP to enable lint checking for ${languageId} files.`,
				}
			}
			// LSP 已安装但尚未推送诊断（可能诊断 IPC 还在路上）
			// 信任 LSP，返回空结果，不走 CLI 回退
			return { errors: [] }
		}

		// 3. 该语言没有 LSP 服务器定义 → 尝试 CLI 回退
		if (languageId === 'plaintext') {
			return { errors: [], notInstalled: `Unsupported file type for lint checking.` }
		}

		// 检查缓存
		if (!forceRefresh) {
			const cached = this.cache.get(filePath)
			if (cached) {
				return { errors: cached }
			}
		}

		const ext = filePath.split('.').pop()?.toLowerCase() || ''
		const lang = EXT_TO_LANG[ext]
		const lintConfig = lang ? LINT_COMMANDS[lang] : undefined

		if (!lintConfig) {
			return { errors: [] }
		}

		try {
			const [baseCommand, ...commandArgs] = lintConfig.command.split(' ')
			const allArgs = [...commandArgs, `"${filePath}"`]

			const result = await api.shell.executeSecure({
				command: baseCommand,
				args: allArgs,
				timeout: 60000,
				requireConfirm: false
			})
			const output = (result.output || '') + (result.errorOutput || '')
			const errors = lintConfig.parser(output, filePath)

			this.cache.set(filePath, errors)
			return { errors }
		} catch (error) {
			logger.agent.error('Lint error:', error)
			return { errors: [] }
		}
	}

	/**
	 * 批量获取多个文件的 lint 错误
	 */
	async getLintErrorsForFiles(filePaths: string[]): Promise<Map<string, LintResult>> {
		const results = new Map<string, LintResult>()

		// 并行执行，但限制并发数
		const batchSize = 3
		for (let i = 0; i < filePaths.length; i += batchSize) {
			const batch = filePaths.slice(i, i + batchSize)
			const batchResults = await Promise.all(
				batch.map(async (path) => ({
					path,
					result: await this.getLintErrors(path),
				}))
			)

			for (const { path, result } of batchResults) {
				results.set(path, result)
			}
		}

		return results
	}

	/**
	 * 简单的语法检查（不依赖外部工具）
	 */
	quickSyntaxCheck(content: string, language: string): LintError[] {
		const errors: LintError[] = []
		const lines = content.split('\n')

		if (language === 'typescript' || language === 'javascript') {
			// 检查括号匹配
			const brackets: { char: string; line: number }[] = []
			const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
			const closers: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]
				let inString = false
				let stringChar = ''

				for (let j = 0; j < line.length; j++) {
					const char = line[j]
					const prevChar = line[j - 1]

					// 跳过字符串内容
					if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
						if (!inString) {
							inString = true
							stringChar = char
						} else if (char === stringChar) {
							inString = false
						}
						continue
					}

					if (inString) continue

					if (pairs[char]) {
						brackets.push({ char, line: i + 1 })
					} else if (closers[char]) {
						const last = brackets.pop()
						if (!last || last.char !== closers[char]) {
							errors.push({
								code: 'syntax',
								message: `Unmatched '${char}'`,
								severity: 'error',
								startLine: i + 1,
								endLine: i + 1,
								file: '',
							})
						}
					}
				}
			}

			// 检查未闭合的括号
			for (const bracket of brackets) {
				errors.push({
					code: 'syntax',
					message: `Unclosed '${bracket.char}'`,
					severity: 'error',
					startLine: bracket.line,
					endLine: bracket.line,
					file: '',
				})
			}
		}

		return errors
	}

	/**
	 * 清除缓存
	 */
	clearCache(filePath?: string): void {
		if (filePath) {
			this.cache.delete(filePath)
		} else {
			this.cache.clear()
		}
	}

	/**
	 * 获取缓存统计
	 */
	getCacheStats() {
		return {
			lint: this.cache.getStats(),
		}
	}

	/**
	 * 格式化错误为字符串
	 */
	formatErrors(errors: LintError[]): string {
		if (errors.length === 0) {
			return '✅ No lint errors found'
		}

		const errorCount = errors.filter(e => e.severity === 'error').length
		const warningCount = errors.filter(e => e.severity === 'warning').length

		let output = `Found ${errorCount} error(s), ${warningCount} warning(s):\n\n`

		for (const error of errors.slice(0, 20)) {
			const icon = error.severity === 'error' ? '❌' : '⚠️'
			output += `${icon} Line ${error.startLine}: [${error.code}] ${error.message}\n`
		}

		if (errors.length > 20) {
			output += `\n... and ${errors.length - 20} more issues`
		}

		return output
	}

	/**
	 * 销毁服务
	 */
	dispose() {
		this.cache.destroy()
	}
}

// 单例导出
export const lintService = new LintService()
