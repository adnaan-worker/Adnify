/**
 * 会话管理服务
 * 保存和加载对话历史
 * 使用 chatThreadService 的消息格式
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { LLMConfig } from '@store'
import { WorkMode } from '@/renderer/modes/types'
import { ChatMessage, ChatThread, getMessageText as getMsgText, isUserMessage } from '../types'
import { useAgentStore } from '../store/AgentStore'

export interface ChatSession {
	id: string
	name: string
	mode: WorkMode
	messages: ChatMessage[]
	createdAt: number
	updatedAt: number
	config?: Partial<LLMConfig>
}

export interface SessionSummary {
	id: string
	name: string
	mode: WorkMode
	messageCount: number
	createdAt: number
	updatedAt: number
	preview: string // 第一条用户消息的预览
}

const SESSIONS_KEY = 'chat_sessions'
const MAX_SESSIONS = 50

/**
 * 提取消息文本内容
 */
function getMessageText(msg: ChatMessage): string {
	if (isUserMessage(msg)) {
		return getMsgText(msg.content)
	}
	if ('content' in msg && typeof msg.content === 'string') {
		return msg.content
	}
	return ''
}

/**
 * 生成会话名称
 */
function generateSessionName(messages: ChatMessage[]): string {
	const firstUserMessage = messages.find(m => isUserMessage(m))
	if (firstUserMessage) {
		const text = getMessageText(firstUserMessage)
		const preview = text.slice(0, 50)
		return preview.length < text.length ? preview + '...' : preview
	}
	return `Session ${new Date().toLocaleString()}`
}

/**
 * 获取消息预览
 */
function getMessagePreview(messages: ChatMessage[]): string {
	const firstUserMessage = messages.find(m => isUserMessage(m))
	if (firstUserMessage) {
		return getMessageText(firstUserMessage).slice(0, 100)
	}
	return ''
}

class SessionService {
	/**
	 * 获取所有会话摘要
	 */
	async getSessions(): Promise<SessionSummary[]> {
		try {
			const data = await api.settings.get(SESSIONS_KEY)
			if (!data || typeof data !== 'string') return []
			
			const sessions: ChatSession[] = JSON.parse(data)
			return sessions.map(s => ({
				id: s.id,
				name: s.name,
				mode: s.mode,
				messageCount: s.messages.length,
				createdAt: s.createdAt,
				updatedAt: s.updatedAt,
				preview: getMessagePreview(s.messages),
			})).sort((a, b) => b.updatedAt - a.updatedAt)
		} catch {
			return []
		}
	}

	/**
	 * 获取单个会话
	 */
	async getSession(id: string): Promise<ChatSession | null> {
		try {
			const data = await api.settings.get(SESSIONS_KEY)
			if (!data || typeof data !== 'string') return null
			
			const sessions: ChatSession[] = JSON.parse(data)
			return sessions.find(s => s.id === id) || null
		} catch {
			return null
		}
	}

	/**
	 * 保存当前线程为会话
	 */
	async saveCurrentThread(
		mode: WorkMode,
		existingId?: string,
		config?: Partial<LLMConfig>
	): Promise<string> {
		const thread = useAgentStore.getState().getCurrentThread()
		if (!thread) {
			throw new Error('No current thread')
		}
		return this.saveThread(thread, mode, existingId, config)
	}

