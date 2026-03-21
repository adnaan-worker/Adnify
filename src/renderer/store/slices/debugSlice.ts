/**
 * 调试状态切片
 * 管理断点、调试会话等状态
 */
import { StateCreator } from 'zustand'
import type { DebugSessionState, DebugStackFrame, DebugScope, DebugVariable } from '@renderer/types/electron'

export interface Breakpoint {
  id: string
  filePath: string
  line: number
  enabled: boolean
  condition?: string
  hitCount?: number
}

export interface DebugSlice {
  // 断点
  breakpoints: Breakpoint[]
  
  // 会话
  sessions: DebugSessionState[]
  activeSessionId: string | null
  
  // 调试状态
  stackFrames: DebugStackFrame[]
  scopes: DebugScope[]
  variables: Map<number, DebugVariable[]>
  
  // 控制台输出
  consoleOutput: string[]
  
  // Actions
  addBreakpoint: (filePath: string, line: number, condition?: string) => void
  removeBreakpoint: (filePath: string, line: number) => void
  toggleBreakpoint: (filePath: string, line: number) => void
  toggleBreakpointEnabled: (id: string) => void
  clearBreakpoints: (filePath?: string) => void
  getBreakpointsForFile: (filePath: string) => Breakpoint[]
  hasBreakpoint: (filePath: string, line: number) => boolean
  
  setSessions: (sessions: DebugSessionState[]) => void
  setActiveSessionId: (id: string | null) => void
  setStackFrames: (frames: DebugStackFrame[]) => void
  setScopes: (scopes: DebugScope[]) => void
  setVariables: (ref: number, vars: DebugVariable[]) => void
  addConsoleOutput: (text: string) => void
  clearConsoleOutput: () => void
}

let breakpointIdCounter = 0

export const createDebugSlice: StateCreator<DebugSlice, [], [], DebugSlice> = (set, get) => ({
  breakpoints: [],
  sessions: [],
  activeSessionId: null,
  stackFrames: [],
  scopes: [],
  variables: new Map(),
  consoleOutput: [],

  addBreakpoint: (filePath, line, condition) => {
    const id = `bp_${++breakpointIdCounter}`
    set(state => ({
      breakpoints: [...state.breakpoints, { id, filePath, line, enabled: true, condition }]
    }))
  },

  removeBreakpoint: (filePath, line) => {
    set(state => ({
      breakpoints: state.breakpoints.filter(bp => !(bp.filePath === filePath && bp.line === line))
    }))
  },

  toggleBreakpoint: (filePath, line) => {
    const { breakpoints, addBreakpoint, removeBreakpoint } = get()
    const exists = breakpoints.some(bp => bp.filePath === filePath && bp.line === line)
    if (exists) {
      removeBreakpoint(filePath, line)
    } else {
      addBreakpoint(filePath, line)
    }
  },

  toggleBreakpointEnabled: (id) => {
    set(state => ({
      breakpoints: state.breakpoints.map(bp =>
        bp.id === id ? { ...bp, enabled: !bp.enabled } : bp
      )
    }))
  },

  clearBreakpoints: (filePath) => {
    set(state => ({
      breakpoints: filePath
        ? state.breakpoints.filter(bp => bp.filePath !== filePath)
        : []
    }))
  },

  getBreakpointsForFile: (filePath) => {
    return get().breakpoints.filter(bp => bp.filePath === filePath)
  },

  hasBreakpoint: (filePath, line) => {
    return get().breakpoints.some(bp => bp.filePath === filePath && bp.line === line)
  },

  setSessions: (sessions) => set({ sessions }),
  setActiveSessionId: (id) => set(() => ({
    activeSessionId: id,
    // 调试会话结束时清空变量缓存
    ...(id === null ? { variables: new Map(), stackFrames: [], scopes: [] } : {}),
  })),
  setStackFrames: (frames) => set({ stackFrames: frames }),
  setScopes: (scopes) => set({ scopes }),
  setVariables: (ref, vars) => set(state => {
    const newMap = new Map(state.variables)
    newMap.set(ref, vars)
    return { variables: newMap }
  }),
  addConsoleOutput: (text) => set(state => ({
    consoleOutput: [...state.consoleOutput.slice(-200), `[${new Date().toLocaleTimeString()}] ${text}`]
  })),
  clearConsoleOutput: () => set({ consoleOutput: [] }),
})
