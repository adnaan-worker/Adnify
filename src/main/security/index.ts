/**
 * 安全模块统一导出
 */

export { securityManager, OperationType, PermissionLevel, checkWorkspacePermission } from './securityModule'
export { registerSecureTerminalHandlers, cleanupTerminals, pruneExitedTerminals, updateWhitelist, getWhitelist } from './secureTerminal'
export { registerSecureFileHandlers, cleanupSecureFileWatcher } from './secureFile'
export {
  registerIsolatedWorkspaceHandlers,
  chooseIsolationMode,
  previewIsolationChoice,
  createIsolatedWorkspace,
  disposeIsolatedWorkspace,
  cleanupAllIsolatedWorkspaces,
} from './isolatedWorkspace'
export type {
  IsolationMode,
  IsolationChoiceInput,
  IsolationPreviewResult,
  CreateIsolatedWorkspaceRequest,
  IsolatedWorkspaceResult,
  IsolatedWorkspaceCleanupSummary,
} from './isolatedWorkspace'
