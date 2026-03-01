/**
 * 全局快捷键 Hook
 */
import { useEffect, useCallback } from 'react'
import { useStore } from '@store'
import { api } from '@renderer/services/electronAPI'

export function useGlobalShortcuts() {
  const {
    setShowSettings,
    setShowCommandPalette,
    setShowComposer,
    setShowQuickOpen,
    setShowAbout,
    terminalVisible,
    setTerminalVisible,
    debugVisible,
    setDebugVisible,
    showCommandPalette,
    showComposer,
    showQuickOpen,
    showAbout,
    activeFilePath,
    closeFile,
  } = useStore()

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Command Palette: Ctrl+Shift+O or F1
    if (e.key === 'F1' || (e.ctrlKey && e.key === 'O')) {
      e.preventDefault()
      setShowCommandPalette(true)
      return
    }

    // Quick Open: Ctrl+P
    if (e.ctrlKey && e.key.toLowerCase() === 'p' && !e.altKey) {
      e.preventDefault()
      setShowQuickOpen(true)
      return
    }

    // DevTools: F12
    if (e.key === 'F12') {
      api.window.toggleDevTools()
      return
    }

    // Settings: Ctrl+,
    if (e.ctrlKey && e.key === ',') {
      e.preventDefault()
      setShowSettings(true)
      return
    }

    // Terminal: Ctrl+`
    if (e.ctrlKey && (e.key === '`' || e.code === 'Backquote')) {
      e.preventDefault()
      setTerminalVisible(!terminalVisible)
      return
    }

    // Debug: Ctrl+Shift+D
    if (e.ctrlKey && (e.key === 'D' || (e.shiftKey && e.key.toLowerCase() === 'd'))) {
      e.preventDefault()
      setDebugVisible(!debugVisible)
      return
    }

    // Debug shortcuts
    if (e.key === 'F5') {
      e.preventDefault()
      if (!debugVisible) setDebugVisible(true)
      window.dispatchEvent(new CustomEvent('debug:start'))
      return
    }

    if (e.key === 'F9') {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('debug:toggleBreakpoint'))
      return
    }

    // Composer: Ctrl+Shift+I
    if (e.ctrlKey && (e.key === 'I' || (e.shiftKey && e.key.toLowerCase() === 'i'))) {
      e.preventDefault()
      setShowComposer(true)
      return
    }

    // Close panel: Escape
    if (e.key === 'Escape') {
      if (showCommandPalette) setShowCommandPalette(false)
      if (showComposer) setShowComposer(false)
      if (showQuickOpen) setShowQuickOpen(false)
      if (showAbout) setShowAbout(false)
      return
    }

    // Reveal active file in explorer: Ctrl+Shift+E
    if (e.ctrlKey && (e.key === 'E' || (e.shiftKey && e.key.toLowerCase() === 'e'))) {
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

    // Close active file: Ctrl+W
    if (e.ctrlKey && e.key.toLowerCase() === 'w') {
      e.preventDefault()
      if (activeFilePath) {
        closeFile(activeFilePath)
      }
      return
    }
  }, [
    setShowSettings, setShowCommandPalette, setShowComposer, setShowQuickOpen, setShowAbout,
    terminalVisible, setTerminalVisible, debugVisible, setDebugVisible,
    showCommandPalette, showComposer, showQuickOpen, showAbout,
    activeFilePath, closeFile
  ])

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
      if (commandId === 'explorer.revealActiveFile') {
        window.dispatchEvent(new CustomEvent('explorer:reveal-active-file'))
      }
    })
    return removeListener
  }, [setShowCommandPalette])
}