	/**
	 * 保存指定线程为会话
	 */
	async saveThread(
		thread: ChatThread,
		mode: WorkMode,
		existingId?: string,
		config?: Partial<LLMConfig>
	): Promise<string> {
		const data = await api.settings.get(SESSIONS_KEY)
		let sessions: ChatSession[] = data && typeof data === 'string' ? JSON.parse(data) : []
		
		const now = Date.now()
		const messages = thread.messages
		
		if (existingId) {
			// 更新现有会话
			const idx = sessions.findIndex(s => s.id === existingId)
			if (idx >= 0) {
				sessions[idx] = {
					...sessions[idx],
					messages,
					mode,
					updatedAt: now,
					config,
				}
				await api.settings.set(SESSIONS_KEY, JSON.stringify(sessions))
				return existingId
			}
		}
		
		// 创建新会话
		const newSession: ChatSession = {
			id: crypto.randomUUID(),
			name: generateSessionName(messages),
			mode,
			messages,
			createdAt: now,
			updatedAt: now,
			config,
		}
		
		sessions.unshift(newSession)
		
		// 限制会话数量
		if (sessions.length > MAX_SESSIONS) {
			sessions = sessions.slice(0, MAX_SESSIONS)
		}
		
		await api.settings.set(SESSIONS_KEY, JSON.stringify(sessions))
		return newSession.id
	}

	/**
	 * 删除会话
	 */
	async deleteSession(id: string): Promise<boolean> {
		try {
			const data = await api.settings.get(SESSIONS_KEY)
			if (!data || typeof data !== 'string') return false
			
			let sessions: ChatSession[] = JSON.parse(data)
			const initialLength = sessions.length
			sessions = sessions.filter(s => s.id !== id)
			
			if (sessions.length < initialLength) {
				await api.settings.set(SESSIONS_KEY, JSON.stringify(sessions))
				return true
			}
			return false
		} catch {
			return false
		}
	}

	/**
	 * 重命名会话
	 */
	async renameSession(id: string, name: string): Promise<boolean> {
		try {
			const data = await api.settings.get(SESSIONS_KEY)
			if (!data || typeof data !== 'string') return false
			
			const sessions: ChatSession[] = JSON.parse(data)
			const session = sessions.find(s => s.id === id)
			
			if (session) {
				session.name = name
				session.updatedAt = Date.now()
				await api.settings.set(SESSIONS_KEY, JSON.stringify(sessions))
				return true
			}
			return false
		} catch {
			return false
		}
	}

	/**
	 * 清除所有会话
	 */
	async clearAllSessions(): Promise<void> {
		await api.settings.set(SESSIONS_KEY, JSON.stringify([]))
	}

	/**
	 * 导出会话为 JSON
	 */
	async exportSession(id: string): Promise<string | null> {
		const session = await this.getSession(id)
		if (!session) return null
		return JSON.stringify(session, null, 2)
	}

	/**
	 * 导入会话
	 */
	async importSession(jsonStr: string): Promise<string | null> {
		try {
			const session: ChatSession = JSON.parse(jsonStr)
			
			// 验证必要字段
			if (!session.messages || !Array.isArray(session.messages)) {
				throw new Error('Invalid session format')
			}
			
			// 生成新 ID
			session.id = crypto.randomUUID()
			session.createdAt = Date.now()
			session.updatedAt = Date.now()
			
			const data = await api.settings.get(SESSIONS_KEY)
			const sessions: ChatSession[] = data && typeof data === 'string' ? JSON.parse(data) : []
			
			sessions.unshift(session)
			await api.settings.set(SESSIONS_KEY, JSON.stringify(sessions))
			
			return session.id
		} catch {
			return null
		}
	}

	/**
	 * 加载会话到当前线程
	 */
	async loadSessionToThread(sessionId: string): Promise<boolean> {
		const session = await this.getSession(sessionId)
		if (!session) return false

		const store = useAgentStore.getState()
		
		// 创建新线程
		const threadId = store.createThread()
		
		// 直接设置线程的消息（通过 zustand set）
		useAgentStore.setState(state => {
			const thread = state.threads[threadId]
			if (!thread) return state
			
			return {
				threads: {
					...state.threads,
					[threadId]: {
						...thread,
						messages: session.messages,
						lastModified: Date.now(),
					},
				},
			}
		})
		
		logger.agent.info('[SessionService] Loaded session:', sessionId, 'messages:', session.messages.length)
		return true
	}
}

export const sessionService = new SessionService()
