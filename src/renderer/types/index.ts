/**
 * 渲染进程类型定义
 * 统一导出所有类型
 */

// 从共享类型导入
export type {
  FileItem,
  FileSnapshot,
  MessageContent,
  MessageContentPart,
  TextContent,
  ImageContent,
  LLMMessage,
  LLMStreamChunk,
  LLMToolCall,
  LLMResult,
  LLMConfig,
  LLMSendMessageParams,
  ToolDefinition,
  ToolStatus,
  ToolApprovalType,
  ToolResultType,
  ToolCall,
  ToolExecutionResult,
  SearchFilesOptions,
  SearchFileResult,
  EmbeddingProviderType,
  EmbeddingConfig,
  IndexStatus,
  IndexSearchResult,
  EmbeddingProvider,
  LspPosition,
  LspRange,
  LspLocation,
  LspDiagnostic,
  LspHover,
  LspCompletionItem,
  LspCompletionList,
  LspTextEdit,
  LspWorkspaceEdit,
  LspSignatureHelp,
  LspDocumentSymbol,
  LspSymbolInformation,
  LspCodeAction,
  LspFormattingOptions,
  LspDocumentHighlight,
  LspFoldingRange,
  LspInlayHint,
  LspPrepareRename,
} from '@shared/types'

// LLMError 是接口类型（从 shared 导出）
export type { LLMError } from '@shared/types'

// 工作模式 - 统一从 modes 导出
export type { WorkMode } from '@/renderer/modes/types'

// 打开的文件
export interface OpenFile {
  path: string
  content: string
  isDirty: boolean
  originalContent?: string
}

// Diff 视图
export interface DiffView {
  original: string
  modified: string
  filePath: string
}

// 侧边栏面板
export type SidePanel = 'explorer' | 'search' | 'git' | 'problems' | 'outline' | 'extensions' | 'shell' | null

// 上下文项类型
export interface FileContext {
  type: 'File'
  uri: string
}

export interface CodeSelectionContext {
  type: 'CodeSelection'
  uri: string
  range: { start: number; end: number }
  content: string
}

export interface FolderContext {
  type: 'Folder'
  uri: string
}

export interface CodebaseContext {
  type: 'Codebase'
}

export interface GitContext {
  type: 'Git'
}

export interface TerminalContext {
  type: 'Terminal'
}

export interface SymbolsContext {
  type: 'Symbols'
}

export type ContextItem =
  | FileContext
  | CodeSelectionContext
  | FolderContext
  | CodebaseContext
  | GitContext
  | TerminalContext
  | SymbolsContext
