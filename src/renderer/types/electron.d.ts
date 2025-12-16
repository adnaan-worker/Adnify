/**
 * Electron API 类型定义
 */

export interface FileItem {
	name: string
	path: string
	isDirectory: boolean
}

export interface LLMStreamChunk {
	type: 'text' | 'tool_call' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'reasoning' | 'error'
	content?: string
	toolCall?: LLMToolCall
    toolCallDelta?: {
        id?: string
        name?: string
        args?: string
    }
	error?: string
}

export interface LLMToolCall {
	id: string
	name: string
	arguments: Record<string, unknown>
}

export interface LLMResult {
	content: string
	reasoning?: string
	toolCalls?: LLMToolCall[]
	usage?: {
		promptTokens: number
		completionTokens: number
		totalTokens: number
	}
}

export interface LLMError {
	message: string
	code: string
	retryable: boolean
}

export interface SearchFilesOptions {
	isRegex: boolean
	isCaseSensitive: boolean
	isWholeWord: boolean
	exclude?: string
}

export interface SearchFileResult {
	path: string
	line: number
	text: string
}

export interface LLMMessage {
	role: 'user' | 'assistant' | 'system' | 'tool'
	content: string
	toolCallId?: string
	toolName?: string
}

export interface ToolDefinition {
	name: string
	description: string
	parameters: {
		type: 'object'
		properties: Record<string, {
			type: string
			description: string
			enum?: string[]
		}>
		required?: string[]
	}
}

export interface LLMSendMessageParams {
	config: LLMConfig
	messages: LLMMessage[]
	tools?: ToolDefinition[]
	systemPrompt?: string
}

export interface LLMConfig {
	provider: string
	model: string
	apiKey: string
	baseUrl?: string
}

export interface ElectronAPI {
	// Window controls
	minimize: () => void
	maximize: () => void
	close: () => void

	// File operations
	openFile: () => Promise<{ path: string; content: string } | null>
	openFolder: () => Promise<string | null>
	showOpenDialog: (options: { properties?: string[]; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string[] | null>
	
	// Git operations (原生 dugite)
	gitExec: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
    restoreWorkspace: () => Promise<string | null>
	readDir: (path: string) => Promise<FileItem[]>
    getFileTree: (path: string, maxDepth?: number) => Promise<string>
	readFile: (path: string) => Promise<string | null>
	writeFile: (path: string, content: string) => Promise<boolean>
	saveFile: (content: string, path?: string) => Promise<string | null>
	fileExists: (path: string) => Promise<boolean>
	mkdir: (path: string) => Promise<boolean>
	deleteFile: (path: string) => Promise<boolean>
	renameFile: (oldPath: string, newPath: string) => Promise<boolean>
	searchFiles: (query: string, rootPath: string, options?: SearchFilesOptions) => Promise<SearchFileResult[]>

	// Settings
	getSetting: (key: string) => Promise<unknown>
	setSetting: (key: string, value: unknown) => Promise<boolean>
    getDataPath: () => Promise<string>
    setDataPath: (path: string) => Promise<boolean>

	// LLM
	sendMessage: (params: LLMSendMessageParams) => Promise<void>
	abortMessage: () => void
	onLLMStream: (callback: (chunk: LLMStreamChunk) => void) => () => void
	onLLMToolCall: (callback: (toolCall: LLMToolCall) => void) => () => void
	onLLMError: (callback: (error: LLMError) => void) => () => void
	onLLMDone: (callback: (result: LLMResult) => void) => () => void

	// Terminal
    createTerminal: (options: { id: string; cwd?: string; shell?: string }) => Promise<boolean>
    writeTerminal: (id: string, data: string) => Promise<void>
    resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
	killTerminal: (id?: string) => void
	getAvailableShells: () => Promise<{ label: string; path: string }[]>
    executeCommand: (command: string, cwd?: string, timeout?: number) => Promise<{ output: string; errorOutput: string; exitCode: number }>
	onTerminalData: (callback: (event: { id: string; data: string }) => void) => () => void

	// File watcher
	onFileChanged: (callback: (event: { event: 'create' | 'update' | 'delete'; path: string }) => void) => () => void

	// Codebase Indexing
	indexInitialize: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
	indexStart: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
	indexStatus: (workspacePath: string) => Promise<IndexStatus>
	indexHasIndex: (workspacePath: string) => Promise<boolean>
	indexSearch: (workspacePath: string, query: string, topK?: number) => Promise<IndexSearchResult[]>
	indexUpdateFile: (workspacePath: string, filePath: string) => Promise<{ success: boolean; error?: string }>
	indexClear: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
	indexUpdateEmbeddingConfig: (workspacePath: string, config: EmbeddingConfigInput) => Promise<{ success: boolean; error?: string }>
	indexTestConnection: (workspacePath: string) => Promise<{ success: boolean; error?: string; latency?: number }>
	indexGetProviders: () => Promise<EmbeddingProvider[]>
	onIndexProgress: (callback: (status: IndexStatus) => void) => () => void
}

// Indexing types
export type EmbeddingProviderType = 'jina' | 'voyage' | 'openai' | 'cohere' | 'huggingface' | 'ollama'

export interface EmbeddingConfigInput {
	provider?: EmbeddingProviderType
	apiKey?: string
	model?: string
	baseUrl?: string
}

export interface IndexStatus {
	isIndexing: boolean
	totalFiles: number
	indexedFiles: number
	totalChunks: number
	lastIndexedAt?: number
	error?: string
}

export interface IndexSearchResult {
	filePath: string
	relativePath: string
	content: string
	startLine: number
	endLine: number
	score: number
	type: string
	language: string
}

export interface EmbeddingProvider {
	id: string
	name: string
	description: string
	free: boolean
}

declare global {
	interface Window {
		electronAPI: ElectronAPI
	}
}

export {}
