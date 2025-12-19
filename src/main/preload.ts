/**
 * 安全的 Preload Script
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

// =================== 类型定义 ===================

interface SearchFilesOptions {
  isRegex: boolean
  isCaseSensitive: boolean
  isWholeWord?: boolean
  include?: string
  exclude?: string
}

interface SearchFileResult {
  path: string
  line: number
  text: string
}

interface LLMStreamChunk {
  type: 'text' | 'reasoning' | 'error'
  content?: string
  error?: string
}

interface LLMToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

interface LLMError {
  message: string
  code: string
  retryable: boolean
}

interface LLMResult {
  content: string
  reasoning?: string
  toolCalls?: LLMToolCall[]
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64' | 'url'; media_type: string; data: string } }

type MessageContent = string | MessageContentPart[]

interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: MessageContent
  toolCallId?: string
  toolName?: string
}

interface ToolDefinition {
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

interface LLMConfig {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
}

interface LLMSendMessageParams {
  config: LLMConfig
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  systemPrompt?: string
}

interface EmbeddingConfigInput {
  provider?: 'jina' | 'voyage' | 'openai' | 'cohere' | 'huggingface' | 'ollama'
  apiKey?: string
  model?: string
  baseUrl?: string
}

interface IndexStatusData {
  isIndexing: boolean
  totalFiles: number
  indexedFiles: number
  totalChunks: number
  lastIndexedAt?: number
  error?: string
}

interface IndexSearchResult {
  filePath: string
  relativePath: string
  content: string
  startLine: number
  endLine: number
  score: number
  type: string
  language: string
}

interface EmbeddingProvider {
  id: string
  name: string
  description: string
  free: boolean
}

export interface ElectronAPI {
  // App lifecycle
  appReady: () => void

  // Window controls
  minimize: () => void
  maximize: () => void
  close: () => void
  newWindow: () => void

  // File operations
  openFile: () => Promise<{ path: string; content: string } | null>
  openFolder: () => Promise<string | null>
  openWorkspace: () => Promise<{ configPath: string | null; roots: string[] } | null>
  addFolderToWorkspace: () => Promise<string | null>
  saveWorkspace: (configPath: string, roots: string[]) => Promise<boolean>
  restoreWorkspace: () => Promise<{ configPath: string | null; roots: string[] } | null>
  readDir: (path: string) => Promise<{ name: string; path: string; isDirectory: boolean }[]>
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
  searchFiles: (query: string, rootPath: string | string[], options?: SearchFilesOptions) => Promise<SearchFileResult[]>

  // Settings
  getSetting: (key: string) => Promise<unknown>
  setSetting: (key: string, value: unknown) => Promise<boolean>
  getDataPath: () => Promise<string>
  setDataPath: (path: string) => Promise<boolean>
  onSettingsChanged: (callback: (event: { key: string; value: unknown }) => void) => () => void
  getWhitelist: () => Promise<{ shell: string[]; git: string[] }>
  resetWhitelist: () => Promise<{ shell: string[]; git: string[] }>

  // LLM
  sendMessage: (params: LLMSendMessageParams) => Promise<void>
  abortMessage: () => void
  onLLMStream: (callback: (data: LLMStreamChunk) => void) => () => void
  onLLMToolCall: (callback: (toolCall: LLMToolCall) => void) => () => void
  onLLMError: (callback: (error: LLMError) => void) => () => void
  onLLMDone: (callback: (data: LLMResult) => void) => () => void

  // Interactive Terminal
  createTerminal: (options: { id: string; cwd?: string; shell?: string }) => Promise<boolean>
  writeTerminal: (id: string, data: string) => Promise<void>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id?: string) => void
  getAvailableShells: () => Promise<{ label: string; path: string }[]>
  onTerminalData: (callback: (event: { id: string; data: string }) => void) => () => void

  // Secure Shell Execution
  executeSecureCommand: (request: {
    command: string
    args?: string[]
    cwd?: string
    timeout?: number
    requireConfirm?: boolean
  }) => Promise<{
    success: boolean
    output?: string
    errorOutput?: string
    exitCode?: number
    error?: string
  }>

  // Secure Git Execution
  gitExecSecure: (args: string[], cwd: string) => Promise<{
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
  }>

  // Security Management
  getAuditLogs: (limit?: number) => Promise<any[]>
  getPermissions: () => Promise<Record<string, string>>
  resetPermissions: () => Promise<boolean>

  // File watcher
  onFileChanged: (callback: (event: { event: 'create' | 'update' | 'delete'; path: string }) => void) => () => void

  // Codebase Indexing
  indexInitialize: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
  indexStart: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
  indexStatus: (workspacePath: string) => Promise<IndexStatusData>
  indexHasIndex: (workspacePath: string) => Promise<boolean>
  indexSearch: (workspacePath: string, query: string, topK?: number) => Promise<IndexSearchResult[]>
  indexUpdateFile: (workspacePath: string, filePath: string) => Promise<{ success: boolean; error?: string }>
  indexClear: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
  indexUpdateEmbeddingConfig: (workspacePath: string, config: EmbeddingConfigInput) => Promise<{ success: boolean; error?: string }>
  indexTestConnection: (workspacePath: string) => Promise<{ success: boolean; error?: string; latency?: number }>
  indexGetProviders: () => Promise<EmbeddingProvider[]>
  onIndexProgress: (callback: (status: IndexStatusData) => void) => () => void

  // LSP
  lspStart: (workspacePath: string) => Promise<{ success: boolean }>
  lspStop: () => Promise<{ success: boolean }>
  lspDidOpen: (params: { uri: string; languageId: string; version: number; text: string; workspacePath?: string | null }) => Promise<void>
  lspDidChange: (params: { uri: string; version: number; text: string; workspacePath?: string | null }) => Promise<void>
  lspDidClose: (params: { uri: string; workspacePath?: string | null }) => Promise<void>
  lspDefinition: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any>
  lspTypeDefinition: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any>
  lspImplementation: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any>
  lspReferences: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any>
  lspHover: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any>
  lspCompletion: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any>
  lspCompletionResolve: (item: any) => Promise<any>
  lspSignatureHelp: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any>
  lspRename: (params: { uri: string; line: number; character: number; newName: string; workspacePath?: string | null }) => Promise<any>
  lspPrepareRename: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any>
  lspDocumentSymbol: (params: { uri: string; workspacePath?: string | null }) => Promise<any>
  lspWorkspaceSymbol: (params: { query: string }) => Promise<any>
  lspCodeAction: (params: { uri: string; range: any; diagnostics?: any[]; workspacePath?: string | null }) => Promise<any>
  lspFormatting: (params: { uri: string; options?: any; workspacePath?: string | null }) => Promise<any>
  lspRangeFormatting: (params: { uri: string; range: any; options?: any; workspacePath?: string | null }) => Promise<any>
  lspDocumentHighlight: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any>
  lspFoldingRange: (params: { uri: string; workspacePath?: string | null }) => Promise<any>
  lspInlayHint: (params: { uri: string; range: any; workspacePath?: string | null }) => Promise<any>
  getLspDiagnostics: (filePath: string) => Promise<any[]>
  onLspDiagnostics: (callback: (params: { uri: string; diagnostics: any[] }) => void) => () => void

  // HTTP (网络请求)
  httpReadUrl: (url: string, timeout?: number) => Promise<{
    success: boolean
    content?: string
    title?: string
    error?: string
    contentType?: string
    statusCode?: number
  }>
  httpWebSearch: (query: string, maxResults?: number) => Promise<{
    success: boolean
    results?: { title: string; url: string; snippet: string }[]
    error?: string
  }>
}

// =================== 暴露 API ===================

contextBridge.exposeInMainWorld('electronAPI', {
  appReady: () => ipcRenderer.send('app:ready'),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  newWindow: () => ipcRenderer.invoke('window:new'),

  openFile: () => ipcRenderer.invoke('file:open'),
  openFolder: () => ipcRenderer.invoke('file:openFolder'),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  addFolderToWorkspace: () => ipcRenderer.invoke('workspace:addFolder'),
  saveWorkspace: (configPath: string, roots: string[]) => ipcRenderer.invoke('workspace:save', configPath, roots),
  restoreWorkspace: () => ipcRenderer.invoke('workspace:restore'),
  readDir: (path: string) => ipcRenderer.invoke('file:readDir', path),
  getFileTree: (path: string, maxDepth?: number) => ipcRenderer.invoke('file:getTree', path, maxDepth),
  readFile: (path: string) => ipcRenderer.invoke('file:read', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('file:write', path, content),
  ensureDir: (path: string) => ipcRenderer.invoke('file:ensureDir', path),
  saveFile: (content: string, path?: string) => ipcRenderer.invoke('file:save', content, path),
  fileExists: (path: string) => ipcRenderer.invoke('file:exists', path),
  showItemInFolder: (path: string) => ipcRenderer.invoke('file:showInFolder', path),
  mkdir: (path: string) => ipcRenderer.invoke('file:mkdir', path),
  deleteFile: (path: string) => ipcRenderer.invoke('file:delete', path),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('file:rename', oldPath, newPath),
  searchFiles: (query: string, rootPath: string | string[], options?: SearchFilesOptions) =>
    ipcRenderer.invoke('file:search', query, rootPath, options),

  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  getDataPath: () => ipcRenderer.invoke('settings:getDataPath'),
  setDataPath: (path: string) => ipcRenderer.invoke('settings:setDataPath', path),
  onSettingsChanged: (callback: (event: { key: string; value: unknown }) => void) => {
    const handler = (_: IpcRendererEvent, event: { key: string; value: unknown }) => callback(event)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  },
  getWhitelist: () => ipcRenderer.invoke('settings:getWhitelist'),
  resetWhitelist: () => ipcRenderer.invoke('settings:resetWhitelist'),

  sendMessage: (params: LLMSendMessageParams) => ipcRenderer.invoke('llm:sendMessage', params),
  abortMessage: () => ipcRenderer.send('llm:abort'),
  onLLMStream: (callback: (data: LLMStreamChunk) => void) => {
    const handler = (_: IpcRendererEvent, data: LLMStreamChunk) => callback(data)
    ipcRenderer.on('llm:stream', handler)
    return () => ipcRenderer.removeListener('llm:stream', handler)
  },
  onLLMToolCall: (callback: (toolCall: LLMToolCall) => void) => {
    const handler = (_: IpcRendererEvent, toolCall: LLMToolCall) => callback(toolCall)
    ipcRenderer.on('llm:toolCall', handler)
    return () => ipcRenderer.removeListener('llm:toolCall', handler)
  },
  onLLMError: (callback: (error: LLMError) => void) => {
    const handler = (_: IpcRendererEvent, error: LLMError) => callback(error)
    ipcRenderer.on('llm:error', handler)
    return () => ipcRenderer.removeListener('llm:error', handler)
  },
  onLLMDone: (callback: (data: LLMResult) => void) => {
    const handler = (_: IpcRendererEvent, data: LLMResult) => callback(data)
    ipcRenderer.on('llm:done', handler)
    return () => ipcRenderer.removeListener('llm:done', handler)
  },

  createTerminal: (options: { id: string; cwd?: string; shell?: string }) =>
    ipcRenderer.invoke('terminal:interactive', options),
  writeTerminal: (id: string, data: string) => ipcRenderer.invoke('terminal:input', { id, data }),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
  killTerminal: (id?: string) => ipcRenderer.send('terminal:kill', id),
  getAvailableShells: () => ipcRenderer.invoke('shell:getAvailableShells'),
  onTerminalData: (callback: (event: { id: string; data: string }) => void) => {
    const handler = (_: IpcRendererEvent, event: { id: string; data: string }) => callback(event)
    ipcRenderer.on('terminal:data', handler)
    return () => ipcRenderer.removeListener('terminal:data', handler)
  },

  executeSecureCommand: (request: { command: string; args?: string[]; cwd?: string; timeout?: number; requireConfirm?: boolean }) =>
    ipcRenderer.invoke('shell:executeSecure', request),

  gitExecSecure: (args: string[], cwd: string) => ipcRenderer.invoke('git:execSecure', args, cwd),

  getAuditLogs: (limit = 100) => ipcRenderer.invoke('security:getAuditLogs', limit),
  getPermissions: () => ipcRenderer.invoke('security:getPermissions'),
  resetPermissions: () => ipcRenderer.invoke('security:resetPermissions'),

  onFileChanged: (callback: (event: { event: 'create' | 'update' | 'delete'; path: string }) => void) => {
    const handler = (_: IpcRendererEvent, data: { event: 'create' | 'update' | 'delete'; path: string }) => callback(data)
    ipcRenderer.on('file:changed', handler)
    return () => ipcRenderer.removeListener('file:changed', handler)
  },

  indexInitialize: (workspacePath: string) => ipcRenderer.invoke('index:initialize', workspacePath),
  indexStart: (workspacePath: string) => ipcRenderer.invoke('index:start', workspacePath),
  indexStatus: (workspacePath: string) => ipcRenderer.invoke('index:status', workspacePath),
  indexHasIndex: (workspacePath: string) => ipcRenderer.invoke('index:hasIndex', workspacePath),
  indexSearch: (workspacePath: string, query: string, topK?: number) => ipcRenderer.invoke('index:search', workspacePath, query, topK),
  indexUpdateFile: (workspacePath: string, filePath: string) => ipcRenderer.invoke('index:updateFile', workspacePath, filePath),
  indexClear: (workspacePath: string) => ipcRenderer.invoke('index:clear', workspacePath),
  indexUpdateEmbeddingConfig: (workspacePath: string, config: EmbeddingConfigInput) => ipcRenderer.invoke('index:updateEmbeddingConfig', workspacePath, config),
  indexTestConnection: (workspacePath: string) => ipcRenderer.invoke('index:testConnection', workspacePath),
  indexGetProviders: () => ipcRenderer.invoke('index:getProviders'),
  onIndexProgress: (callback: (status: IndexStatusData) => void) => {
    const handler = (_: IpcRendererEvent, status: IndexStatusData) => callback(status)
    ipcRenderer.on('index:progress', handler)
    return () => ipcRenderer.removeListener('index:progress', handler)
  },

  lspStart: (workspacePath: string) => ipcRenderer.invoke('lsp:start', workspacePath),
  lspStop: () => ipcRenderer.invoke('lsp:stop'),
  lspDidOpen: (params: any) => ipcRenderer.invoke('lsp:didOpen', params),
  lspDidChange: (params: any) => ipcRenderer.invoke('lsp:didChange', params),
  lspDidClose: (params: any) => ipcRenderer.invoke('lsp:didClose', params),
  lspDefinition: (params: any) => ipcRenderer.invoke('lsp:definition', params),
  lspTypeDefinition: (params: any) => ipcRenderer.invoke('lsp:typeDefinition', params),
  lspImplementation: (params: any) => ipcRenderer.invoke('lsp:implementation', params),
  lspReferences: (params: any) => ipcRenderer.invoke('lsp:references', params),
  lspHover: (params: any) => ipcRenderer.invoke('lsp:hover', params),
  lspCompletion: (params: any) => ipcRenderer.invoke('lsp:completion', params),
  lspCompletionResolve: (item: any) => ipcRenderer.invoke('lsp:completionResolve', item),
  lspSignatureHelp: (params: any) => ipcRenderer.invoke('lsp:signatureHelp', params),
  lspRename: (params: any) => ipcRenderer.invoke('lsp:rename', params),
  lspPrepareRename: (params: any) => ipcRenderer.invoke('lsp:prepareRename', params),
  lspDocumentSymbol: (params: any) => ipcRenderer.invoke('lsp:documentSymbol', params),
  lspWorkspaceSymbol: (params: any) => ipcRenderer.invoke('lsp:workspaceSymbol', params),
  lspCodeAction: (params: any) => ipcRenderer.invoke('lsp:codeAction', params),
  lspFormatting: (params: any) => ipcRenderer.invoke('lsp:formatting', params),
  lspRangeFormatting: (params: any) => ipcRenderer.invoke('lsp:rangeFormatting', params),
  lspDocumentHighlight: (params: any) => ipcRenderer.invoke('lsp:documentHighlight', params),
  lspFoldingRange: (params: any) => ipcRenderer.invoke('lsp:foldingRange', params),
  lspInlayHint: (params: any) => ipcRenderer.invoke('lsp:inlayHint', params),
  getLspDiagnostics: (filePath: string) => ipcRenderer.invoke('lsp:getDiagnostics', filePath),
  onLspDiagnostics: (callback: (params: { uri: string; diagnostics: any[] }) => void) => {
    const handler = (_: IpcRendererEvent, params: { uri: string; diagnostics: any[] }) => callback(params)
    ipcRenderer.on('lsp:diagnostics', handler)
    return () => ipcRenderer.removeListener('lsp:diagnostics', handler)
  },

  // HTTP API
  httpReadUrl: (url: string, timeout?: number) => ipcRenderer.invoke('http:readUrl', url, timeout),
  httpWebSearch: (query: string, maxResults?: number) => ipcRenderer.invoke('http:webSearch', query, maxResults),
})
