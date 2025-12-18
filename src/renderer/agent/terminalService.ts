/**
 * 持久化终端服�?
 * 参�?void 编辑器的 run_persistent_command 功能
 */

import { PersistentTerminal, TerminalCommandResult } from './toolTypes'

const MAX_TERMINALS = 5
const MAX_OUTPUT_LINES = 1000
const OUTPUT_CLEANUP_THRESHOLD = 1200

class TerminalService {
	private terminals: Map<string, PersistentTerminal> = new Map()
	private outputListeners: Map<string, Set<(output: string) => void>> = new Map()

	/**
	 * 创建或获取持久化终端
	 */
	async openTerminal(name: string, cwd?: string): Promise<PersistentTerminal> {
		// 检查是否已存在同名终端
		for (const [, terminal] of this.terminals) {
			if (terminal.name === name) {
				return terminal
			}
		}

		// 限制终端数量
		if (this.terminals.size >= MAX_TERMINALS) {
			// 关闭最旧的非运行终�?
			let oldestId: string | null = null
			let oldestTime = Infinity

			for (const [id, terminal] of this.terminals) {
				if (!terminal.isRunning && terminal.createdAt < oldestTime) {
					oldestTime = terminal.createdAt
					oldestId = id
				}
			}

			if (oldestId) {
				this.closeTerminal(oldestId)
			} else {
				throw new Error(`Maximum terminal limit (${MAX_TERMINALS}) reached`)
			}
		}

		const id = window.crypto.randomUUID()
		const terminal: PersistentTerminal = {
			id,
			name,
			cwd: cwd || '.',
			isRunning: false,
			lastOutput: '',
			createdAt: Date.now(),
			output: [],
		}

		this.terminals.set(id, terminal)
		this.outputListeners.set(id, new Set())

		return terminal
	}

	/**
	 * 在终端中执行命令
	 */
	async runCommand(
		terminalId: string,
		command: string,
		waitForCompletion: boolean = true,
		timeout: number = 30000
	): Promise<TerminalCommandResult> {
		const terminal = this.terminals.get(terminalId)
		if (!terminal) {
			throw new Error(`Terminal not found: ${terminalId}`)
		}

		terminal.isRunning = true
		this.appendOutput(terminalId, `$ ${command}\n`)

		try {
			if (waitForCompletion) {
				// 同步执行，等待完�?
				const result = await Promise.race([
					window.electronAPI.executeSecureCommand({
						command: command.split(' ')[0],
						args: command.split(' ').slice(1),
						cwd: terminal.cwd,
						timeout,
						requireConfirm: false
					}),
					new Promise<never>((_, reject) =>
						setTimeout(() => reject(new Error(`Command timed out after ${timeout}ms`)), timeout)
					),
				])
				if (!result.success) {
					throw new Error(result.error || 'Command execution failed')
				}

				const output = (result.output || '') + (result.errorOutput ? `\nStderr: ${result.errorOutput}` : '')
				this.appendOutput(terminalId, output + '\n')

				terminal.isRunning = false

				return {
					terminalId,
					output,
					exitCode: result.exitCode ?? 0,
					isComplete: true,
					success: true,
					duration: 0
				}
			} else {
				// 异步执行，立即返�?
				window.electronAPI.executeSecureCommand({
					command: command.split(' ')[0],
					args: command.split(' ').slice(1),
					cwd: terminal.cwd,
					timeout,
					requireConfirm: false
				}).then((result) => {
					const output = (result.output || '') + (result.errorOutput ? `\nStderr: ${result.errorOutput}` : '')
					this.appendOutput(terminalId, output + '\n')
					terminal.isRunning = false
				}).catch((error) => {
					this.appendOutput(terminalId, `Error: ${error.message}\n`)
					terminal.isRunning = false
				})

				return {
					terminalId,
					output: 'Command started in background...',
					exitCode: 0,
					isComplete: false,
					success: true,
					duration: 0
				}
			}
		} catch (error: unknown) {
			terminal.isRunning = false
			const err = error as { message?: string }
			this.appendOutput(terminalId, `Error: ${err.message}\n`)
			throw error
		}
	}

	/**
	 * 追加输出到终�?
	 */
	private appendOutput(terminalId: string, text: string): void {
		const terminal = this.terminals.get(terminalId)
		if (!terminal) return

		const lines = text.split('\n')
		terminal.output.push(...lines)

		// 内存管理：超过阈值时清理旧输�?
		if (terminal.output.length > OUTPUT_CLEANUP_THRESHOLD) {
			terminal.output = terminal.output.slice(-MAX_OUTPUT_LINES)
		}

		// 通知监听�?
		const listeners = this.outputListeners.get(terminalId)
		if (listeners) {
			for (const listener of listeners) {
				listener(text)
			}
		}
	}

	/**
	 * 获取终端输出
	 */
	getOutput(terminalId: string, lastN?: number): string[] {
		const terminal = this.terminals.get(terminalId)
		if (!terminal) return []

		if (lastN) {
			return terminal.output.slice(-lastN)
		}
		return [...terminal.output]
	}

	/**
	 * 订阅终端输出
	 */
	subscribeOutput(terminalId: string, callback: (output: string) => void): () => void {
		const listeners = this.outputListeners.get(terminalId)
		if (!listeners) {
			throw new Error(`Terminal not found: ${terminalId}`)
		}

		listeners.add(callback)

		return () => {
			listeners.delete(callback)
		}
	}

	/**
	 * 关闭终端
	 */
	closeTerminal(terminalId: string): boolean {
		const terminal = this.terminals.get(terminalId)
		if (!terminal) return false

		// 清理资源
		this.outputListeners.delete(terminalId)
		this.terminals.delete(terminalId)

		return true
	}

	/**
	 * 获取所有终�?
	 */
	getAllTerminals(): PersistentTerminal[] {
		return Array.from(this.terminals.values())
	}

	/**
	 * 获取终端
	 */
	getTerminal(terminalId: string): PersistentTerminal | undefined {
		return this.terminals.get(terminalId)
	}

	/**
	 * 按名称获取终�?
	 */
	getTerminalByName(name: string): PersistentTerminal | undefined {
		for (const terminal of this.terminals.values()) {
			if (terminal.name === name) {
				return terminal
			}
		}
		return undefined
	}

	/**
	 * 清除终端输出
	 */
	clearOutput(terminalId: string): void {
		const terminal = this.terminals.get(terminalId)
		if (terminal) {
			terminal.output = []
		}
	}

	/**
	 * 清除所有终�?
	 */
	clearAll(): void {
		this.terminals.clear()
		this.outputListeners.clear()
	}
}

// 单例导出
export const terminalService = new TerminalService()
