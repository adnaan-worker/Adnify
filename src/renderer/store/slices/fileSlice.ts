/**
 * 文件相关状态切片
 */
import { StateCreator } from 'zustand'
import type { FileItem } from '@shared/types'
import { normalizePath } from '@utils/pathUtils'

export interface WorkspaceConfig {
  configPath: string | null
  roots: string[]
}

/** 大文件信息 */
export interface LargeFileInfo {
  isLarge: boolean
  isVeryLarge: boolean
  size: number
  lineCount: number
  warning?: string
}

export interface OpenFile {
  path: string
  content: string
  isDirty: boolean
  originalContent?: string
  /** 大文件信息（如果是大文件） */
  largeFileInfo?: LargeFileInfo
  /** 文件编码 */
  encoding?: string
}

export interface FileSlice {
  workspace: WorkspaceConfig | null
  workspacePath: string | null // 返回第一个根目录或 null
  files: FileItem[]
  expandedFolders: Set<string>
  openFiles: OpenFile[]
  activeFilePath: string | null
  /** 当前选中的文件夹路径（用于在指定位置创建文件） */
  selectedFolderPath: string | null

  setWorkspace: (workspace: WorkspaceConfig | null) => void
  addRoot: (path: string) => void
  removeRoot: (path: string) => void
  setFiles: (files: FileItem[]) => void
  toggleFolder: (path: string) => void
  setSelectedFolder: (path: string | null) => void
  expandFolder: (path: string) => void
  openFile: (path: string, content: string, originalContent?: string, options?: {
    largeFileInfo?: LargeFileInfo
    encoding?: string
  }) => void
  closeFile: (path: string) => void
  setActiveFile: (path: string | null) => void
  updateFileContent: (path: string, content: string) => void
  markFileSaved: (path: string) => void
  /** 从磁盘重新加载文件内容（不设置 dirty） */
  reloadFileFromDisk: (path: string, content: string) => void
  // 文件树刷新触发器
  fileTreeRefreshKey: number
  triggerFileTreeRefresh: () => void
}

export const createFileSlice: StateCreator<FileSlice, [], [], FileSlice> = (set) => ({
  workspace: null,
  workspacePath: null,
  files: [],
  expandedFolders: new Set(),
  openFiles: [],
  activeFilePath: null,
  selectedFolderPath: null,
  fileTreeRefreshKey: 0,

  triggerFileTreeRefresh: () => set((state) => ({
    fileTreeRefreshKey: state.fileTreeRefreshKey + 1
  })),

  setWorkspace: (workspace) => set((state) => {
    // 自动展开所有根文件夹
    const newExpanded = new Set(state.expandedFolders)
    workspace?.roots.forEach(root => newExpanded.add(root))
    return {
      workspace,
      workspacePath: workspace?.roots[0] || null,
      expandedFolders: newExpanded
    }
  }),
  addRoot: (path) => set((state) => {
    if (!state.workspace) return { workspace: { configPath: null, roots: [path] }, workspacePath: path }
    if (state.workspace.roots.includes(path)) return {}
    return {
      workspace: {
        ...state.workspace,
        roots: [...state.workspace.roots, path]
      }
    }
  }),
  removeRoot: (path) => set((state) => {
    if (!state.workspace) return {}
    const newRoots = state.workspace.roots.filter(r => r !== path)
    return {
      workspace: {
        ...state.workspace,
        roots: newRoots
      },
      workspacePath: newRoots[0] || null
    }
  }),
  setFiles: (files) => set({ files }),
  setSelectedFolder: (path) => set({ selectedFolderPath: path }),
  expandFolder: (path) =>
    set((state) => {
      const newExpanded = new Set(state.expandedFolders)
      newExpanded.add(path)
      return { expandedFolders: newExpanded }
    }),
  toggleFolder: (path) =>
    set((state) => {
      const newExpanded = new Set(state.expandedFolders)
      if (newExpanded.has(path)) {
        newExpanded.delete(path)
      } else {
        newExpanded.add(path)
      }
      return { expandedFolders: newExpanded }
    }),

  openFile: (path, content, originalContent, options) =>
    set((state) => {
      // 使用规范化路径进行比较，避免路径格式不一致导致重复打开
      const normalizedPath = normalizePath(path)
      const existing = state.openFiles.find((f) => normalizePath(f.path) === normalizedPath)
      if (existing) {
        const updatedFiles = state.openFiles.map((f) =>
          normalizePath(f.path) === normalizedPath ? {
            ...f,
            content,
            originalContent,
            largeFileInfo: options?.largeFileInfo,
            encoding: options?.encoding,
          } : f
        )
        // 使用已存在文件的路径，保持一致性
        return { activeFilePath: existing.path, openFiles: updatedFiles }
      }
      return {
        openFiles: [...state.openFiles, {
          path,
          content,
          isDirty: false,
          originalContent,
          largeFileInfo: options?.largeFileInfo,
          encoding: options?.encoding,
        }],
        activeFilePath: path,
      }
    }),

  closeFile: (path) =>
    set((state) => {
      const newOpenFiles = state.openFiles.filter((f) => f.path !== path)
      const newActivePath =
        state.activeFilePath === path
          ? newOpenFiles[newOpenFiles.length - 1]?.path || null
          : state.activeFilePath
      return { openFiles: newOpenFiles, activeFilePath: newActivePath }
    }),

  setActiveFile: (path) => set({ activeFilePath: path }),

  updateFileContent: (path, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, content, isDirty: true } : f
      ),
    })),

  markFileSaved: (path) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) => (f.path === path ? { ...f, isDirty: false } : f)),
    })),

  reloadFileFromDisk: (path, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        // 重新加载时清除 originalContent，避免 DiffEditor 显示两边相同的内容
        f.path === path ? { ...f, content, originalContent: undefined, isDirty: false } : f
      ),
    })),
})
