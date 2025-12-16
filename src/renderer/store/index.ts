import { create } from 'zustand'
import { FileItem } from '../types/electron'
import { Language } from '../i18n'
import { ToolStatus, ToolApprovalType, Checkpoint } from '../agent/toolTypes'
import { ProviderModelConfig } from '../types/provider'

export type ChatMode = 'chat' | 'agent'
export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'groq' | 'ollama' | 'custom'

export interface Message {
	id: string
	role: 'user' | 'assistant' | 'tool'
	content: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }>
	toolCallId?: string
	toolName?: string
	toolResult?: string
	isStreaming?: boolean
	timestamp: number
}

export interface ToolCall {
	id: string
	name: string
	arguments: Record<string, unknown>
    argsBuffer?: string
	status: ToolStatus
	approvalType?: ToolApprovalType
	result?: string
	error?: string
}

export interface LLMConfig {
	provider: ProviderType
	model: string
	apiKey: string
	baseUrl?: string
	timeout?: number // API 请求超时（毫秒）
}

// 自动审批设置
export interface AutoApproveSettings {
	edits: boolean
	terminal: boolean
	dangerous: boolean
}

interface EditorState {
	// File explorer
	workspacePath: string | null
	files: FileItem[]
	expandedFolders: Set<string>

	// Editor
	openFiles: { path: string; content: string; isDirty: boolean; originalContent?: string }[]
	activeFilePath: string | null

	// Chat
	chatMode: ChatMode
	messages: Message[]
	isStreaming: boolean
    // currentToolCalls removed from public interface logic, handled within messages or separate component? 
    // actually keeping it for active state is fine, but we need to link it visually.
	currentToolCalls: ToolCall[]

	// Terminal
	terminalOutput: string[]
	terminalVisible: boolean

	// Settings
	llmConfig: LLMConfig
    providerConfigs: Record<string, ProviderModelConfig>
	showSettings: boolean
	language: Language
	autoApprove: AutoApproveSettings

	// Tool approval
	pendingToolCall: ToolCall | null

	// Checkpoints
	checkpoints: Checkpoint[]
	currentCheckpointIdx: number

	// Sidebar
	activeSidePanel: 'explorer' | 'search' | 'git' | 'settings' | null
    
    // Diff View
    activeDiff: { original: string; modified: string; filePath: string } | null

	// Actions
	setWorkspacePath: (path: string | null) => void
	setFiles: (files: FileItem[]) => void
	toggleFolder: (path: string) => void
	openFile: (path: string, content: string, originalContent?: string) => void
	closeFile: (path: string) => void
	setActiveFile: (path: string | null) => void
	updateFileContent: (path: string, content: string) => void
	markFileSaved: (path: string) => void
	
	setActiveSidePanel: (panel: 'explorer' | 'search' | 'git' | 'settings' | null) => void
    setActiveDiff: (diff: { original: string; modified: string; filePath: string } | null) => void

	setChatMode: (mode: ChatMode) => void
	addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void
	updateLastMessage: (content: string) => void
    appendTokenToLastMessage: (token: string) => void
    finalizeLastMessage: () => void
	editMessage: (id: string, content: string) => void
	deleteMessagesAfter: (id: string) => void
	setIsStreaming: (streaming: boolean) => void
    startToolCall: (id: string, name: string) => void
    appendToolCallArgs: (id: string, delta: string) => void
	clearMessages: () => void
	addToolCall: (toolCall: Omit<ToolCall, 'status'>) => void
	updateToolCall: (id: string, updates: Partial<ToolCall>) => void

	// Terminal
	addTerminalOutput: (output: string) => void
	clearTerminal: () => void
	setTerminalVisible: (visible: boolean) => void

	setLLMConfig: (config: Partial<LLMConfig>) => void
    setProviderConfig: (providerId: string, config: Partial<ProviderModelConfig>) => void
    addCustomModel: (providerId: string, model: string) => void
    removeCustomModel: (providerId: string, model: string) => void
	setShowSettings: (show: boolean) => void
	setLanguage: (lang: Language) => void
	setAutoApprove: (settings: Partial<AutoApproveSettings>) => void

	// Tool approval actions
	setPendingToolCall: (toolCall: ToolCall | null) => void
	approveToolCall: () => void
	rejectToolCall: () => void

	// Checkpoint actions
	addCheckpoint: (checkpoint: Checkpoint) => void
	setCurrentCheckpointIdx: (idx: number) => void
	clearCheckpoints: () => void

