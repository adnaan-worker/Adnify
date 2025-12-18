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
	isWholeWord?: boolean
	include?: string
	exclude?: string
}

export interface SearchFileResult {
	path: string
	line: number
	text: string
}

// 消息内容类型（支持文本和图片）
export type MessageContentPart =
	| { type: 'text'; text: string }
	| { type: 'image'; source: { type: 'base64' | 'url'; media_type: string; data: string } }

export type MessageContent = string | MessageContentPart[]

export interface LLMMessage {
	role: 'user' | 'assistant' | 'system' | 'tool'
	content: MessageContent
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
	timeout?: number
	maxTokens?: number
}

export interface ElectronAPI {
	// App lifecycle
	appReady: () => void

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
	ensureDir: (path: string) => Promise<boolean>
	saveFile: (content: string, path?: string) => Promise<string | null>
	fileExists: (path: string) => Promise<boolean>
	showItemInFolder: (path: string) => Promise<void>
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

	// LSP (Language Server Protocol)
	lspStart: (workspacePath: string) => Promise<{ success: boolean }>
	lspStop: () => Promise<{ success: boolean }>
	lspDidOpen: (params: { uri: string; languageId: string; version: number; text: string }) => Promise<void>
	lspDidChange: (params: { uri: string; version: number; text: string }) => Promise<void>
	lspDidClose: (params: { uri: string }) => Promise<void>
	lspDefinition: (params: { uri: string; line: number; character: number }) => Promise<LspLocation[] | null>
	lspTypeDefinition: (params: { uri: string; line: number; character: number }) => Promise<LspLocation[] | null>
	lspImplementation: (params: { uri: string; line: number; character: number }) => Promise<LspLocation[] | null>
	lspReferences: (params: { uri: string; line: number; character: number }) => Promise<LspLocation[] | null>
	lspHover: (params: { uri: string; line: number; character: number }) => Promise<LspHover | null>
	lspCompletion: (params: { uri: string; line: number; character: number }) => Promise<LspCompletionList | null>
	lspCompletionResolve: (item: LspCompletionItem) => Promise<LspCompletionItem>
	lspSignatureHelp: (params: { uri: string; line: number; character: number }) => Promise<LspSignatureHelp | null>
	lspRename: (params: { uri: string; line: number; character: number; newName: string }) => Promise<LspWorkspaceEdit | null>
	lspPrepareRename: (params: { uri: string; line: number; character: number }) => Promise<LspPrepareRename | null>
	lspDocumentSymbol: (params: { uri: string }) => Promise<LspDocumentSymbol[] | null>
	lspWorkspaceSymbol: (params: { query: string }) => Promise<LspSymbolInformation[] | null>
	lspCodeAction: (params: { uri: string; range: LspRange; diagnostics?: LspDiagnostic[] }) => Promise<LspCodeAction[] | null>
	lspFormatting: (params: { uri: string; options?: LspFormattingOptions }) => Promise<LspTextEdit[] | null>
	lspRangeFormatting: (params: { uri: string; range: LspRange; options?: LspFormattingOptions }) => Promise<LspTextEdit[] | null>
	lspDocumentHighlight: (params: { uri: string; line: number; character: number }) => Promise<LspDocumentHighlight[] | null>
	lspFoldingRange: (params: { uri: string }) => Promise<LspFoldingRange[] | null>
	lspInlayHint: (params: { uri: string; range: LspRange }) => Promise<LspInlayHint[] | null>
	getLspDiagnostics: (filePath: string) => Promise<LspDiagnostic[]>
	onLspDiagnostics: (callback: (params: { uri: string; diagnostics: LspDiagnostic[] }) => void) => () => void
	
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

// LSP Types
export interface LspPosition {
	line: number
	character: number
}

export interface LspRange {
	start: LspPosition
	end: LspPosition
}

export interface LspLocation {
	uri: string
	range: LspRange
}

export interface LspHover {
	contents: string | { kind: string; value: string } | Array<string | { kind: string; value: string }>
	range?: LspRange
}

export interface LspCompletionItem {
	label: string
	kind?: number
	detail?: string
	documentation?: string | { kind: string; value: string }
	insertText?: string
	insertTextFormat?: number
}

export interface LspCompletionList {
	isIncomplete: boolean
	items: LspCompletionItem[]
}

export interface LspTextEdit {
	range: LspRange
	newText: string
}

export interface LspWorkspaceEdit {
	changes?: { [uri: string]: LspTextEdit[] }
	documentChanges?: Array<{ textDocument: { uri: string; version?: number }; edits: LspTextEdit[] }>
}

export interface LspDiagnostic {
	range: LspRange
	severity?: number
	code?: string | number
	source?: string
	message: string
}

export interface LspSignatureHelp {
	signatures: LspSignatureInformation[]
	activeSignature?: number
	activeParameter?: number
}

export interface LspSignatureInformation {
	label: string
	documentation?: string | { kind: string; value: string }
	parameters?: LspParameterInformation[]
}

export interface LspParameterInformation {
	label: string | [number, number]
	documentation?: string | { kind: string; value: string }
}

export interface LspPrepareRename {
	range: LspRange
	placeholder: string
}

export interface LspDocumentSymbol {
	name: string
	detail?: string
	kind: number
	range: LspRange
	selectionRange: LspRange
	children?: LspDocumentSymbol[]
}

export interface LspSymbolInformation {
	name: string
	kind: number
	location: LspLocation
	containerName?: string
}

export interface LspCodeAction {
	title: string
	kind?: string
	diagnostics?: LspDiagnostic[]
	isPreferred?: boolean
	edit?: LspWorkspaceEdit
	command?: { title: string; command: string; arguments?: unknown[] }
}

export interface LspFormattingOptions {
	tabSize?: number
	insertSpaces?: boolean
}

export interface LspDocumentHighlight {
	range: LspRange
	kind?: number // 1 = Text, 2 = Read, 3 = Write
}

export interface LspFoldingRange {
	startLine: number
	startCharacter?: number
	endLine: number
	endCharacter?: number
	kind?: string
}

export interface LspInlayHint {
	position: LspPosition
	label: string | { value: string; tooltip?: string }[]
	kind?: number // 1 = Type, 2 = Parameter
	paddingLeft?: boolean
	paddingRight?: boolean
}

declare global {
	interface Window {
		electronAPI: ElectronAPI
	}
}

export {}
