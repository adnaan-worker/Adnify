import { useEffect, useState, useCallback } from 'react'
import { useStore } from './store'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import Editor from './components/Editor'
import { ChatPanel } from './components/agent'
import SettingsModal from './components/SettingsModal'
import TerminalPanel from './components/TerminalPanel'
import CommandPalette from './components/CommandPalette'
import KeyboardShortcuts from './components/KeyboardShortcuts'
import QuickOpen from './components/QuickOpen'
import ActivityBar from './components/ActivityBar'
import StatusBar from './components/StatusBar'
import ComposerPanel from './components/ComposerPanel'
import OnboardingWizard from './components/OnboardingWizard'
import { ToastProvider, useToast, setGlobalToast } from './components/Toast'
import { initEditorConfig } from './config/editorConfig'
import { themeManager } from './config/themeConfig'
import { restoreWorkspaceState, initWorkspaceStateSync } from './services/workspaceStateService'

// 暴露 store 给插件系统
;(window as any).__ADNIFY_STORE__ = { getState: () => useStore.getState() }

// 初始化全局 Toast 的组件
function ToastInitializer() {
  const toastContext = useToast()
  useEffect(() => {
    setGlobalToast(toastContext)
  }, [toastContext])
  return null
}

// 主应用内容
function AppContent() {
  const { 
    showSettings, setLLMConfig, setLanguage, setAutoApprove, setPromptTemplateId, setShowSettings, 
    setTerminalVisible, terminalVisible, setWorkspacePath, setFiles,
    activeSidePanel
  } = useStore()
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  const [showQuickOpen, setShowQuickOpen] = useState(false)
  const [showComposer, setShowComposer] = useState(false)
  
  // 引导状态
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)

  // Layout State
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [chatWidth, setChatWidth] = useState(450)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [isResizingChat, setIsResizingChat] = useState(false)

  // 更新 HTML loader 状态
  const updateLoaderStatus = useCallback((status: string) => {
    const statusEl = document.querySelector('#initial-loader .loader-status')
    if (statusEl) statusEl.textContent = status
  }, [])

  // 移除初始 HTML loader
  const removeInitialLoader = useCallback(() => {
    const loader = document.getElementById('initial-loader')
    if (loader) {
      loader.classList.add('fade-out')
      setTimeout(() => loader.remove(), 400)
    }
  }, [])

  useEffect(() => {
    // Load saved settings & restore workspace
    const loadSettings = async () => {
      try {
        // 初始化编辑器配置和主题
        updateLoaderStatus('Loading configuration...')
        await initEditorConfig()
        await themeManager.init()
        
        // 检查是否首次使用（兼容老用户：如果已有配置但没有 onboardingCompleted 字段，视为已完成）
        const onboardingCompleted = await window.electronAPI.getSetting('onboardingCompleted')
        const hasExistingConfig = await window.electronAPI.getSetting('llmConfig')
        
        updateLoaderStatus('Loading settings...')
        const savedConfig = await window.electronAPI.getSetting('llmConfig')
        if (savedConfig) {
          setLLMConfig(savedConfig)
        }
        const savedLanguage = await window.electronAPI.getSetting('language')
        if (savedLanguage) {
          setLanguage(savedLanguage as 'en' | 'zh')
        }
        const savedAutoApprove = await window.electronAPI.getSetting('autoApprove')
        if (savedAutoApprove) {
          setAutoApprove(savedAutoApprove)
        }
        const savedPromptTemplateId = await window.electronAPI.getSetting('promptTemplateId')
        if (savedPromptTemplateId) {
          setPromptTemplateId(savedPromptTemplateId as string)
        }
        
        // Auto-restore workspace
        updateLoaderStatus('Restoring workspace...')
        const lastWorkspace = await window.electronAPI.restoreWorkspace()
        if (lastWorkspace) {
          setWorkspacePath(lastWorkspace)
          updateLoaderStatus('Loading files...')
          const items = await window.electronAPI.readDir(lastWorkspace)
          setFiles(items)
          
          // 恢复工作区状态（打开的文件等）
          updateLoaderStatus('Restoring editor state...')
          await restoreWorkspaceState()
        }
        
        updateLoaderStatus('Ready!')
        // 短暂延迟后移除 loader
        setTimeout(() => {
          removeInitialLoader()
          setIsInitialized(true)
          // 显示引导的条件：
          // 1. onboardingCompleted 明确为 false（用户主动要求重新体验）
          // 2. 或者 onboardingCompleted 未设置且没有现有配置（真正的新用户）
          const shouldShowOnboarding = onboardingCompleted === false || 
            (onboardingCompleted === null && !hasExistingConfig)
          if (shouldShowOnboarding) {
            setShowOnboarding(true)
          }
        }, 200)
      } catch (error) {
        console.error('Failed to load settings:', error)
        removeInitialLoader()
        setIsInitialized(true)
      }
    }
    loadSettings()
  }, [setLLMConfig, setLanguage, setAutoApprove, setWorkspacePath, setFiles, updateLoaderStatus, removeInitialLoader])

  // 初始化工作区状态同步（自动保存打开的文件等）
  useEffect(() => {
    const cleanup = initWorkspaceStateSync()
    return cleanup
  }, [])

  // Resize Logic
  useEffect(() => {
    if (!isResizingSidebar && !isResizingChat) return

    const handleMouseMove = (e: MouseEvent) => {
        if (isResizingSidebar) {
            const newWidth = e.clientX - 48 // 48 is ActivityBar width
            if (newWidth > 150 && newWidth < 600) {
                setSidebarWidth(newWidth)
            }
        }
        if (isResizingChat) {
            const newWidth = window.innerWidth - e.clientX
            if (newWidth > 300 && newWidth < 800) {
                setChatWidth(newWidth)
            }
        }
    }

    const handleMouseUp = () => {
        setIsResizingSidebar(false)
        setIsResizingChat(false)
        document.body.style.cursor = 'default'
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    
    // Add overlay to prevent iframe stealing mouse events (if any)
    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    overlay.style.top = '0'
    overlay.style.left = '0'
    overlay.style.right = '0'
    overlay.style.bottom = '0'
    overlay.style.zIndex = '9999'
    overlay.style.cursor = isResizingSidebar || isResizingChat ? 'col-resize' : 'default'
    document.body.appendChild(overlay)

    return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        document.body.removeChild(overlay)
    }
  }, [isResizingSidebar, isResizingChat])

  // 全局快捷键
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    // Ctrl+Shift+P: 命令面板
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
      e.preventDefault()
      setShowCommandPalette(true)
    }
    // Ctrl+P: 快速打开文件
    else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'p') {
      e.preventDefault()
      setShowQuickOpen(true)
    }
    // Ctrl+,: 设置
    else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault()
      setShowSettings(true)
    }
    // Ctrl+`: 终端
    else if ((e.ctrlKey || e.metaKey) && e.key === '`') {
      e.preventDefault()
      setTerminalVisible(!terminalVisible)
    }
    // ?: 快捷键帮助
    else if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const target = e.target as HTMLElement
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        e.preventDefault()
        setShowKeyboardShortcuts(true)
      }
    }
    // Ctrl+Shift+I: Composer (多文件编辑)
    else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I') {
      e.preventDefault()
      setShowComposer(true)
    }
    // Escape: 关闭面板
    else if (e.key === 'Escape') {
      if (showCommandPalette) setShowCommandPalette(false)
      if (showKeyboardShortcuts) setShowKeyboardShortcuts(false)
      if (showQuickOpen) setShowQuickOpen(false)
      if (showComposer) setShowComposer(false)
    }
  }, [setShowSettings, setTerminalVisible, terminalVisible, showCommandPalette, showKeyboardShortcuts, showQuickOpen, showComposer])

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [handleGlobalKeyDown])

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden text-text-primary">
      <TitleBar />
      
      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        <ActivityBar />
        
        {/* Sidebar Container */}
        {activeSidePanel && (
            <div style={{ width: sidebarWidth }} className="flex-shrink-0 relative">
                <Sidebar />
                {/* Sidebar Resize Handle */}
                <div 
                    className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/50 transition-colors z-50 translate-x-[2px]"
                    onMouseDown={(e) => { e.preventDefault(); setIsResizingSidebar(true) }}
                />
            </div>
        )}
        
        {/* Editor & Chat Area */}
        <div className="flex-1 flex min-w-0 bg-background relative">
          
          {/* Editor Column */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
             <div className="flex-1 flex flex-col relative">
                <Editor />
             </div>
             <TerminalPanel />
          </div>

          {/* Chat Panel Container */}
          <div style={{ width: chatWidth }} className="flex-shrink-0 relative border-l border-border-subtle">
              {/* Chat Resize Handle */}
              <div 
                  className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-accent/50 transition-colors z-50 -translate-x-[2px]"
                  onMouseDown={(e) => { e.preventDefault(); setIsResizingChat(true) }}
              />
              <ChatPanel />
          </div>

        </div>
      </div>

      <StatusBar />

      {/* Overlays */}
      {showSettings && <SettingsModal />}
      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          onShowKeyboardShortcuts={() => {
            setShowCommandPalette(false)
            setShowKeyboardShortcuts(true)
          }}
        />
      )}
      {showKeyboardShortcuts && (
        <KeyboardShortcuts onClose={() => setShowKeyboardShortcuts(false)} />
      )}
      {showQuickOpen && (
        <QuickOpen onClose={() => setShowQuickOpen(false)} />
      )}
      {showComposer && (
        <ComposerPanel onClose={() => setShowComposer(false)} />
      )}
      
      {/* 首次使用引导 */}
      {showOnboarding && isInitialized && (
        <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
  )
}

// 导出包装了 ToastProvider 的 App
export default function App() {
  return (
    <ToastProvider>
      <ToastInitializer />
      <AppContent />
    </ToastProvider>
  )
}