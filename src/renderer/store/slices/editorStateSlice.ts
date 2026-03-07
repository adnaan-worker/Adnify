/**
 * 编辑器运行时状态切片
 * 管理光标位置、选中代码、LSP 状态等
 */
import { StateCreator } from 'zustand'

export interface EditorStateSlice {
  isInitialized: boolean
  isLspReady: boolean
  cursorPosition: { line: number; column: number }
  selectedCode: string

  setIsInitialized: (initialized: boolean) => void
  setIsLspReady: (ready: boolean) => void
  setCursorPosition: (pos: { line: number; column: number }) => void
  setSelectedCode: (code: string) => void
}

export const createEditorStateSlice: StateCreator<EditorStateSlice, [], [], EditorStateSlice> = (set) => ({
  isInitialized: false,
  isLspReady: false,
  cursorPosition: { line: 1, column: 1 },
  selectedCode: '',

  setIsInitialized: (initialized) => set({ isInitialized: initialized }),
  setIsLspReady: (ready) => set({ isLspReady: ready }),
  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  setSelectedCode: (code) => set({ selectedCode: code }),
})
