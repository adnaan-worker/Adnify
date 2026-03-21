/**
 * Streaming edit service.
 * Keeps live file-edit previews in sync with the UI.
 */

import { logger } from '@utils/Logger'
import { StreamingEditState } from '../types'

type StreamingEditListener = (state: StreamingEditState) => void
type FilePathEditListener = (state: StreamingEditState | null) => void
type GlobalChangeListener = (activeEdits: Map<string, StreamingEditState>) => void

type ScheduledFrame =
	| { kind: 'raf'; id: number }
	| { kind: 'timeout'; id: ReturnType<typeof setTimeout> }

const scheduleNextFrame = (callback: () => void): ScheduledFrame => {
	if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
		return { kind: 'raf', id: window.requestAnimationFrame(callback) }
	}

	return { kind: 'timeout', id: setTimeout(callback, 16) }
}

const cancelScheduledFrame = (frame: ScheduledFrame): void => {
	if (frame.kind === 'raf') {
		if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
			window.cancelAnimationFrame(frame.id)
			return
		}

		clearTimeout(frame.id)
		return
	}

	clearTimeout(frame.id)
}

class StreamingEditService {
	private activeEdits: Map<string, StreamingEditState> = new Map()
	private listeners: Map<string, Set<StreamingEditListener>> = new Map()
	private filePathListeners: Map<string, Set<FilePathEditListener>> = new Map()
	private globalListeners: Set<GlobalChangeListener> = new Set()
	private cleanupTimer: ReturnType<typeof setInterval> | null = null

	private filePathIndex: Map<string, string> = new Map()
	private pendingEditNotifications: Map<string, StreamingEditState> = new Map()
	private pendingFilePathNotifications: Map<string, StreamingEditState | null> = new Map()
	private pendingGlobalNotification = false
	private notificationFrame: ScheduledFrame | null = null

