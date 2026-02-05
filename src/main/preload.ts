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
  type: 'text' | 'reasoning' | 'error' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_delta_end' | 'tool_call_available'
  content?: string
  error?: string
  id?: string
  name?: string
  arguments?: Record<string, unknown>
  argumentsDelta?: string
}

interface LLMError {
  message: string
  code: string
  retryable: boolean
}

interface LLMResult {
  content: string
  reasoning?: string
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
  activeTools?: string[]
  requestId: string  // 必传，用于 IPC 频道隔离
}

interface EmbeddingConfigInput {
  provider?: 'jina' | 'voyage' | 'openai' | 'cohere' | 'huggingface' | 'ollama' | 'custom'
  apiKey?: string
  model?: string
  baseUrl?: string
  dimensions?: number
}

interface IndexStatusData {
  mode: 'structural' | 'semantic'
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
  getAppVersion: () => Promise<string>

  // Window controls
  minimize: () => void
  maximize: () => void
  close: () => void
  newWindow: () => void
  getWindowId: () => Promise<number>
  resizeWindow: (width: number, height: number, minWidth?: number, minHeight?: number) => Promise<void>

  // File operations
  openFile: () => Promise<{ path: string; content: string } | null>
  openFolder: () => Promise<string | null>
  selectFolder: () => Promise<string | null>
  openWorkspace: () => Promise<{ configPath: string | null; roots: string[] } | null>
  addFolderToWorkspace: () => Promise<string | null>
  saveWorkspace: (configPath: string, roots: string[]) => Promise<boolean>
  restoreWorkspace: () => Promise<{ configPath: string | null; roots: string[] } | null>
  getRecentWorkspaces: () => Promise<string[]>
  clearRecentWorkspaces: () => Promise<boolean>
  removeFromRecentWorkspaces: (path: string) => Promise<boolean>
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
  getConfigPath: () => Promise<string>
  setConfigPath: (path: string) => Promise<boolean>
  onSettingsChanged: (callback: (event: { key: string; value: unknown }) => void) => () => void
  getWhitelist: () => Promise<{ shell: string[]; git: string[] }>
  resetWhitelist: () => Promise<{ shell: string[]; git: string[] }>

  // LLM
  sendMessage: (params: LLMSendMessageParams) => Promise<void>
  compactContext: (params: LLMSendMessageParams) => Promise<{ content?: string; usage?: any; metadata?: any; error?: string; code?: string }>
  abortMessage: () => void
  // Structured Output
  analyzeCode: (params: any) => Promise<any>
  analyzeCodeStream: (params: any) => Promise<any>
  suggestRefactoring: (params: any) => Promise<any>
  suggestFixes: (params: any) => Promise<any>
  generateTests: (params: any) => Promise<any>
  generateObject: (params: { config: any; schema: any; system: string; prompt: string }) => Promise<{ object: any; usage?: any; metadata?: any; error?: string }>
  // Embeddings
  embedText: (params: { text: string; config: any }) => Promise<any>
  embedMany: (params: { texts: string[]; config: any }) => Promise<any>
  findSimilar: (params: { query: string; candidates: string[]; config: any; topK?: number }) => Promise<any>
  onLLMStream: (requestId: string, callback: (data: LLMStreamChunk) => void) => () => void
  onLLMError: (requestId: string, callback: (error: LLMError) => void) => () => void
  onLLMDone: (requestId: string, callback: (data: LLMResult) => void) => () => void

