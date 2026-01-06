/**
 * Electron API 类型定义 - 安全版本
 */

import type {
  McpServerState,
  McpTool,
  McpToolCallRequest,
  McpToolCallResult,
  McpResourceReadRequest,
  McpResourceReadResult,
  McpPromptGetRequest,
  McpPromptGetResult,
  McpServerStatusEvent,
  McpToolsUpdatedEvent,
  McpResourcesUpdatedEvent,
} from '@shared/types/mcp'

// MCP 工具带服务器信息
export interface McpToolWithServer extends McpTool {
  serverId: string
}

export interface FileItem {
  name: string
  path: string
  isDirectory: boolean
  isRoot?: boolean
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

export interface ToolProperty {
  type: string
  description?: string
  enum?: string[]
  items?: ToolProperty
  properties?: Record<string, ToolProperty>
  required?: string[]
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, ToolProperty>
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
  temperature?: number
  topP?: number
  // Thinking 模式配置
  thinkingEnabled?: boolean
  thinkingBudget?: number
  // 适配器配置
  adapterConfig?: import('@/shared/config/providers').LLMAdapterConfig
  // 高级配置
  advanced?: import('@/shared/config/providers').AdvancedConfig
}

// Security Audit Log Entry
export interface AuditLog {
  timestamp: string
  operation: string
  target: string
  success: boolean
  detail?: string
}

// Secure Command Execution Request
export interface SecureCommandRequest {
  command: string
  args?: string[]
  cwd?: string
  timeout?: number
  requireConfirm?: boolean
}

export interface WorkspaceConfig {
  configPath: string | null
  roots: string[]
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

export interface EmbeddingConfigInput {
  provider?: 'jina' | 'voyage' | 'openai' | 'cohere' | 'huggingface' | 'ollama' | 'custom'
  apiKey?: string
  model?: string
  baseUrl?: string
  dimensions?: number
}

// Debug types
export interface DebugConfig {
  type: string  // 'node' | 'python' | 'go' | 'lldb' | etc.
  name: string
  request: 'launch' | 'attach'
  program?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  port?: number
  host?: string
  stopOnEntry?: boolean
  console?: 'internalConsole' | 'integratedTerminal' | 'externalTerminal'
  // 其他配置
  [key: string]: unknown
}

export interface DebugBreakpointInput {
  line: number
  column?: number
  condition?: string
}

export interface DebugBreakpoint {
  id: string
  file: string
  line: number
  column?: number
  condition?: string
  hitCount?: number
  enabled: boolean
}

export interface DebugStackFrame {
  id: number
  name: string
  line: number
  column: number
  /** @deprecated Use source.path instead */
  file?: string
  source?: {
    name?: string
    path?: string
    sourceReference?: number
  }
}

export interface DebugScope {
  name: string
  variablesReference: number
  expensive: boolean
}

export interface DebugVariable {
  name: string
  value: string
  type: string
  variablesReference: number
  children?: DebugVariable[]
}

export type DebuggerState = 'idle' | 'running' | 'paused' | 'stopped'

export interface DebugSessionState {
  id: string
  config: DebugConfig
  state: DebuggerState
}

export type DebugEvent =
  | { type: 'started' }
  | { type: 'stopped'; reason: string; threadId?: number }
  | { type: 'continued'; threadId?: number }
  | { type: 'exited'; exitCode: number }
  | { type: 'terminated' }
  | { type: 'breakpoint'; breakpoint: DebugBreakpoint; reason: 'new' | 'changed' | 'removed' }
  | { type: 'output'; category: 'console' | 'stdout' | 'stderr'; output: string }
  | { type: 'error'; message: string }

export interface ElectronAPI {
  // App lifecycle
  appReady: () => void
  getAppVersion: () => Promise<string>

  // Window controls
  minimize: () => void
  maximize: () => void
  close: () => void
  toggleDevTools: () => void
  newWindow: () => void
  getWindowId: () => Promise<number>
  resizeWindow: (width: number, height: number, minWidth?: number, minHeight?: number) => Promise<void>

  // File operations (安全 - 强制工作区边界)
  openFile: () => Promise<{ path: string; content: string } | null>
  openFolder: () => Promise<string | null>
  selectFolder: () => Promise<string | null>
  openWorkspace: () => Promise<WorkspaceConfig | null>
  addFolderToWorkspace: () => Promise<string | null>
  saveWorkspace: (configPath: string, roots: string[]) => Promise<boolean>
  restoreWorkspace: () => Promise<WorkspaceConfig | null>
  setActiveWorkspace: (roots: string[]) => Promise<boolean | { redirected: true; roots: string[] }>
  getRecentWorkspaces: () => Promise<string[]>
  clearRecentWorkspaces: () => Promise<boolean>
  removeFromRecentWorkspaces: (path: string) => Promise<boolean>
  readDir: (path: string) => Promise<FileItem[]>
  getFileTree: (path: string, maxDepth?: number) => Promise<string>
  readFile: (path: string) => Promise<string | null>
  readBinaryFile: (path: string) => Promise<string | null>
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
  onSettingsChanged: (callback: (event: { key: string; value: any }) => void) => () => void
  getWhitelist: () => Promise<{ shell: string[]; git: string[] }>
  resetWhitelist: () => Promise<{ shell: string[]; git: string[] }>

