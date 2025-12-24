import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
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
import { ToastProvider, useToast, setGlobalToast } from './components/ToastProvider'
import { GlobalConfirmDialog } from './components/ConfirmDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initEditorConfig } from './config/editorConfig'
import { themeManager } from './config/themeConfig'
import { restoreWorkspaceState, initWorkspaceStateSync } from './services/workspaceStateService'
import { ThemeManager } from './components/ThemeManager'
import AboutDialog from './components/AboutDialog'
import { adnifyDir } from './services/adnifyDirService'
import { checkpointService } from './agent/checkpointService'
import { useAgentStore, initializeAgentStore } from './agent/core/AgentStore'
import { keybindingService } from './services/keybindingService'
import { registerCoreCommands } from './config/commands'
import { LAYOUT_LIMITS } from '../shared/constants'

// 懒加载大组件以优化首屏性能
const ComposerPanel = lazy(() => import('./components/ComposerPanel'))
const OnboardingWizard = lazy(() => import('./components/OnboardingWizard'))

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
    sidebarWidth, setSidebarWidth, chatWidth, setChatWidth,
    showQuickOpen, setShowQuickOpen, showAbout, setShowAbout,
    showCommandPalette, setShowCommandPalette
  } = useStore()
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)

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
    // Load saved settings & restore workspace
    const loadSettings = async () => {
      try {
        // 注册核心命令并初始化快捷键服务 (Move this up to ensure it runs)
        registerCoreCommands()
        await keybindingService.init()

        // 初始化 AgentStore 窗口隔离（确保多窗口不会共享会话）
        updateLoaderStatus('Initializing window...')
        await initializeAgentStore()

        // 初始化编辑器配置和主题
        updateLoaderStatus('Loading configuration...')
        await initEditorConfig()
        await themeManager.init()

        // 使用 Store 的 loadSettings 加载所有设置
        updateLoaderStatus('Loading settings...')
        const params = new URLSearchParams(window.location.search)
        const isEmptyWindow = params.get('empty') === '1'

        const { loadSettings } = useStore.getState()
        await loadSettings(isEmptyWindow)

        // 检查是否需要显示引导
        const { onboardingCompleted, hasExistingConfig } = useStore.getState()

        // 加载保存的主题
        const savedTheme = await window.electronAPI.getSetting('currentTheme')
        if (savedTheme) {
          const { setTheme } = useStore.getState()
          setTheme(savedTheme as 'adnify-dark' | 'midnight' | 'dawn')
        }

        // Auto-restore workspace (only if not an empty window)
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
            await (useAgentStore as any).persist.rehydrate()

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
        // Even if loading fails, ensure keybindings are registered
        registerCoreCommands()
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

  // 监听文件变化，自动刷新已打开的文件
  useEffect(() => {
    const unsubscribe = window.electronAPI.onFileChanged(async (event) => {
      if (event.event !== 'update') return // 只处理文件修改事件

      const { openFiles, reloadFileFromDisk } = useStore.getState()
      const openFile = openFiles.find(f => f.path === event.path)

      if (!openFile) return // 文件未打开，忽略

      // 读取最新内容
      const newContent = await window.electronAPI.readFile(event.path)
      if (newContent === null) return

      if (openFile.isDirty) {
        // 文件有未保存更改，显示冲突提示
        const shouldReload = confirm(
          `文件 "${event.path.split(/[\\/]/).pop()}" 已被外部修改。\n\n是否重新加载？（本地更改将丢失）`
        )
        if (shouldReload) {
          reloadFileFromDisk(event.path, newContent)
        }
      } else {
        // 文件无更改，直接刷新
        reloadFileFromDisk(event.path, newContent)
      }
    })

    return unsubscribe
  }, [])

  // Resize Logic - 使用共享常量
  useEffect(() => {
    if (!isResizingSidebar && !isResizingChat) return

    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        const newWidth = e.clientX - LAYOUT_LIMITS.ACTIVITY_BAR_WIDTH
        if (newWidth > LAYOUT_LIMITS.SIDEBAR_MIN_WIDTH && newWidth < LAYOUT_LIMITS.SIDEBAR_MAX_WIDTH) {
          setSidebarWidth(newWidth)
        }
      }
      if (isResizingChat) {
        const newWidth = window.innerWidth - e.clientX
        if (newWidth > LAYOUT_LIMITS.CHAT_MIN_WIDTH && newWidth < LAYOUT_LIMITS.CHAT_MAX_WIDTH) {
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
    // Fallback check for Ctrl+Shift+P or F1
    if (
      keybindingService.matches(e, 'workbench.action.showCommands') ||
      (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') ||
      e.key === 'F1'
    ) {
      e.preventDefault()
      setShowCommandPalette(true)
    }

    if (e.key === 'F12') {
      window.electronAPI.toggleDevTools()
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
      if (showAbout) setShowAbout(false)
    }
    else if (keybindingService.matches(e, 'help.about')) {
      e.preventDefault()
      setShowAbout(true)
    }
  }, [setShowSettings, setTerminalVisible, terminalVisible, showCommandPalette, showKeyboardShortcuts, showQuickOpen, showComposer, showAbout, setShowQuickOpen, setShowAbout])

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown)

    // Listen for menu commands from main process
    const removeListener = window.electronAPI.onExecuteCommand((commandId) => {
      console.log('[App] Received command from main:', commandId)
      if (commandId === 'workbench.action.showCommands') {
        console.log('[App] Showing Command Palette')
        setShowCommandPalette(true)
      }
      if (commandId === 'workbench.action.toggleDevTools') {
        window.electronAPI.toggleDevTools()
      }
    })

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown)
      removeListener()
    }
  }, [handleGlobalKeyDown])

  return (
    <div className="h-screen flex flex-col bg-transparent overflow-hidden text-text-primary selection:bg-accent/30 selection:text-white relative">
      {/* Background is handled by globals.css body style for better performance and consistency */}

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
        <Suspense fallback={null}>
          <ComposerPanel onClose={() => setShowComposer(false)} />
        </Suspense>
      )}
      {showOnboarding && isInitialized && (
        <Suspense fallback={null}>
          <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
        </Suspense>
      )}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
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