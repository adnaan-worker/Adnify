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
import { GlobalConfirmDialog } from './components/ConfirmDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initEditorConfig } from './config/editorConfig'
import { themeManager } from './config/themeConfig'
import { restoreWorkspaceState, initWorkspaceStateSync } from './services/workspaceStateService'
import { ThemeManager } from './components/ThemeManager'
import { adnifyDir } from './services/adnifyDirService'
import { checkpointService } from './agent/checkpointService'
import { useAgentStore } from './agent/core/AgentStore'
import { keybindingService } from './services/keybindingService'
import { registerCoreCommands } from './config/commands'
import noiseSvg from './assets/images/noise.svg'

  // 暴露 store 给插件系统
  ; (window as any).__ADNIFY_STORE__ = { getState: () => useStore.getState() }

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
    setTerminalVisible, terminalVisible, setWorkspace, setFiles,
    activeSidePanel, showComposer, setShowComposer,
    sidebarWidth, setSidebarWidth, chatWidth, setChatWidth
  } = useStore()
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  const [showQuickOpen, setShowQuickOpen] = useState(false)

  // 引导状态
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)

  // Layout State
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [isResizingChat, setIsResizingChat] = useState(false)

  // 更新 HTML loader 状态
  const updateLoaderStatus = useCallback((status: string) => {
    const statusEl = document.querySelector('#initial-loader .loader-status')
    if (statusEl) statusEl.textContent = status
  }, [])

  // 移除初始 HTML loader
  const removeInitialLoader = useCallback((_status?: string) => {
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

        // 注册核心命令并初始化快捷键服务
        registerCoreCommands()
        await keybindingService.init()

        // 检查是否首次使用
        const onboardingCompleted = await window.electronAPI.getSetting('onboardingCompleted') as boolean | undefined
        const hasExistingConfig = await window.electronAPI.getSetting('llmConfig') as object | undefined

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

        // 加载保存的主题
        const savedTheme = await window.electronAPI.getSetting('currentTheme')
        if (savedTheme) {
          const { setTheme } = useStore.getState()
          setTheme(savedTheme as 'adnify-dark' | 'midnight' | 'dawn')
        }

        // Auto-restore workspace (only if not an empty window)
        const params = new URLSearchParams(window.location.search)
        const isEmptyWindow = params.get('empty') === '1'

        if (!isEmptyWindow) {
          updateLoaderStatus('Restoring workspace...')
          const workspaceConfig = await window.electronAPI.restoreWorkspace()
          if (workspaceConfig && workspaceConfig.roots && workspaceConfig.roots.length > 0) {
            setWorkspace(workspaceConfig)

            // 并行初始化所有根目录的 .adnify 结构
            updateLoaderStatus('Initializing workspace roots...')
            await Promise.all(workspaceConfig.roots.map(root => adnifyDir.initialize(root)))

            // 设置主根目录（默认为第一个）
            await adnifyDir.setPrimaryRoot(workspaceConfig.roots[0])

            // 初始化检查点服务
            await checkpointService.init()

            // 重新加载 Agent Store（确保从 .adnify 读取最新数据）
            await useAgentStore.persist.rehydrate()

            updateLoaderStatus('Loading files...')
            // 初始显示第一个根目录的文件
            const items = await window.electronAPI.readDir(workspaceConfig.roots[0])
            setFiles(items)

            // 恢复工作区状态（打开的文件等）
            updateLoaderStatus('Restoring editor state...')
            await restoreWorkspaceState()
          }
        }

        // 注册设置同步监听器
        window.electronAPI.onSettingsChanged(({ key, value }) => {
          console.log(`[App] Setting changed in another window: ${key}`, value)
          if (key === 'llmConfig') setLLMConfig(value as any)
          if (key === 'language') setLanguage(value as any)
          if (key === 'autoApprove') setAutoApprove(value as any)
          if (key === 'promptTemplateId') setPromptTemplateId(value as any)
          if (key === 'currentTheme') {
            const { setTheme } = useStore.getState()
            setTheme(value as any)
          }
        })

        updateLoaderStatus('Ready!')
        // 短暂延迟后移除 loader 并通知主进程显示窗口
        setTimeout(() => {
          removeInitialLoader()
          setIsInitialized(true)

          // 通知主进程：渲染完成，可以显示窗口了
          window.electronAPI.appReady()

          const shouldShowOnboarding = onboardingCompleted === false ||
            (onboardingCompleted === undefined && !hasExistingConfig)
          if (shouldShowOnboarding) {
            setShowOnboarding(true)
          }
        }, 100)
      } catch (error) {
        console.error('Failed to load settings:', error)
        removeInitialLoader()
        setIsInitialized(true)
        window.electronAPI.appReady()
      }
    }
    loadSettings()
  }, [setLLMConfig, setLanguage, setAutoApprove, setWorkspace, setFiles, updateLoaderStatus, removeInitialLoader, setPromptTemplateId])

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
  }, [isResizingSidebar, isResizingChat, setSidebarWidth, setChatWidth])

  // 全局快捷键
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if (keybindingService.matches(e, 'workbench.action.showCommands')) {
      e.preventDefault()
      setShowCommandPalette(true)
    }
    else if (keybindingService.matches(e, 'workbench.action.quickOpen')) {
      e.preventDefault()
      setShowQuickOpen(true)
    }
    else if (keybindingService.matches(e, 'workbench.action.openSettings')) {
      e.preventDefault()
      setShowSettings(true)
    }
    else if (keybindingService.matches(e, 'view.toggleTerminal')) {
      e.preventDefault()
      setTerminalVisible(!terminalVisible)
    }
    else if (keybindingService.matches(e, 'workbench.action.showShortcuts')) {
      const target = e.target as HTMLElement
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        e.preventDefault()
        setShowKeyboardShortcuts(true)
      }
    }
    else if (keybindingService.matches(e, 'workbench.action.toggleComposer')) {
      e.preventDefault()
      setShowComposer(true)
    }
    else if (keybindingService.matches(e, 'workbench.action.closePanel')) {
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
    <div className="h-screen flex flex-col bg-background overflow-hidden text-text-primary selection:bg-accent/30 selection:text-white relative">
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-black pointer-events-none z-0" />
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none z-0 mix-blend-overlay"
        style={{ backgroundImage: `url(${noiseSvg})` }}
      />

      <div className="relative z-10 flex flex-col h-full">
        <TitleBar />

        <div className="flex-1 flex overflow-hidden">
          <ActivityBar />

          {activeSidePanel && (
            <div style={{ width: sidebarWidth }} className="flex-shrink-0 relative">
              <Sidebar />
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/50 transition-colors z-50 translate-x-[2px]"
                onMouseDown={(e) => { e.preventDefault(); setIsResizingSidebar(true) }}
              />
            </div>
          )}

          <div className="flex-1 flex min-w-0 bg-background relative">
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
                <ErrorBoundary>
                  <Editor />
                </ErrorBoundary>
              </div>
              <ErrorBoundary>
                <TerminalPanel />
              </ErrorBoundary>
            </div>

            <div style={{ width: chatWidth }} className="flex-shrink-0 relative border-l border-border-subtle">
              <div
                className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-accent/50 transition-colors z-50 -translate-x-[2px]"
                onMouseDown={(e) => { e.preventDefault(); setIsResizingChat(true) }}
              />
              <ErrorBoundary>
                <ChatPanel />
              </ErrorBoundary>
            </div>
          </div>
        </div>

        <StatusBar />
      </div>

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
      {showOnboarding && isInitialized && (
        <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
      )}
      <GlobalConfirmDialog />
    </div >
  )
}

export default function App() {
  return (
    <ToastProvider>
      <ToastInitializer />
      <ThemeManager>
        <AppContent />
      </ThemeManager>
    </ToastProvider>
  )
}