  // LLM
  sendMessage: (params: LLMSendMessageParams) => Promise<void>
  compactContext: (params: LLMSendMessageParams) => Promise<{ content: string; error?: string }>
  abortMessage: () => void
  invalidateProviders: () => Promise<void>
  invalidateProvider: (providerId: string) => Promise<void>
  onLLMStream: (callback: (chunk: LLMStreamChunk) => void) => () => void
  onLLMToolCall: (callback: (toolCall: LLMToolCall) => void) => () => void
  onLLMError: (callback: (error: LLMError) => void) => () => void
  onLLMDone: (callback: (result: LLMResult) => void) => () => void

  // Interactive Terminal (用户交互终端)
  createTerminal: (options: { id: string; cwd?: string; shell?: string }) => Promise<boolean>
  writeTerminal: (id: string, data: string) => Promise<void>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id?: string) => void
  getAvailableShells: () => Promise<{ label: string; path: string }[]>
  onTerminalData: (callback: (event: { id: string; data: string }) => void) => () => void

  // 后台命令执行（Agent 专用）
  executeBackground: (params: { command: string; cwd?: string; timeout?: number; shell?: string }) => Promise<{
    success: boolean
    output: string
    exitCode: number
    error?: string
  }>
  onShellOutput: (callback: (event: { command: string; type: 'stdout' | 'stderr'; data: string; timestamp: number }) => void) => () => void

  // ✅ Secure Execution - 新的安全命令执行接口
  executeSecureCommand: (request: SecureCommandRequest) => Promise<{
    success: boolean
    output?: string
    errorOutput?: string
    exitCode?: number
    error?: string
  }>

  // ✅ Secure Git - 新的安全 Git 执行
  gitExecSecure: (args: string[], cwd: string) => Promise<{
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
  }>

  // ✅ Security Management - 安全管理接口
  getAuditLogs: (limit?: number) => Promise<AuditLog[]>
  clearAuditLogs: () => Promise<boolean>
  getPermissions: () => Promise<Record<string, string>>
  resetPermissions: () => Promise<boolean>

  onFileChanged: (callback: (event: { event: 'create' | 'update' | 'delete'; path: string }) => void) => () => void

  // Codebase Indexing
  indexInitialize: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
  indexStart: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
  indexStatus: (workspacePath: string) => Promise<IndexStatus>
  indexHasIndex: (workspacePath: string) => Promise<boolean>
  indexSearch: (workspacePath: string, query: string, topK?: number) => Promise<IndexSearchResult[]>
  indexHybridSearch: (workspacePath: string, query: string, topK?: number) => Promise<IndexSearchResult[]>
  indexUpdateFile: (workspacePath: string, filePath: string) => Promise<{ success: boolean; error?: string }>
  indexClear: (workspacePath: string) => Promise<{ success: boolean; error?: string }>
  indexUpdateEmbeddingConfig: (workspacePath: string, config: EmbeddingConfigInput) => Promise<{ success: boolean; error?: string }>
  indexTestConnection: (workspacePath: string) => Promise<{ success: boolean; error?: string; latency?: number }>
  indexGetProviders: () => Promise<EmbeddingProvider[]>
  onIndexProgress: (callback: (status: IndexStatus) => void) => () => void