	/**
	 * Start a streamed edit session.
	 */
	startEdit(filePath: string, originalContent: string): string {
		const existingEditId = this.filePathIndex.get(filePath)
		if (existingEditId) {
			const existingState = this.activeEdits.get(existingEditId)
			if (existingState && !existingState.isComplete) {
				// Refresh the original snapshot if the same file is edited again.
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
		this.queueStateNotification(state)

		return editId
	}

	/**
	 * Append streamed content to an active edit.
	 */
	appendContent(editId: string, content: string): void {
		const state = this.activeEdits.get(editId)
		if (!state) return

		state.currentContent += content
		this.queueStateNotification(state)
	}

	/**
	 * Replace the current streamed content.
	 */
	replaceContent(editId: string, newContent: string): void {
		const state = this.activeEdits.get(editId)
		if (!state) return

		state.currentContent = newContent
		this.queueStateNotification(state)
	}

	/**
	 * Apply an incremental replacement update.
	 */
	applyDelta(editId: string, oldString: string, newString: string): boolean {
		const state = this.activeEdits.get(editId)
		if (!state) return false

		if (state.currentContent.includes(oldString)) {
			state.currentContent = state.currentContent.replace(oldString, newString)
			this.queueStateNotification(state)
			return true
		}

		return false
	}

	/**
	 * Mark a streamed edit as complete.
	 */
	completeEdit(editId: string): StreamingEditState | null {
		const state = this.activeEdits.get(editId)
		if (!state) return null

		state.isComplete = true
		this.queueStateNotification(state)

		setTimeout(() => {
			const s = this.activeEdits.get(editId)
			if (s?.isComplete) {
				this.filePathIndex.delete(s.filePath)
				this.activeEdits.delete(editId)
				this.listeners.delete(editId)
				this.pendingEditNotifications.delete(editId)
				this.queueFilePathNotification(s.filePath, null)
				this.queueGlobalNotification()
			}
		}, 10000)

		return state
	}

	/**
	 * Cancel a streamed edit.
	 */
	cancelEdit(editId: string): void {
		const state = this.activeEdits.get(editId)
		if (state) {
			this.filePathIndex.delete(state.filePath)
			this.pendingEditNotifications.delete(editId)
			this.pendingFilePathNotifications.delete(state.filePath)
			this.notifyFilePathListeners(state.filePath, null)
		}
		this.activeEdits.delete(editId)
		this.listeners.delete(editId)
		this.notifyGlobalListeners()
	}

	/**
	 * Get edit state by edit id.
	 */
	getEditState(editId: string): StreamingEditState | null {
		return this.activeEdits.get(editId) || null
	}

	/**
	 * Get the active edit for a file path.
	 */
	getActiveEditForFile(filePath: string): { editId: string; state: StreamingEditState } | null {
		const editId = this.filePathIndex.get(filePath)
		if (!editId) return null

		const state = this.activeEdits.get(editId)
		if (!state || state.isComplete) return null

		return { editId, state }
	}

	/**
	 * Subscribe to updates for an edit id.
	 */
	subscribe(editId: string, listener: StreamingEditListener): () => void {
		const listeners = this.listeners.get(editId)
		if (!listeners) {
			throw new Error(`Edit not found: ${editId}`)
		}

		listeners.add(listener)

		const state = this.activeEdits.get(editId)
		if (state) {
			listener(state)
		}

		return () => {
			listeners.delete(listener)
		}
	}

	subscribeByFilePath(filePath: string, listener: FilePathEditListener): () => void {
		let listeners = this.filePathListeners.get(filePath)
		if (!listeners) {
			listeners = new Set()
			this.filePathListeners.set(filePath, listeners)
		}

		listeners.add(listener)
		listener(this.getEditByFilePath(filePath))

		return () => {
			const currentListeners = this.filePathListeners.get(filePath)
			if (!currentListeners) return

			currentListeners.delete(listener)
			if (currentListeners.size === 0) {
				this.filePathListeners.delete(filePath)
			}
		}
	}

	/**
	 * Notify edit-id listeners.
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

	private notifyFilePathListeners(filePath: string, state: StreamingEditState | null): void {
		const listeners = this.filePathListeners.get(filePath)
		if (!listeners) return

		for (const listener of listeners) {
			try {
				listener(state)
			} catch (e) {
				logger.agent.error('File-path streaming edit listener error:', e)
			}
		}
	}

	/**
	 * Subscribe to global active-edit changes.
	 */
	subscribeGlobal(listener: GlobalChangeListener): () => void {
		this.globalListeners.add(listener)

		listener(this.getAllActiveEdits())

		return () => {
			this.globalListeners.delete(listener)
		}
	}

	/**
	 * Notify global listeners.
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
	 * Clean up stale completed edits.
	 */
	cleanup(maxAge: number = 60000): void {
		const now = Date.now()
		let removedAny = false

		for (const [editId, state] of this.activeEdits) {
			if (state.isComplete && now - state.startTime > maxAge) {
				this.filePathIndex.delete(state.filePath)
				this.activeEdits.delete(editId)
				this.listeners.delete(editId)
				this.pendingEditNotifications.delete(editId)
				this.pendingFilePathNotifications.delete(state.filePath)
				this.notifyFilePathListeners(state.filePath, null)
				removedAny = true
			}
		}

		if (removedAny) {
			this.notifyGlobalListeners()
		}
	}

	/**
	 * Get all active edits.
	 */
	getAllActiveEdits(): Map<string, StreamingEditState> {
		return new Map(
			Array.from(this.activeEdits).filter(([, state]) => !state.isComplete)
		)
	}

	/**
	 * Clear all edit state.
	 */
	clearAll(): void {
		if (this.notificationFrame) {
			cancelScheduledFrame(this.notificationFrame)
			this.notificationFrame = null
		}

		this.pendingEditNotifications.clear()
		this.pendingFilePathNotifications.clear()
		this.pendingGlobalNotification = false

		for (const filePath of this.filePathListeners.keys()) {
			this.notifyFilePathListeners(filePath, null)
		}

		this.activeEdits.clear()
		this.listeners.clear()
		this.filePathListeners.clear()
		this.filePathIndex.clear()
		this.notifyGlobalListeners()
	}

	/**
	 * Get edit state by file path.
	 */
	getEditByFilePath(filePath: string): StreamingEditState | null {
		const editId = this.filePathIndex.get(filePath)
		if (!editId) return null
		return this.activeEdits.get(editId) || null
	}

	/**
	 * Update streamed content and mirror it to composer state.
	 */
	async updateStreamingContent(filePath: string, newContent: string): Promise<void> {
		const editId = this.filePathIndex.get(filePath)
		if (editId) {
			this.replaceContent(editId, newContent)
		}

		// Keep composer state aligned with the streaming preview.
		try {
			const { composerService } = await import('./composerService')
			const state = composerService.getState()
			if (state.currentSession) {
				const change = state.currentSession.changes.find(c => c.filePath === filePath)
				if (change) {
					change.newContent = newContent
					// Recompute simple line stats for the preview.
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

	private queueStateNotification(state: StreamingEditState): void {
		this.pendingEditNotifications.set(state.editId, state)
		this.pendingFilePathNotifications.set(state.filePath, state)
		this.pendingGlobalNotification = true
		this.scheduleNotificationFlush()
	}

	private queueFilePathNotification(filePath: string, state: StreamingEditState | null): void {
		this.pendingFilePathNotifications.set(filePath, state)
		this.scheduleNotificationFlush()
	}

	private queueGlobalNotification(): void {
		this.pendingGlobalNotification = true
		this.scheduleNotificationFlush()
	}

	private scheduleNotificationFlush(): void {
		if (this.notificationFrame) return

		this.notificationFrame = scheduleNextFrame(() => {
			this.notificationFrame = null
			this.flushNotifications()
		})
	}

	private flushNotifications(): void {
		const editNotifications = Array.from(this.pendingEditNotifications.entries())
		const filePathNotifications = Array.from(this.pendingFilePathNotifications.entries())
		const shouldNotifyGlobal = this.pendingGlobalNotification

		this.pendingEditNotifications.clear()
		this.pendingFilePathNotifications.clear()
		this.pendingGlobalNotification = false

		for (const [editId, state] of editNotifications) {
			this.notifyListeners(editId, state)
		}

		for (const [filePath, state] of filePathNotifications) {
			this.notifyFilePathListeners(filePath, state)
		}

		if (shouldNotifyGlobal) {
			this.notifyGlobalListeners()
		}
	}
}

// Singleton export.
export const streamingEditService = new StreamingEditService()

if (!streamingEditService['cleanupTimer']) {
	streamingEditService['cleanupTimer'] = setInterval(() => {
		streamingEditService.cleanup()
	}, 30000)
}
