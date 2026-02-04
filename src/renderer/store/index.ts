/**
 * 全局状态管理
 * 使用 Zustand 和 Slices 模式组织状态
 */
import { create } from 'zustand'
import {
  createFileSlice, FileSlice,
  createSettingsSlice, SettingsSlice,
  createThemeSlice, ThemeSlice,
  createLogSlice, LogSlice,
  createMcpSlice, McpSlice,
  createDebugSlice, DebugSlice,
  createDialogSlice, DialogSlice,
  createLayoutSlice, LayoutSlice,
  createGitSlice, GitSlice,
  createEditorStateSlice, EditorStateSlice,
  createPlanSlice, PlanSlice,
} from './slices'


// 导出类型
export type { OpenFile, WorkspaceConfig, LargeFileInfo } from './slices'
export type { ProviderModelConfig, SettingsState, SettingKey } from './slices'
// 类型从 shared/config/types 导入
export type { LLMConfig, AutoApproveSettings, AgentConfig } from '@shared/config/types'
export type { SecuritySettings } from '@shared/config/types'
export type { ThemeName } from './slices'
export type { ToolCallLogEntry } from './slices'
export type { McpSlice } from './slices'
export type { DebugSlice, Breakpoint } from './slices'
export type { SidePanel, DiffView } from './slices'

// 模式管理统一从 modeStore 导出
export { useModeStore } from '@/renderer/modes/modeStore'
export type { WorkMode } from '@/renderer/modes/types'

// 组合所有 slices
type StoreState = FileSlice & SettingsSlice & ThemeSlice & LogSlice & McpSlice & DebugSlice
  & DialogSlice & LayoutSlice & GitSlice & EditorStateSlice & PlanSlice

export const useStore = create<StoreState>()((...args) => ({
  ...createFileSlice(...args),
  ...createSettingsSlice(...args),
  ...createThemeSlice(...args),
  ...createLogSlice(...args),
  ...createMcpSlice(...args),
  ...createDebugSlice(...args),
  ...createDialogSlice(...args),
  ...createLayoutSlice(...args),
  ...createGitSlice(...args),
  ...createEditorStateSlice(...args),
  ...createPlanSlice(...args),
}))