  // LSP (Language Server Protocol)
  lspStart: (workspacePath: string) => Promise<{ success: boolean }>
  lspStop: () => Promise<{ success: boolean }>
  lspDidOpen: (params: { uri: string; languageId: string; version: number; text: string; workspacePath?: string | null }) => Promise<void>
  lspDidChange: (params: { uri: string; version: number; text: string; workspacePath?: string | null }) => Promise<void>
  lspDidClose: (params: { uri: string; workspacePath?: string | null }) => Promise<void>
  lspDidSave: (params: { uri: string; text?: string; workspacePath?: string | null }) => Promise<void>
  lspDefinition: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspLocation[] | null>
  lspTypeDefinition: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspLocation[] | null>
  lspImplementation: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspLocation[] | null>
  lspReferences: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspLocation[] | null>
  lspHover: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspHover | null>
  lspCompletion: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspCompletionList | null>
  lspCompletionResolve: (item: LspCompletionItem) => Promise<LspCompletionItem>
  lspSignatureHelp: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspSignatureHelp | null>
  lspRename: (params: { uri: string; line: number; character: number; newName: string; workspacePath?: string | null }) => Promise<LspWorkspaceEdit | null>
  lspPrepareRename: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspPrepareRename | null>
  lspDocumentSymbol: (params: { uri: string; workspacePath?: string | null }) => Promise<LspDocumentSymbol[] | null>
  lspWorkspaceSymbol: (params: { query: string }) => Promise<LspSymbolInformation[] | null>
  lspCodeAction: (params: { uri: string; range: LspRange; diagnostics?: LspDiagnostic[]; workspacePath?: string | null }) => Promise<LspCodeAction[] | null>
  lspFormatting: (params: { uri: string; options?: LspFormattingOptions; workspacePath?: string | null }) => Promise<LspTextEdit[] | null>
  lspRangeFormatting: (params: { uri: string; range: LspRange; options?: LspFormattingOptions; workspacePath?: string | null }) => Promise<LspTextEdit[] | null>
  lspDocumentHighlight: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<LspDocumentHighlight[] | null>
  lspFoldingRange: (params: { uri: string; workspacePath?: string | null }) => Promise<LspFoldingRange[] | null>
  lspInlayHint: (params: { uri: string; range: LspRange; workspacePath?: string | null }) => Promise<LspInlayHint[] | null>
  getLspDiagnostics: (filePath: string) => Promise<LspDiagnostic[]>
  onLspDiagnostics: (callback: (params: { uri: string; diagnostics: LspDiagnostic[] }) => void) => () => void
  // 新增 LSP 功能
  lspPrepareCallHierarchy: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any[] | null>
  lspIncomingCalls: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any[] | null>
  lspOutgoingCalls: (params: { uri: string; line: number; character: number; workspacePath?: string | null }) => Promise<any[] | null>
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

  // HTTP (网络请求 - Phase 2)
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
    results?: Array<{
      title: string
      url: string
      snippet: string
    }>
    error?: string
  }>

  // MCP (Model Context Protocol)
  mcpInitialize: (workspaceRoots: string[]) => Promise<{ success: boolean; error?: string }>
  mcpGetServersState: () => Promise<{ success: boolean; servers?: McpServerState[]; error?: string }>
  mcpGetAllTools: () => Promise<{ success: boolean; tools?: McpToolWithServer[]; error?: string }>
  mcpConnectServer: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpDisconnectServer: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpReconnectServer: (serverId: string) => Promise<{ success: boolean; error?: string }>
  mcpCallTool: (request: McpToolCallRequest) => Promise<McpToolCallResult>
  mcpReadResource: (request: McpResourceReadRequest) => Promise<McpResourceReadResult>
  mcpGetPrompt: (request: McpPromptGetRequest) => Promise<McpPromptGetResult>
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
  onMcpServerStatus: (callback: (event: McpServerStatusEvent) => void) => () => void
  onMcpToolsUpdated: (callback: (event: McpToolsUpdatedEvent) => void) => () => void
  onMcpResourcesUpdated: (callback: (event: McpResourcesUpdatedEvent) => void) => () => void
  onMcpStateChanged: (callback: (servers: McpServerState[]) => void) => () => void

  // Command Execution
  onExecuteCommand: (callback: (commandId: string) => void) => () => void

  // Resources API (静态资源读取)
  resourcesReadJson: <T = unknown>(relativePath: string) => Promise<{ success: boolean; data?: T; error?: string }>
  resourcesReadText: (relativePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
  resourcesExists: (relativePath: string) => Promise<boolean>
  resourcesClearCache: (prefix?: string) => Promise<{ success: boolean }>

  // Debug API
  debugCreateSession: (config: DebugConfig) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  debugLaunch: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugAttach: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugStop: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugContinue: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugStepOver: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugStepInto: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugStepOut: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugPause: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  debugSetBreakpoints: (sessionId: string, file: string, breakpoints: DebugBreakpointInput[]) => Promise<{ success: boolean; breakpoints?: DebugBreakpoint[]; error?: string }>
  debugGetStackTrace: (sessionId: string, threadId: number) => Promise<{ success: boolean; frames?: DebugStackFrame[]; error?: string }>
  debugGetScopes: (sessionId: string, frameId: number) => Promise<{ success: boolean; scopes?: DebugScope[]; error?: string }>
  debugGetVariables: (sessionId: string, variablesReference: number) => Promise<{ success: boolean; variables?: DebugVariable[]; error?: string }>
  debugEvaluate: (sessionId: string, expression: string, frameId?: number) => Promise<{ success: boolean; result?: { result: string; type: string }; error?: string }>
  debugGetSessionState: (sessionId: string) => Promise<DebugSessionState | null>
  debugGetAllSessions: () => Promise<DebugSessionState[]>
  onDebugEvent: (callback: (event: { sessionId: string; event: DebugEvent }) => void) => () => void
}
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
  paddingLEFT?: boolean
  paddingRight?: boolean
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export { }
