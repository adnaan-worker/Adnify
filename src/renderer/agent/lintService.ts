/**
 * Lint 错误服务
 * 参考 void 编辑器的 get_lint_errors 功能
 */

import { LintError } from './toolTypes'

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

class LintService {
	private cache: Map<string, { errors: LintError[]; timestamp: number }> = new Map()
	private cacheTimeout = 30000 // 30秒缓存

	/**
	 * 获取文件的 lint 错误
	 */
	async getLintErrors(filePath: string, forceRefresh: boolean = false): Promise<LintError[]> {
		// 检查缓存
		if (!forceRefresh) {
			const cached = this.cache.get(filePath)
			if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
				return cached.errors
			}
		}

		const ext = filePath.split('.').pop()?.toLowerCase() || ''
		const lang = EXT_TO_LANG[ext]

		if (!lang) {
			return [] // 不支持的语言
		}

		const lintConfig = LINT_COMMANDS[lang]
		if (!lintConfig) {
			return []
		}

		try {
			// 解析命令和参数，保持命令在当前目录执行
			const [baseCommand, ...commandArgs] = lintConfig.command.split(' ')
			const allArgs = [...commandArgs, `"${filePath}"`]

			const result = await window.electronAPI.executeSecureCommand({
				command: baseCommand,
				args: allArgs,
				timeout: 60000,
				requireConfirm: false
			})
			const output = (result.output || '') + (result.errorOutput || '')
			const errors = lintConfig.parser(output, filePath)

			// 更新缓存
			this.cache.set(filePath, { errors, timestamp: Date.now() })

			return errors
		} catch (error) {
			console.error('Lint error:', error)
			return []
		}
	}

	/**
	 * 批量获取多个文件的 lint 错误
	 */
	async getLintErrorsForFiles(filePaths: string[]): Promise<Map<string, LintError[]>> {
		const results = new Map<string, LintError[]>()

		// 并行执行，但限制并发数
		const batchSize = 3
		for (let i = 0; i < filePaths.length; i += batchSize) {
			const batch = filePaths.slice(i, i + batchSize)
			const batchResults = await Promise.all(
				batch.map(async (path) => ({
					path,
					errors: await this.getLintErrors(path),
				}))
			)

			for (const { path, errors } of batchResults) {
				results.set(path, errors)
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
}

// 单例导出
export const lintService = new LintService()