	// Session management
	currentSessionId: string | null
	setCurrentSessionId: (id: string | null) => void

    // UI State
    inputPrompt: string
    setInputPrompt: (prompt: string) => void
}

export const useStore = create<EditorState>((set) => ({
	// Initial state
	workspacePath: null,
	files: [],
	expandedFolders: new Set(),
	openFiles: [],
	activeFilePath: null,
	chatMode: 'chat',
	messages: [],
    inputPrompt: '',
	isStreaming: false,
	currentToolCalls: [],
	terminalOutput: [],
	terminalVisible: false,
	llmConfig: {
		provider: 'openai',
		model: 'gpt-4o',
		apiKey: '',
	},
    providerConfigs: {},
	showSettings: false,
	language: 'en',
	autoApprove: {
		edits: false,
		terminal: false,
		dangerous: false,
	},
	pendingToolCall: null,
	checkpoints: [],
	currentCheckpointIdx: -1,
	activeSidePanel: 'explorer',
	currentSessionId: null,
    activeDiff: null,

	// File explorer actions
	setWorkspacePath: (path) => set({ workspacePath: path }),
	setFiles: (files) => set({ files }),
	toggleFolder: (path) => set((state) => {
		const newExpanded = new Set(state.expandedFolders)
		if (newExpanded.has(path)) {
			newExpanded.delete(path)
		} else {
			newExpanded.add(path)
		}
		return { expandedFolders: newExpanded }
	}),
	
	setActiveSidePanel: (panel) => set({ activeSidePanel: panel }),
    setActiveDiff: (diff) => set({ activeDiff: diff }),

	// Editor actions
	openFile: (path, content, originalContent) => set((state) => {
		const existing = state.openFiles.find(f => f.path === path)
		if (existing) {
            // Update content/mode if reopening
            const updatedFiles = state.openFiles.map(f => 
                f.path === path ? { ...f, content, originalContent } : f
            )
			return { activeFilePath: path, openFiles: updatedFiles }
		}
		return {
			openFiles: [...state.openFiles, { path, content, isDirty: false, originalContent }],
			activeFilePath: path,
		}
	}),
	closeFile: (path) => set((state) => {
		const newOpenFiles = state.openFiles.filter(f => f.path !== path)
		const newActivePath = state.activeFilePath === path
			? newOpenFiles[newOpenFiles.length - 1]?.path || null
			: state.activeFilePath
		return { openFiles: newOpenFiles, activeFilePath: newActivePath }
	}),
	setActiveFile: (path) => set({ activeFilePath: path }),
	updateFileContent: (path, content) => set((state) => ({
		openFiles: state.openFiles.map(f =>
			f.path === path ? { ...f, content, isDirty: true } : f
		)
	})),
	markFileSaved: (path) => set((state) => ({
		openFiles: state.openFiles.map(f =>
			f.path === path ? { ...f, isDirty: false } : f
		)
	})),

	// Chat actions
	setChatMode: (mode) => set({ chatMode: mode }),
	addMessage: (message) => set((state) => ({
		messages: [...state.messages, {
			...message,
			id: crypto.randomUUID(),
			timestamp: Date.now(),
		}]
	})),
	updateLastMessage: (content) => set((state) => {
		const messages = [...state.messages]
		const lastIndex = messages.length - 1
		if (lastIndex >= 0) {
			messages[lastIndex] = { ...messages[lastIndex], content }
		}
		return { messages }
	}),
    appendTokenToLastMessage: (token) => set((state) => {
        const messages = [...state.messages]
        const lastIndex = messages.length - 1
        if (lastIndex >= 0) {
            const lastMsg = messages[lastIndex]
            if (lastMsg.role === 'assistant' && !lastMsg.toolCallId) {
                messages[lastIndex] = { ...lastMsg, content: lastMsg.content + token }
            }
        }
        return { messages }
    }),
    finalizeLastMessage: () => set((state) => {
        const messages = [...state.messages]
        const lastIndex = messages.length - 1
        if (lastIndex >= 0) {
             // Only update if it's currently streaming to avoid unnecessary updates
             if (messages[lastIndex].isStreaming) {
                 messages[lastIndex] = { ...messages[lastIndex], isStreaming: false }
             }
        }
        return { messages }
    }),
	editMessage: (id, content) => set((state) => ({
		messages: state.messages.map(m => 
			m.id === id ? { ...m, content } : m
		)
	})),
	deleteMessagesAfter: (id) => set((state) => {
		const index = state.messages.findIndex(m => m.id === id)
		if (index === -1) return state
		return { 
			messages: state.messages.slice(0, index + 1),
			currentToolCalls: [] // 清除工具调用
		}
	}),
	setIsStreaming: (streaming) => set({ isStreaming: streaming }),
    startToolCall: (id, name) => set((state) => ({
        currentToolCalls: [...state.currentToolCalls, {
            id,
            name,
            arguments: {},
            argsBuffer: '',
            status: 'running'
        }]
    })),
    appendToolCallArgs: (id, delta) => set((state) => ({
        currentToolCalls: state.currentToolCalls.map(tc => 
            tc.id === id ? { ...tc, argsBuffer: (tc.argsBuffer || '') + delta } : tc
        )
    })),
	clearMessages: () => set({ messages: [], currentToolCalls: [] }),
	addToolCall: (toolCall) => set((state) => ({
		currentToolCalls: [...state.currentToolCalls, { ...toolCall, status: 'running' }]
	})),
	updateToolCall: (id, updates) => set((state) => ({
		currentToolCalls: state.currentToolCalls.map(tc =>
			tc.id === id ? { ...tc, ...updates } : tc
		)
	})),

	// Terminal actions
	addTerminalOutput: (output) => set((state) => ({
		terminalOutput: [...state.terminalOutput, output]
	})),
	clearTerminal: () => set({ terminalOutput: [] }),
	setTerminalVisible: (visible) => set({ terminalVisible: visible }),

	// Settings actions
	setLLMConfig: (config) => set((state) => ({
		llmConfig: { ...state.llmConfig, ...config }
	})),
    setProviderConfig: (providerId, config) => set((state) => {
        const current = state.providerConfigs[providerId] || { enabledModels: [], customModels: [] }
        return {
            providerConfigs: {
                ...state.providerConfigs,
                [providerId]: { ...current, ...config }
            }
        }
    }),
    addCustomModel: (providerId, model) => set((state) => {
        const current = state.providerConfigs[providerId] || { enabledModels: [], customModels: [] }
        if (current.customModels.includes(model)) return {}
        return {
            providerConfigs: {
                ...state.providerConfigs,
                [providerId]: {
                    ...current,
                    customModels: [...current.customModels, model]
                }
            }
        }
    }),
    removeCustomModel: (providerId, model) => set((state) => {
        const current = state.providerConfigs[providerId] || { enabledModels: [], customModels: [] }
        return {
            providerConfigs: {
                ...state.providerConfigs,
                [providerId]: {
                    ...current,
                    customModels: current.customModels.filter(m => m !== model)
                }
            }
        }
    }),
	setShowSettings: (show) => set({ showSettings: show }),
	setLanguage: (lang) => set({ language: lang }),
	setAutoApprove: (settings) => set((state) => ({
		autoApprove: { ...state.autoApprove, ...settings }
	})),

	// Tool approval actions
	setPendingToolCall: (toolCall) => set({ pendingToolCall: toolCall }),
	approveToolCall: () => set((state) => {
		if (state.pendingToolCall) {
			return {
				pendingToolCall: null,
				currentToolCalls: state.currentToolCalls.map(tc =>
					tc.id === state.pendingToolCall?.id
						? { ...tc, status: 'running' as ToolStatus }
						: tc
				)
			}
		}
		return {}
	}),
	rejectToolCall: () => set((state) => {
		if (state.pendingToolCall) {
			return {
				pendingToolCall: null,
				currentToolCalls: state.currentToolCalls.map(tc =>
					tc.id === state.pendingToolCall?.id
						? { ...tc, status: 'rejected' as ToolStatus, error: 'Rejected by user' }
						: tc
				)
			}
		}
		return {}
	}),

	// Checkpoint actions
	addCheckpoint: (checkpoint) => set((state) => ({
		checkpoints: [...state.checkpoints.slice(-49), checkpoint],
		currentCheckpointIdx: state.checkpoints.length,
	})),
	setCurrentCheckpointIdx: (idx) => set({ currentCheckpointIdx: idx }),
	clearCheckpoints: () => set({ checkpoints: [], currentCheckpointIdx: -1 }),

	// Session management
	setCurrentSessionId: (id) => set({ currentSessionId: id }),

    // UI State
    setInputPrompt: (prompt) => set({ inputPrompt: prompt }),
}))
