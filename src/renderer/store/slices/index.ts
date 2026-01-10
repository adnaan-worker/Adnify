/**
 * Store Slices 导出
 */
export { createFileSlice, type FileSlice, type OpenFile, type WorkspaceConfig, type LargeFileInfo } from './fileSlice'
export { createSettingsSlice, type SettingsSlice, type ProviderType, type LLMConfig, type LLMParameters, type AutoApproveSettings, type AgentConfig, type ProviderModelConfig } from './settingsSlice'
export { createThemeSlice, type ThemeSlice, type ThemeName } from './themeSlice'
export { createLogSlice, type LogSlice, type ToolCallLogEntry } from './logSlice'
export { createMcpSlice, type McpSlice } from './mcpSlice'
export { createDebugSlice, type DebugSlice, type Breakpoint } from './debugSlice'

// 新拆分的 slices
export { createDialogSlice, type DialogSlice } from './dialogSlice'
export { createLayoutSlice, type LayoutSlice, type SidePanel } from './layoutSlice'
export { createGitSlice, type GitSlice } from './gitSlice'
export { createEditorStateSlice, type EditorStateSlice, type DiffView } from './editorStateSlice'
