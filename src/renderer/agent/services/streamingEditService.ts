/**
 * 流式编辑服务
 * 支持实时编辑预览和增量更新
 * 
 * 增强功能：
 * - 全局状态变更通知（用于多文件 Diff 面板）
 * - 与 composerService 集成
 * - 实时 diff 更新支持
 */

import { logger } from '@utils/Logger'
import { StreamingEditState } from '../types'

type StreamingEditListener = (state: StreamingEditState) => void
type GlobalChangeListener = (activeEdits: Map<string, StreamingEditState>) => void

class StreamingEditService {
	private activeEdits: Map<string, StreamingEditState> = new Map()
	private listeners: Map<string, Set<StreamingEditListener>> = new Map()
	private globalListeners: Set<GlobalChangeListener> = new Set()
	
	// 文件路径到 editId 的映射，方便按路径查找
	private filePathIndex: Map<string, string> = new Map()

	/**
	 * 开始流式编辑
	 */
	startEdit(filePath: string, originalContent: string): string {
		// 检查是否已有该文件的活动编辑
		const existingEditId = this.filePathIndex.get(filePath)
		if (existingEditId) {
			const existingState = this.activeEdits.get(existingEditId)
			if (existingState && !existingState.isComplete) {
				// 更新现有编辑的原始内容
				existingState.originalContent = originalContent
				return existingEditId
			}
		}

		const editId = crypto.randomUUID()

		const state: StreamingEditState = {
			editId,
			filePath,
			originalContent,
			currentContent: originalContent,
			isComplete: false,
			startTime: Date.now(),
		}

		this.activeEdits.set(editId, state)
		this.listeners.set(editId, new Set())
		this.filePathIndex.set(filePath, editId)
		
		// 通知全局监听器
		this.notifyGlobalListeners()

		return editId
	}

	/**
	 * 追加内容到流式编辑
	 */
	appendContent(editId: string, content: string): void {
		const state = this.activeEdits.get(editId)
		if (!state) return

		state.currentContent += content
		this.notifyListeners(editId, state)
		this.notifyGlobalListeners()
	}

	/**
	 * 替换当前内容
	 */
	replaceContent(editId: string, newContent: string): void {
		const state = this.activeEdits.get(editId)
		if (!state) return

		state.currentContent = newContent
		this.notifyListeners(editId, state)
		this.notifyGlobalListeners()
	}

	/**
	 * 应用增量更新（用于 search/replace 块）
	 */
	applyDelta(editId: string, searchText: string, replaceText: string): boolean {
		const state = this.activeEdits.get(editId)
		if (!state) return false

		if (state.currentContent.includes(searchText)) {
			state.currentContent = state.currentContent.replace(searchText, replaceText)
			this.notifyListeners(editId, state)
			this.notifyGlobalListeners()
			return true
		}

		return false
	}

	/**
	 * 完成流式编辑
	 */
	completeEdit(editId: string): StreamingEditState | null {
		const state = this.activeEdits.get(editId)
		if (!state) return null

		state.isComplete = true
		this.notifyListeners(editId, state)
		this.notifyGlobalListeners()

		return state
	}

	/**
	 * 取消流式编辑
	 */
	cancelEdit(editId: string): void {
		const state = this.activeEdits.get(editId)
		if (state) {
			this.filePathIndex.delete(state.filePath)
		}
		this.activeEdits.delete(editId)
		this.listeners.delete(editId)
		this.notifyGlobalListeners()
	}

	/**
	 * 获取编辑状态
	 */
	getEditState(editId: string): StreamingEditState | null {
		return this.activeEdits.get(editId) || null
	}

	/**
	 * 获取文件的活动编辑
	 */
	getActiveEditForFile(filePath: string): { editId: string; state: StreamingEditState } | null {
		for (const [editId, state] of this.activeEdits) {
			if (state.filePath === filePath && !state.isComplete) {
				return { editId, state }
			}
		}
		return null
	}