  // Interactive Terminal
  createTerminal: (options: { id: string; cwd?: string; shell?: string }) => Promise<boolean>
  writeTerminal: (id: string, data: string) => Promise<void>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id?: string) => void
  getAvailableShells: () => Promise<{ label: string; path: string }[]>
  onTerminalData: (callback: (event: { id: string; data: string }) => void) => () => void
  onTerminalExit: (callback: (event: { id: string; exitCode: number; signal?: number }) => void) => () => void
  onTerminalError: (callback: (event: { id: string; error: string }) => void) => () => void

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
  clearAuditLogs: () => Promise<boolean>
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
  indexHybridSearch: (workspacePath: string, query: string, topK?: number) => Promise<IndexSearchResult[]>
  indexSearchSymbols: (workspacePath: string, query: string, topK?: number) => Promise<any[]>
  indexGetProjectSummary: (workspacePath: string) => Promise<any>
  indexGetProjectSummaryText: (workspacePath: string) => Promise<string>
  indexSetMode: (workspacePath: string, mode: 'structural' | 'semantic') => Promise<{ success: boolean; error?: string }>
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
  lspDidSave: (params: { uri: string; text?: string; workspacePath?: string | null }) => Promise<void>
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
  // 新增 LSP 功能
  lspPrepareCallHierarchy: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any>
  lspIncomingCalls: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any>
  lspOutgoingCalls: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any>
  lspWaitForDiagnostics: (params: { uri: string }) => Promise<{ success: boolean }>
  lspFindBestRoot: (params: { filePath: string; languageId: string; workspacePath: string }) => Promise<string>
  lspEnsureServerForFile: (params: { filePath: string; languageId: string; workspacePath: string }) => Promise<{ success: boolean; serverName?: string }>
  lspDidChangeWatchedFiles: (params: { changes: Array<{ uri: string; type: number }>; workspacePath?: string | null }) => Promise<void>
  lspGetSupportedLanguages: () => Promise<string[]>
  // LSP 服务器安装管理
  lspGetServerStatus: () => Promise<Record<string, { installed: boolean; path?: string }>>
  lspGetBinDir: () => Promise<string>
  lspGetDefaultBinDir: () => Promise<string>
  lspSetCustomBinDir: (customPath: string | null) => Promise<{ success: boolean }>
  lspInstallServer: (serverType: string) => Promise<{ success: boolean; path?: string; error?: string }>
  lspInstallBasicServers: () => Promise<{ success: boolean; error?: string }>

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
  httpSetGoogleSearch: (apiKey: string, cx: string) => Promise<{ success: boolean }>

  // Health Check
  healthCheckProvider: (provider: string, apiKey: string, baseUrl?: string, timeout?: number) => Promise<{
    provider: string
    status: 'healthy' | 'unhealthy' | 'unknown'
    latency?: number
    error?: string
    checkedAt: Date
  }>
  testModel: (config: LLMConfig) => Promise<{
    success: boolean
    content?: string
    latency?: number
    error?: string
  }>
  fetchModels: (provider: string, apiKey: string, baseUrl?: string, protocol?: string) => Promise<{
    success: boolean
    models?: string[]
    error?: string
  }>

  // MCP (Model Context Protocol)
  mcpInitialize: (workspaceRoots: string[]) => Promise<{ success: boolean; error?: string }>
  mcpGetServersState: () => Promise<{ success: boolean; servers?: any[]; error?: string }>
  mcpGetAllTools: () => Promise<{ success: boolean; tools?: any[]; error?: string }>
  mcpConnectServer: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpDisconnectServer: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpReconnectServer: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpCallTool: (request: { serverId: string; toolName: string; arguments: Record<string, unknown> }) => Promise<{
    success: boolean
    content?: any[]
    error?: string
    isError?: boolean
  }>
  mcpReadResource: (request: { serverId: string; uri: string }) => Promise<{
    success: boolean
    contents?: any[]
    error?: string
  }>
  mcpGetPrompt: (request: { serverId: string; promptName: string; arguments?: Record<string, string> }) => Promise<{
    success: boolean
    description?: string
    messages?: any[]
    error?: string
  }>
  mcpRefreshCapabilities: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpGetConfigPaths: () => Promise<{ success: boolean; paths?: { user: string; workspace: string[] }; error?: string }>
  mcpReloadConfig: () => Promise<{ success: boolean; error?: string }>
  mcpAddServer: (config: {
    id: string
    name: string
    command: string
    args: string[]
    env: Record<string, string>
    autoApprove: string[]
    disabled: boolean
  }) => Promise<{ success: boolean; error?: string }>
  mcpRemoveServer: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpToggleServer: (serverId: string, disabled: boolean) => Promise<{ success: boolean; error?: string }>
  mcpSetAutoConnect: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  onMcpServerStatus: (callback: (event: { serverId: string; status: string; error?: string }) => void) => () => void
  onMcpToolsUpdated: (callback: (event: { serverId: string; tools: any[] }) => void) => () => void
  onMcpResourcesUpdated: (callback: (event: { serverId: string; resources: any[] }) => void) => () => void
  onMcpStateChanged: (callback: (servers: any[]) => void) => () => void

  // Command Execution
  onExecuteCommand: (callback: (commandId: string) => void) => () => void
}

