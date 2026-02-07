/**
 * 共享类型定义
 * 主进程和渲染进程共用的类型
 */

// LLM 相关类型（统一来源）
export * from './llm'

// MCP 相关类型
export * from './mcp'

// Result 类型
export * from './result'

// ==========================================
// 基础类型
// ==========================================

export interface FileItem {
    name: string
    path: string
    isDirectory: boolean
    isRoot?: boolean
    children?: FileItem[]
    lastModified?: number
    size?: number
}

export interface FileSnapshot {
    /** 文件完整路径 */
    path: string
    /** 文件内容，null 表示文件不存在 */
    content: string | null
    /** 快照时间戳 */
    timestamp?: number
}

// ==========================================
// 搜索相关类型
// ==========================================

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

// ==========================================
// 索引相关类型
// ==========================================

export type EmbeddingProviderType = 'jina' | 'voyage' | 'openai' | 'cohere' | 'huggingface' | 'ollama' | 'custom'

export type IndexMode = 'structural' | 'semantic'

export interface EmbeddingConfig {
    provider?: EmbeddingProviderType
    apiKey?: string
    model?: string
    baseUrl?: string
}

export interface IndexStatus {
    mode: IndexMode
    isIndexing: boolean
    totalFiles: number
    indexedFiles: number
    totalChunks: number
    lastIndexedAt?: number
    error?: string
    message?: string
}

export interface SymbolInfo {
    name: string
    kind: string
    filePath: string
    relativePath: string
    startLine: number
    endLine: number
    signature?: string
}

export interface ProjectSummary {
    name: string
    structure: { path: string; description?: string; fileCount: number; mainFiles: string[] }[]
    keyFiles: { relativePath: string; language: string; symbols: SymbolInfo[] }[]
    totalFiles: number
    totalSymbols: number
    languages: Record<string, number>
    generatedAt: number
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

// ==========================================
// LSP 相关类型
// ==========================================

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

export interface LspDiagnostic {
    range: LspRange
    severity?: number
    code?: string | number
    source?: string
    message: string
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
    sortText?: string
    filterText?: string
    preselect?: boolean
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
    kind?: number
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
    kind?: number
    paddingLeft?: boolean
    paddingRight?: boolean
}

export interface LspPrepareRename {
    range: LspRange
    placeholder: string
}
