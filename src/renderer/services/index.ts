/**
 * 服务层统一导出
 * 按功能分组，便于按需导入
 */

// ===== 核心 API =====
export { api, getAPI, type GroupedElectronAPI } from './electronAPI'

// ===== 初始化 =====
export { initializeApp, registerSettingsSync, type InitResult } from './initService'

// ===== 工作区管理 =====
export { workspaceManager } from './WorkspaceManager'
export { adnifyDir } from './adnifyDirService'
export { saveWorkspaceState, restoreWorkspaceState, scheduleStateSave, initWorkspaceStateSync } from './workspaceStateService'
export { directoryCacheService } from './directoryCacheService'
export { ignoreService } from './ignoreService'

// ===== 编辑器相关 =====
export { completionService } from './completionService'
export { pathLinkService } from './pathLinkService'
export { getFileInfo, getLargeFileEditorOptions, getLargeFileWarning, isLargeFile, isVeryLargeFile } from './largeFileService'
export type { LargeFileInfo, FileChunk } from './largeFileService'

// ===== LSP 服务 =====
export {
  startLspServer,
  stopLspServer,
  didOpenDocument,
  didChangeDocument,
  goToDefinition,
  getHoverInfo,
  getCompletions,
  getSignatureHelp,
  getIncomingCalls,
  getOutgoingCalls,
  onDiagnostics,
  lspUriToPath,
  getDocumentSymbols,
} from './lspService'
export { registerLspProviders } from './lspProviders'
export { initMonacoTypeService } from './monacoTypeService'

// ===== 诊断 =====
export { useDiagnosticsStore, initDiagnosticsListener, getFileStats } from './diagnosticsStore'

// ===== 终端 =====
export { terminalManager } from './TerminalManager'

// ===== 快捷键 =====
export { keybindingService } from './keybindingService'
export type { Command, Keybinding } from './keybindingService'

// ===== MCP =====
export { mcpService } from './mcpService'

// ===== 其他 =====
export { slashCommandService } from './slashCommandService'
export type { SlashCommand, SlashCommandResult } from './slashCommandService'
export { checkProviderHealth, clearHealthCache } from './healthCheckService'
export { indexWorkerService } from './indexWorkerService'
export { snippetService } from './snippetService'
export type { CodeSnippet, SnippetGroup } from './snippetService'
export { workerService } from './workerService'