// =================== 暴露 API ===================

contextBridge.exposeInMainWorld('electronAPI', {
  appReady: () => ipcRenderer.send('app:ready'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  toggleDevTools: () => ipcRenderer.send('window:toggleDevTools'),
  newWindow: () => ipcRenderer.invoke('window:new'),
  getWindowId: () => ipcRenderer.invoke('window:getId'),
  resizeWindow: (width: number, height: number, minWidth?: number, minHeight?: number) =>
    ipcRenderer.invoke('window:resize', width, height, minWidth, minHeight),

  openFile: () => ipcRenderer.invoke('file:open'),
  openFolder: () => ipcRenderer.invoke('file:openFolder'),
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  addFolderToWorkspace: () => ipcRenderer.invoke('workspace:addFolder'),
  saveWorkspace: (configPath: string, roots: string[]) => ipcRenderer.invoke('workspace:save', configPath, roots),
  restoreWorkspace: () => ipcRenderer.invoke('workspace:restore'),
  setActiveWorkspace: (roots: string[]) => ipcRenderer.invoke('workspace:setActive', roots),
  getRecentWorkspaces: () => ipcRenderer.invoke('workspace:getRecent'),
  clearRecentWorkspaces: () => ipcRenderer.invoke('workspace:clearRecent'),
  removeFromRecentWorkspaces: (path: string) => ipcRenderer.invoke('workspace:removeFromRecent', path),
  readDir: (path: string) => ipcRenderer.invoke('file:readDir', path),
  getFileTree: (path: string, maxDepth?: number) => ipcRenderer.invoke('file:getTree', path, maxDepth),
  readFile: (path: string) => ipcRenderer.invoke('file:read', path),
  readBinaryFile: (path: string) => ipcRenderer.invoke('file:readBinary', path),
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
  getConfigPath: () => ipcRenderer.invoke('settings:getConfigPath'),
  setConfigPath: (path: string) => ipcRenderer.invoke('settings:setConfigPath', path),
  onSettingsChanged: (callback: (event: { key: string; value: unknown }) => void) => {
    const handler = (_: IpcRendererEvent, event: { key: string; value: unknown }) => callback(event)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  },
  getWhitelist: () => ipcRenderer.invoke('settings:getWhitelist'),
  resetWhitelist: () => ipcRenderer.invoke('settings:resetWhitelist'),
  getUserDataPath: () => ipcRenderer.invoke('settings:getUserDataPath'),
  getRecentLogs: () => ipcRenderer.invoke('settings:getRecentLogs'),

  sendMessage: (params: LLMSendMessageParams) => ipcRenderer.invoke('llm:sendMessage', params),
  compactContext: (params: LLMSendMessageParams) => ipcRenderer.invoke('llm:compactContext', params),
  abortMessage: () => ipcRenderer.send('llm:abort'),
  // Structured Output
  analyzeCode: (params: any) => ipcRenderer.invoke('llm:analyzeCode', params),
  analyzeCodeStream: (params: any) => ipcRenderer.invoke('llm:analyzeCodeStream', params),
  suggestRefactoring: (params: any) => ipcRenderer.invoke('llm:suggestRefactoring', params),
  suggestFixes: (params: any) => ipcRenderer.invoke('llm:suggestFixes', params),
  generateTests: (params: any) => ipcRenderer.invoke('llm:generateTests', params),
  generateObject: (params: { config: any; schema: any; system: string; prompt: string }) => ipcRenderer.invoke('llm:generateObject', params),
  // Embeddings
  embedText: (params: { text: string; config: any }) => ipcRenderer.invoke('llm:embedText', params),
  embedMany: (params: { texts: string[]; config: any }) => ipcRenderer.invoke('llm:embedMany', params),
  findSimilar: (params: { query: string; candidates: string[]; config: any; topK?: number }) => ipcRenderer.invoke('llm:findSimilar', params),
  // LLM 事件订阅（使用动态 IPC 频道实现请求隔离）
  onLLMStream: (requestId: string, callback: (data: LLMStreamChunk) => void) => {
    const channel = `llm:stream:${requestId}`
    const handler = (_: IpcRendererEvent, data: LLMStreamChunk) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  onLLMError: (requestId: string, callback: (error: LLMError) => void) => {
    const channel = `llm:error:${requestId}`
    const handler = (_: IpcRendererEvent, error: LLMError) => callback(error)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  onLLMDone: (requestId: string, callback: (data: LLMResult) => void) => {
    const channel = `llm:done:${requestId}`
    const handler = (_: IpcRendererEvent, data: LLMResult) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  createTerminal: (options: { id: string; cwd?: string; shell?: string }) =>
    ipcRenderer.invoke('terminal:interactive', options),
  writeTerminal: (id: string, data: string) => ipcRenderer.invoke('terminal:input', { id, data }),
  executeBackground: (params: { command: string; cwd?: string; timeout?: number; shell?: string }) =>
    ipcRenderer.invoke('shell:executeBackground', params),
  onShellOutput: (callback: (event: { command: string; type: 'stdout' | 'stderr'; data: string; timestamp: number }) => void) => {
    const handler = (_: IpcRendererEvent, event: { command: string; type: 'stdout' | 'stderr'; data: string; timestamp: number }) => callback(event)
    ipcRenderer.on('shell:output', handler)
    return () => ipcRenderer.removeListener('shell:output', handler)
  },
  resizeTerminal: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
  killTerminal: (id?: string) => ipcRenderer.send('terminal:kill', id),
  getAvailableShells: () => ipcRenderer.invoke('shell:getAvailableShells'),
  onTerminalData: (callback: (event: { id: string; data: string }) => void) => {
    const handler = (_: IpcRendererEvent, event: { id: string; data: string }) => callback(event)
    ipcRenderer.on('terminal:data', handler)
    return () => ipcRenderer.removeListener('terminal:data', handler)
  },
  onTerminalExit: (callback: (event: { id: string; exitCode: number; signal?: number }) => void) => {
    const handler = (_: IpcRendererEvent, event: { id: string; exitCode: number; signal?: number }) => callback(event)
    ipcRenderer.on('terminal:exit', handler)
    return () => ipcRenderer.removeListener('terminal:exit', handler)
  },
  onTerminalError: (callback: (event: { id: string; error: string }) => void) => {
    const handler = (_: IpcRendererEvent, event: { id: string; error: string }) => callback(event)
    ipcRenderer.on('terminal:error', handler)
    return () => ipcRenderer.removeListener('terminal:error', handler)
  },

  executeSecureCommand: (request: { command: string; args?: string[]; cwd?: string; timeout?: number; requireConfirm?: boolean }) =>
    ipcRenderer.invoke('shell:executeSecure', request),

  gitExecSecure: (args: string[], cwd: string) => ipcRenderer.invoke('git:execSecure', args, cwd),

  getAuditLogs: (limit = 100) => ipcRenderer.invoke('security:getAuditLogs', limit),
  clearAuditLogs: () => ipcRenderer.invoke('security:clearAuditLogs'),
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
  indexHybridSearch: (workspacePath: string, query: string, topK?: number) => ipcRenderer.invoke('index:hybridSearch', workspacePath, query, topK),
  indexSearchSymbols: (workspacePath: string, query: string, topK?: number) => ipcRenderer.invoke('index:searchSymbols', workspacePath, query, topK),
  indexGetProjectSummary: (workspacePath: string) => ipcRenderer.invoke('index:getProjectSummary', workspacePath),
  indexGetProjectSummaryText: (workspacePath: string) => ipcRenderer.invoke('index:getProjectSummaryText', workspacePath),
  indexSetMode: (workspacePath: string, mode: 'structural' | 'semantic') => ipcRenderer.invoke('index:setMode', workspacePath, mode),
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
  lspDidSave: (params: any) => ipcRenderer.invoke('lsp:didSave', params),
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
  // 新增 LSP 功能
  lspPrepareCallHierarchy: (params: any) => ipcRenderer.invoke('lsp:prepareCallHierarchy', params),
  lspIncomingCalls: (params: any) => ipcRenderer.invoke('lsp:incomingCalls', params),
  lspOutgoingCalls: (params: any) => ipcRenderer.invoke('lsp:outgoingCalls', params),
  lspWaitForDiagnostics: (params: any) => ipcRenderer.invoke('lsp:waitForDiagnostics', params),
  lspFindBestRoot: (params: any) => ipcRenderer.invoke('lsp:findBestRoot', params),
  lspEnsureServerForFile: (params: any) => ipcRenderer.invoke('lsp:ensureServerForFile', params),
  lspDidChangeWatchedFiles: (params: any) => ipcRenderer.invoke('lsp:didChangeWatchedFiles', params),
  lspGetSupportedLanguages: () => ipcRenderer.invoke('lsp:getSupportedLanguages'),
  // LSP 服务器安装管理
  lspGetServerStatus: () => ipcRenderer.invoke('lsp:getServerStatus'),
  lspGetBinDir: () => ipcRenderer.invoke('lsp:getBinDir'),
  lspGetDefaultBinDir: () => ipcRenderer.invoke('lsp:getDefaultBinDir'),
  lspSetCustomBinDir: (customPath: string | null) => ipcRenderer.invoke('lsp:setCustomBinDir', customPath),
  lspInstallServer: (serverType: string) => ipcRenderer.invoke('lsp:installServer', serverType),
  lspInstallBasicServers: () => ipcRenderer.invoke('lsp:installBasicServers'),

  // HTTP API
  httpReadUrl: (url: string, timeout?: number) => ipcRenderer.invoke('http:readUrl', url, timeout),
  httpWebSearch: (query: string, maxResults?: number) => ipcRenderer.invoke('http:webSearch', query, maxResults),
  httpSetGoogleSearch: (apiKey: string, cx: string) => ipcRenderer.invoke('http:setGoogleSearch', apiKey, cx),

  // Health Check API
  healthCheckProvider: (provider: string, apiKey: string, baseUrl?: string, timeout?: number) =>
    ipcRenderer.invoke('healthCheck:check', provider, apiKey, baseUrl, timeout),
  testModel: (config: LLMConfig) =>
    ipcRenderer.invoke('healthCheck:testModel', config),
  fetchModels: (provider: string, apiKey: string, baseUrl?: string, protocol?: string) =>
    ipcRenderer.invoke('healthCheck:fetchModels', provider, apiKey, baseUrl, protocol),

  // MCP API
  mcpInitialize: (workspaceRoots: string[]) => ipcRenderer.invoke('mcp:initialize', workspaceRoots),
  mcpGetServersState: () => ipcRenderer.invoke('mcp:getServersState'),
  mcpGetAllTools: () => ipcRenderer.invoke('mcp:getAllTools'),
  mcpConnectServer: (serverId: string) => ipcRenderer.invoke('mcp:connectServer', serverId),
  mcpDisconnectServer: (serverId: string) => ipcRenderer.invoke('mcp:disconnectServer', serverId),
  mcpReconnectServer: (serverId: string) => ipcRenderer.invoke('mcp:reconnectServer', serverId),
  mcpCallTool: (request: { serverId: string; toolName: string; arguments: Record<string, unknown> }) =>
    ipcRenderer.invoke('mcp:callTool', request),
  mcpReadResource: (request: { serverId: string; uri: string }) =>
    ipcRenderer.invoke('mcp:readResource', request),
  mcpGetPrompt: (request: { serverId: string; promptName: string; arguments?: Record<string, string> }) =>
    ipcRenderer.invoke('mcp:getPrompt', request),
  mcpRefreshCapabilities: (serverId: string) => ipcRenderer.invoke('mcp:refreshCapabilities', serverId),
  mcpGetConfigPaths: () => ipcRenderer.invoke('mcp:getConfigPaths'),
  mcpReloadConfig: () => ipcRenderer.invoke('mcp:reloadConfig'),
  mcpAddServer: (config: {
    type?: 'local' | 'remote'
    id: string
    name: string
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
    oauth?: { clientId?: string; clientSecret?: string; scope?: string } | false
    autoApprove?: string[]
    disabled?: boolean
  }) => ipcRenderer.invoke('mcp:addServer', config),
  mcpRemoveServer: (serverId: string) => ipcRenderer.invoke('mcp:removeServer', serverId),
  mcpToggleServer: (serverId: string, disabled: boolean) => ipcRenderer.invoke('mcp:toggleServer', serverId, disabled),
  mcpSetAutoConnect: (enabled: boolean) => ipcRenderer.invoke('mcp:setAutoConnect', enabled),
  // OAuth 相关
  mcpStartOAuth: (serverId: string) => ipcRenderer.invoke('mcp:startOAuth', serverId),
  mcpFinishOAuth: (serverId: string, authorizationCode: string) => ipcRenderer.invoke('mcp:finishOAuth', serverId, authorizationCode),
  mcpRefreshOAuthToken: (serverId: string) => ipcRenderer.invoke('mcp:refreshOAuthToken', serverId),
  onMcpServerStatus: (callback: (event: { serverId: string; status: string; error?: string; authUrl?: string }) => void) => {
    const handler = (_: IpcRendererEvent, event: { serverId: string; status: string; error?: string; authUrl?: string }) => callback(event)
    ipcRenderer.on('mcp:serverStatus', handler)
    return () => ipcRenderer.removeListener('mcp:serverStatus', handler)
  },
  onMcpToolsUpdated: (callback: (event: { serverId: string; tools: any[] }) => void) => {
    const handler = (_: IpcRendererEvent, event: { serverId: string; tools: any[] }) => callback(event)
    ipcRenderer.on('mcp:toolsUpdated', handler)
    return () => ipcRenderer.removeListener('mcp:toolsUpdated', handler)
  },
  onMcpResourcesUpdated: (callback: (event: { serverId: string; resources: any[] }) => void) => {
    const handler = (_: IpcRendererEvent, event: { serverId: string; resources: any[] }) => callback(event)
    ipcRenderer.on('mcp:resourcesUpdated', handler)
    return () => ipcRenderer.removeListener('mcp:resourcesUpdated', handler)
  },
  onMcpStateChanged: (callback: (servers: any[]) => void) => {
    const handler = (_: IpcRendererEvent, servers: any[]) => callback(servers)
    ipcRenderer.on('mcp:stateChanged', handler)
    return () => ipcRenderer.removeListener('mcp:stateChanged', handler)
  },

  // Command Execution
  onExecuteCommand: (callback: (commandId: string) => void) => {
    const handler = (_: IpcRendererEvent, commandId: string) => callback(commandId)
    ipcRenderer.on('workbench:execute-command', handler)
    return () => ipcRenderer.removeListener('workbench:execute-command', handler)
  },

  // Resources API (静态资源读取)
  resourcesReadJson: (relativePath: string) => ipcRenderer.invoke('resources:readJson', relativePath),
  resourcesReadText: (relativePath: string) => ipcRenderer.invoke('resources:readText', relativePath),
  resourcesExists: (relativePath: string) => ipcRenderer.invoke('resources:exists', relativePath),
  resourcesClearCache: (prefix?: string) => ipcRenderer.invoke('resources:clearCache', prefix),

  // Debug API
  debugCreateSession: (config: any) => ipcRenderer.invoke('debug:createSession', config),
  debugLaunch: (sessionId: string) => ipcRenderer.invoke('debug:launch', sessionId),
  debugAttach: (sessionId: string) => ipcRenderer.invoke('debug:attach', sessionId),
  debugStop: (sessionId: string) => ipcRenderer.invoke('debug:stop', sessionId),
  debugContinue: (sessionId: string) => ipcRenderer.invoke('debug:continue', sessionId),
  debugStepOver: (sessionId: string) => ipcRenderer.invoke('debug:stepOver', sessionId),
  debugStepInto: (sessionId: string) => ipcRenderer.invoke('debug:stepInto', sessionId),
  debugStepOut: (sessionId: string) => ipcRenderer.invoke('debug:stepOut', sessionId),
  debugPause: (sessionId: string) => ipcRenderer.invoke('debug:pause', sessionId),
  debugSetBreakpoints: (sessionId: string, file: string, breakpoints: any[]) =>
    ipcRenderer.invoke('debug:setBreakpoints', sessionId, file, breakpoints),
  debugGetStackTrace: (sessionId: string, threadId: number) =>
    ipcRenderer.invoke('debug:getStackTrace', sessionId, threadId),
  debugGetScopes: (sessionId: string, frameId: number) =>
    ipcRenderer.invoke('debug:getScopes', sessionId, frameId),
  debugGetVariables: (sessionId: string, variablesReference: number) =>
    ipcRenderer.invoke('debug:getVariables', sessionId, variablesReference),
  debugEvaluate: (sessionId: string, expression: string, frameId?: number) =>
    ipcRenderer.invoke('debug:evaluate', sessionId, expression, frameId),
  debugGetSessionState: (sessionId: string) => ipcRenderer.invoke('debug:getSessionState', sessionId),
  debugGetAllSessions: () => ipcRenderer.invoke('debug:getAllSessions'),
  onDebugEvent: (callback: (event: { sessionId: string; event: any }) => void) => {
    const handler = (_: IpcRendererEvent, data: { sessionId: string; event: any }) => callback(data)
    ipcRenderer.on('debug:event', handler)
    return () => ipcRenderer.removeListener('debug:event', handler)
  },

  // Updater API
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterGetStatus: () => ipcRenderer.invoke('updater:getStatus'),
  updaterDownload: () => ipcRenderer.invoke('updater:download'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  updaterOpenDownloadPage: (url?: string) => ipcRenderer.invoke('updater:openDownloadPage', url),
  onUpdaterStatus: (callback: (status: any) => void) => {
    const handler = (_: IpcRendererEvent, status: any) => callback(status)
    ipcRenderer.on('updater:status', handler)
    return () => ipcRenderer.removeListener('updater:status', handler)
  },

  // App Error (from main process)
  onAppError: (callback: (error: { title: string; message: string; variant?: string }) => void) => {
    const handler = (_: IpcRendererEvent, error: { title: string; message: string; variant?: string }) => callback(error)
    ipcRenderer.on('app:error', handler)
    return () => ipcRenderer.removeListener('app:error', handler)
  },
})
