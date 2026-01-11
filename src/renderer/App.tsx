import { lazy, Suspense, useState, useCallback } from 'react'
import { useStore } from './store'
import { useWindowTitle, useAppInit, useGlobalShortcuts, useFileWatcher, useSidebarResize, useChatResize } from './hooks'
import TitleBar from './components/layout/TitleBar'
import ActivityBar from './components/layout/ActivityBar'
import StatusBar from './components/layout/StatusBar'
import { ToastProvider, useToast, setGlobalToast } from './components/common/ToastProvider'
import { GlobalConfirmDialog } from './components/common/ConfirmDialog'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { GlobalErrorHandler } from './components/common/GlobalErrorHandler'
import { ThemeManager } from './components/editor/ThemeManager'
import { EditorSkeleton, PanelSkeleton, ChatSkeleton, FullScreenLoading, SettingsSkeleton } from './components/ui/Loading'
import { Modal } from './components/ui'
import { startupMetrics } from '@shared/utils/startupMetrics'
import { useEffect } from 'react'

startupMetrics.mark('app-module-loaded')

// 懒加载组件 - 按使用频率和大小分组
// 核心编辑区域
const Editor = lazy(() => import('./components/editor/Editor'))
const Sidebar = lazy(() => import('./components/sidebar').then(m => ({ default: m.Sidebar })))
const ChatPanel = lazy(() => import('./components/agent').then(m => ({ default: m.ChatPanel })))

// 面板组件
const TerminalPanel = lazy(() => import('./components/panels/TerminalPanel'))
const DebugPanel = lazy(() => import('./components/panels/DebugPanel'))
const ComposerPanel = lazy(() => import('./components/panels/ComposerPanel'))

// 对话框组件
const OnboardingWizard = lazy(() => import('./components/dialogs/OnboardingWizard'))
const SettingsModal = lazy(() => import('./components/settings/SettingsModal'))
const CommandPalette = lazy(() => import('./components/dialogs/CommandPalette'))
const KeyboardShortcuts = lazy(() => import('./components/dialogs/KeyboardShortcuts'))
const QuickOpen = lazy(() => import('./components/dialogs/QuickOpen'))
const AboutDialog = lazy(() => import('./components/dialogs/AboutDialog'))
const WelcomePage = lazy(() => import('./components/welcome/WelcomePage'))

// 暴露 store 给插件系统
window.__ADNIFY_STORE__ = { getState: () => useStore.getState() }

// Toast 初始化
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
    workspace,
    showSettings,
    activeSidePanel, showComposer, setShowComposer,
    sidebarWidth, setSidebarWidth, chatWidth, setChatWidth,
    showQuickOpen, setShowQuickOpen, showAbout, setShowAbout,
    showCommandPalette, setShowCommandPalette
  } = useStore()

  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)

  // 窗口标题
  useWindowTitle()

  // 文件监听
  useFileWatcher()

  // 应用初始化
  useAppInit({
    onInitialized: (result) => {
      setIsInitialized(true)
      if (result.shouldShowOnboarding) {
        setShowOnboarding(true)
      }
    }
  })

  // 全局快捷键
  useGlobalShortcuts()

  // 面板拖拽
  const { startResize: startSidebarResize } = useSidebarResize(setSidebarWidth)
  const { startResize: startChatResize } = useChatResize(setChatWidth)

  const handleCloseKeyboardShortcuts = useCallback(() => setShowKeyboardShortcuts(false), [])
  const handleCloseOnboarding = useCallback(() => setShowOnboarding(false), [])

  const hasWorkspace = workspace && workspace.roots.length > 0

  return (
    <div className="h-screen flex flex-col bg-transparent overflow-hidden text-text-primary selection:bg-accent/30 selection:text-white relative">
      <div className="relative z-10 flex flex-col h-full">
        <TitleBar />

        {hasWorkspace ? (
          <>
            <div className="flex-1 flex overflow-hidden">
              <ActivityBar />

              {activeSidePanel && (
                <div style={{ width: sidebarWidth }} className="flex-shrink-0 relative">
                  <Suspense fallback={<PanelSkeleton />}>
                    <Sidebar />
                  </Suspense>
                  <div
                    className="absolute top-0 right-0 w-1 h-full cursor-col-resize active:bg-accent transition-colors z-50 translate-x-[2px]"
                    onMouseDown={startSidebarResize}
                  />
                </div>
              )}

              <div className="flex-1 flex min-w-0 bg-background relative">
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                  <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
                    <ErrorBoundary>
                      <Suspense fallback={<EditorSkeleton />}>
                        <Editor />
                      </Suspense>
                    </ErrorBoundary>
                  </div>
                  <ErrorBoundary>
                    <Suspense fallback={null}>
                      <TerminalPanel />
                    </Suspense>
                  </ErrorBoundary>
                  <ErrorBoundary>
                    <Suspense fallback={null}>
                      <DebugPanel />
                    </Suspense>
                  </ErrorBoundary>
                </div>

                <div style={{ width: chatWidth }} className="flex-shrink-0 relative border-l border-border">
                  <div
                    className="absolute top-0 left-0 w-1 h-full cursor-col-resize active:bg-accent transition-colors z-50 -translate-x-[2px]"
                    onMouseDown={startChatResize}
                  />
                  <ErrorBoundary>
                    <Suspense fallback={<ChatSkeleton />}>
                      <ChatPanel />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </div>
            </div>

            <StatusBar />
          </>
        ) : (
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={<FullScreenLoading />}>
              <WelcomePage />
            </Suspense>
          </div>
        )}
      </div>

      {/* 模态框 */}
      {showSettings && (
        <Suspense fallback={<Modal isOpen onClose={() => {}} title="" size="5xl" noPadding><SettingsSkeleton /></Modal>}>
          <SettingsModal />
        </Suspense>
      )}
      {showCommandPalette && (
        <Suspense fallback={null}>
          <CommandPalette
            onClose={() => setShowCommandPalette(false)}
            onShowKeyboardShortcuts={() => {
              setShowCommandPalette(false)
              setShowKeyboardShortcuts(true)
            }}
          />
        </Suspense>
      )}
      {showKeyboardShortcuts && (
        <Suspense fallback={null}>
          <KeyboardShortcuts onClose={handleCloseKeyboardShortcuts} />
        </Suspense>
      )}
      {showQuickOpen && (
        <Suspense fallback={null}>
          <QuickOpen onClose={() => setShowQuickOpen(false)} />
        </Suspense>
      )}
      {showComposer && (
        <Suspense fallback={null}>
          <ComposerPanel onClose={() => setShowComposer(false)} />
        </Suspense>
      )}
      {showOnboarding && isInitialized && (
        <Suspense fallback={null}>
          <OnboardingWizard onComplete={handleCloseOnboarding} />
        </Suspense>
      )}
      {showAbout && (
        <Suspense fallback={null}>
          <AboutDialog onClose={() => setShowAbout(false)} />
        </Suspense>
      )}
      <GlobalConfirmDialog />
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <ToastInitializer />
      <GlobalErrorHandler>
        <ThemeManager>
          <AppContent />
        </ThemeManager>
      </GlobalErrorHandler>
    </ToastProvider>
  )
}
