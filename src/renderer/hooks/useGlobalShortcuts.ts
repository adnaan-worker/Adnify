/**
 * 全局快捷键 Hook
 *
 * 优化：使用 useRef 持有动态状态值，
 * handleKeyDown 回调引用稳定，不再频繁注册/注销事件监听器。
 */
import { useEffect, useCallback, useRef } from 'react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'
import { isMac } from '@services/keybindingService'

const primaryMod = (e: KeyboardEvent) => isMac ? e.metaKey : e.ctrlKey

export function useGlobalShortcuts() {
  // setter 函数引用稳定，直接从 store 获取
  const setShowSettings = useStore(state => state.setShowSettings)
  const setShowCommandPalette = useStore(state => state.setShowCommandPalette)
  const setShowComposer = useStore(state => state.setShowComposer)
  const setShowQuickOpen = useStore(state => state.setShowQuickOpen)
  const setShowAbout = useStore(state => state.setShowAbout)
  const setTerminalVisible = useStore(state => state.setTerminalVisible)
  const setDebugVisible = useStore(state => state.setDebugVisible)
  const closeFile = useStore(state => state.closeFile)

  // 动态值通过 ref 访问，避免回调依赖
  const stateRef = useRef({
    terminalVisible: false,
    debugVisible: false,
    showCommandPalette: false,
    showComposer: false,
    showQuickOpen: false,
    showAbout: false,
    activeFilePath: null as string | null,
  })

  // 订阅动态值但不触发 handleKeyDown 重建
  const terminalVisible = useStore(state => state.terminalVisible)
  const debugVisible = useStore(state => state.debugVisible)
  const showCommandPalette = useStore(state => state.showCommandPalette)
  const showComposer = useStore(state => state.showComposer)
  const showQuickOpen = useStore(state => state.showQuickOpen)
  const showAbout = useStore(state => state.showAbout)
  const activeFilePath = useStore(state => state.activeFilePath)

  stateRef.current = { terminalVisible, debugVisible, showCommandPalette, showComposer, showQuickOpen, showAbout, activeFilePath }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const s = stateRef.current

    const mod = primaryMod(e)

    // Command Palette: Ctrl/Cmd+Shift+O or F1
    if (e.key === 'F1' || (mod && e.shiftKey && e.key === 'O')) {
      e.preventDefault()
      setShowCommandPalette(true)
      return
    }

    // Quick Open: Ctrl/Cmd+P
    if (mod && e.key.toLowerCase() === 'p' && !e.altKey) {
      e.preventDefault()
      setShowQuickOpen(true)
      return
    }

    // DevTools: F12
    if (e.key === 'F12') {
      api.window.toggleDevTools()
      return
    }

    // Settings: Ctrl/Cmd+,
    if (mod && e.key === ',') {
      e.preventDefault()
      setShowSettings(true)
      return
    }

    // Terminal: Ctrl/Cmd+`
    if (mod && (e.key === '`' || e.code === 'Backquote')) {
      e.preventDefault()
      setTerminalVisible(!s.terminalVisible)
      return
    }

    // Debug: Ctrl/Cmd+Shift+D
    if (mod && (e.key === 'D' || (e.shiftKey && e.key.toLowerCase() === 'd'))) {
      e.preventDefault()
      setDebugVisible(!s.debugVisible)
      return
    }

    // Debug shortcuts
    if (e.key === 'F5') {
      e.preventDefault()
      if (!s.debugVisible) setDebugVisible(true)
      window.dispatchEvent(new CustomEvent('debug:start'))
      return
    }

    if (e.key === 'F9') {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('debug:toggleBreakpoint'))
      return
    }

    // Composer: Ctrl/Cmd+Shift+I
    if (mod && (e.key === 'I' || (e.shiftKey && e.key.toLowerCase() === 'i'))) {
      e.preventDefault()
      setShowComposer(true)
      return
    }

    // Close panel: Escape
    if (e.key === 'Escape') {
      if (s.showCommandPalette) setShowCommandPalette(false)
      if (s.showComposer) setShowComposer(false)
      if (s.showQuickOpen) setShowQuickOpen(false)
      if (s.showAbout) setShowAbout(false)
      return
    }

    // Reveal active file in explorer: Ctrl/Cmd+Shift+E
    if (mod && (e.key === 'E' || (e.shiftKey && e.key.toLowerCase() === 'e'))) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('explorer:reveal-active-file'))
      return
    }

    // Reveal active file in sidebar: Alt+Shift+L
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('explorer:reveal-active-file'))
      return
    }

    // Close active file: Ctrl/Cmd+W
    if (mod && e.key.toLowerCase() === 'w') {
      e.preventDefault()
      if (s.activeFilePath) {
        closeFile(s.activeFilePath)
      }
      return
    }
  }, []) // 空依赖 — setter 和 stateRef 都是稳定的

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // 监听主进程菜单命令
  useEffect(() => {
    const removeListener = api.onExecuteCommand((commandId: string) => {
      if (commandId === 'workbench.action.showCommands') {
        setShowCommandPalette(true)
      }
      if (commandId === 'workbench.action.toggleDevTools') {
        api.window.toggleDevTools()
      }
    })
    return () => { removeListener?.() }
  }, [setShowCommandPalette])
}