	/**
	 * 订阅编辑更新
	 */
	subscribe(editId: string, listener: StreamingEditListener): () => void {
		const listeners = this.listeners.get(editId)
		if (!listeners) {
			throw new Error(`Edit not found: ${editId}`)
		}

		listeners.add(listener)

		// 立即发送当前状态
		const state = this.activeEdits.get(editId)
		if (state) {
			listener(state)
		}

		return () => {
			listeners.delete(listener)
		}
	}

	/**
	 * 通知监听器
	 */
	private notifyListeners(editId: string, state: StreamingEditState): void {
		const listeners = this.listeners.get(editId)
		if (!listeners) return

		for (const listener of listeners) {
			try {
				listener(state)
			} catch (e) {
				logger.agent.error('Streaming edit listener error:', e)
			}
		}
	}

	/**
	 * 订阅全局状态变更（用于多文件 Diff 面板）
	 */
	subscribeGlobal(listener: GlobalChangeListener): () => void {
		this.globalListeners.add(listener)
		
		// 立即发送当前状态
		listener(this.getAllActiveEdits())
		
		return () => {
			this.globalListeners.delete(listener)
		}
	}

	/**
	 * 通知全局监听器
	 */
	private notifyGlobalListeners(): void {
		const activeEdits = this.getAllActiveEdits()
		for (const listener of this.globalListeners) {
			try {
				listener(activeEdits)
			} catch (e) {
				logger.agent.error('Global streaming edit listener error:', e)
			}
		}
	}

	/**
	 * 清理已完成的编辑（内存管理）
	 */
	cleanup(maxAge: number = 60000): void {
		const now = Date.now()

		for (const [editId, state] of this.activeEdits) {
			if (state.isComplete && now - state.startTime > maxAge) {
				this.filePathIndex.delete(state.filePath)
				this.activeEdits.delete(editId)
				this.listeners.delete(editId)
			}
		}
		
		this.notifyGlobalListeners()
	}

	/**
	 * 获取所有活动编辑
	 */
	getAllActiveEdits(): Map<string, StreamingEditState> {
		return new Map(
			Array.from(this.activeEdits).filter(([, state]) => !state.isComplete)
		)
	}

	/**
	 * 清除所有编辑
	 */
	clearAll(): void {
		this.activeEdits.clear()
		this.listeners.clear()
		this.filePathIndex.clear()
		this.notifyGlobalListeners()
	}

	/**
	 * 根据文件路径获取编辑状态
	 */
	getEditByFilePath(filePath: string): StreamingEditState | null {
		const editId = this.filePathIndex.get(filePath)
		if (!editId) return null
		return this.activeEdits.get(editId) || null
	}

	/**
	 * 更新流式内容（用于实时 diff 显示）
	 * 这个方法会同时更新 composerService 中的内容
	 */
	async updateStreamingContent(filePath: string, newContent: string): Promise<void> {
		const editId = this.filePathIndex.get(filePath)
		if (editId) {
			this.replaceContent(editId, newContent)
		}

		// 同步更新到 composerService
		try {
			const { composerService } = await import('./composerService')
			const state = composerService.getState()
			if (state.currentSession) {
				const change = state.currentSession.changes.find(c => c.filePath === filePath)
				if (change) {
					change.newContent = newContent
					// 重新计算行数
					const oldLines = (change.oldContent || '').split('\n').length
					const newLines = newContent.split('\n').length
					change.linesAdded = Math.max(0, newLines - oldLines)
					change.linesRemoved = Math.max(0, oldLines - newLines)
				}
			}
		} catch (e) {
			logger.agent.warn('[StreamingEditService] Failed to sync with composerService:', e)
		}
	}
}

// 单例导出
export const streamingEditService = new StreamingEditService()

// 定期清理
setInterval(() => {
	streamingEditService.cleanup()
}, 30000)
