/**
 * 欢迎页面 - 无工作区时显示
 * 
 * 修复：响应式布局，解决小窗口遮挡问题
 */
import { useState, useEffect } from 'react'
import { FolderOpen, History, Folder, Plus, Settings } from 'lucide-react'
import { api } from '@/renderer/services/electronAPI'
import { workspaceManager } from '@/renderer/services/WorkspaceManager'
import { useStore } from '@/renderer/store'
import { logger } from '@utils/Logger'
import { toast } from '@components/common/ToastProvider'
import { Logo } from '../common/Logo'
import { getFileName } from '@shared/utils/pathUtils'

interface RecentWorkspace {
  path: string
  name: string
}

export default function WelcomePage() {
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
  const { setShowSettings } = useStore()

  useEffect(() => {
    loadRecentWorkspaces()
  }, [])

  const loadRecentWorkspaces = async () => {
    try {
      const recent = await api.workspace.getRecent()
      setRecentWorkspaces(
        recent.slice(0, 8).map((path: string) => ({
          path,
          name: getFileName(path),
        }))
      )
    } catch (e) {
      logger.ui.error('[WelcomePage] Failed to load recent workspaces:', e)
    }
  }

  const handleOpenFolder = async () => {
    const result = await api.file.openFolder()
    if (result && typeof result === 'string') {
      await workspaceManager.openFolder(result)
    }
  }

  const handleOpenWorkspace = async () => {
    const result = await api.workspace.open()
    if (result && !('redirected' in result)) {
      await workspaceManager.switchTo(result)
    }
  }

  const handleOpenRecent = async (path: string) => {
    try {
      await workspaceManager.openFolder(path)
    } catch (e) {
      toast.error('文件夹不存在，已从列表移除', getFileName(path))
      loadRecentWorkspaces()
    }
  }

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar bg-transparent">
      <div className="min-h-full flex flex-col items-center justify-center p-8 lg:p-12 animate-scale-in">

        {/* Header Section */}
        <div className="text-center mb-12 flex-shrink-0">
          <div className="inline-flex items-center justify-center mb-6 relative group">
            <div className="absolute inset-0 bg-accent/20 blur-[40px] rounded-full group-hover:bg-accent/30 transition-all duration-1000" />
            <Logo className="w-20 h-20 relative z-10" glow />
          </div>
          <h1 className="text-4xl font-bold text-text-primary tracking-tight">Adnify</h1>
          <p className="text-text-muted mt-2 font-medium opacity-60">AI-Native Code Editor</p>
        </div>

        {/* Main Actions Grid */}
        <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">

          {/* Start Section */}
          <div className="space-y-6">
            <h2 className="text-[11px] font-black text-text-muted uppercase tracking-[0.2em] pl-1 opacity-50">Start</h2>
            <div className="grid gap-3">
              <button
                onClick={handleOpenFolder}
                className="flex items-center gap-4 p-5 rounded-[24px] bg-surface/40 backdrop-blur-xl border border-text-primary/[0.03] hover:border-accent/30 hover:bg-surface-active/60 text-left transition-all duration-300 group hover:-translate-y-[2px] hover:shadow-[0_12px_40px_-12px_rgba(var(--accent)/0.2)]"
              >
                <div className="text-text-muted/60 group-hover:text-accent transition-colors duration-300 group-hover:scale-110">
                  <FolderOpen className="w-7 h-7" strokeWidth={1.5} />
                </div>
                <div>
                  <div className="text-sm font-bold text-text-primary transition-colors">打开文件夹</div>
                  <div className="text-[11px] text-text-muted mt-1 font-medium opacity-70">Open a local project folder</div>
                </div>
              </button>

              <button
                onClick={handleOpenWorkspace}
                className="flex items-center gap-4 p-5 rounded-[24px] bg-surface/40 backdrop-blur-xl border border-text-primary/[0.03] hover:border-purple-500/30 hover:bg-surface-active/60 text-left transition-all duration-300 group hover:-translate-y-[2px] hover:shadow-[0_12px_40px_-12px_rgba(168,85,247,0.2)]"
              >
                <div className="text-text-muted/60 group-hover:text-purple-400 transition-colors duration-300 group-hover:scale-110">
                  <Folder className="w-7 h-7" strokeWidth={1.5} />
                </div>
                <div>
                  <div className="text-sm font-bold text-text-primary transition-colors">打开工作区</div>
                  <div className="text-[11px] text-text-muted mt-1 font-medium opacity-70">Open workspace file (.adnify)</div>
                </div>
              </button>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => api.window.new()}
                  className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-text-primary/[0.03] border border-transparent hover:border-border text-xs font-bold text-text-secondary hover:text-text-primary transition-all"
                >
                  <Plus className="w-4 h-4" /> 新建窗口
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-text-primary/[0.03] border border-transparent hover:border-border text-xs font-bold text-text-secondary hover:text-text-primary transition-all"
                >
                  <Settings className="w-4 h-4" /> 设置
                </button>
              </div>
            </div>
          </div>

          {/* Recent Section */}
          <div className="space-y-6">
            <h2 className="text-[11px] font-black text-text-muted uppercase tracking-[0.2em] flex items-center gap-2 pl-1 opacity-50">
              <History className="w-3.5 h-3.5" /> Recent
            </h2>
            <div className="space-y-1 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {recentWorkspaces.length > 0 ? (
                recentWorkspaces.map((workspace) => (
                  <button
                    key={workspace.path}
                    onClick={() => handleOpenRecent(workspace.path)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-all duration-200 group"
                  >
                    <div className="p-1.5 rounded-lg bg-text-primary/[0.03] text-text-muted group-hover:text-accent group-hover:bg-accent/10 transition-colors">
                      <Folder className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold truncate">{workspace.name}</div>
                      <div className="text-[10px] text-text-muted truncate opacity-50 font-mono">{workspace.path}</div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="py-12 border-2 border-dashed border-border rounded-2xl flex flex-col items-center justify-center opacity-40">
                  <Folder className="w-8 h-8 mb-2" />
                  <span className="text-xs font-medium">No recent items</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Hint */}
        <div className="mt-16 text-center flex-shrink-0">
          <p className="text-[11px] text-text-muted font-bold uppercase tracking-widest opacity-40">
            Press <kbd className="mx-1.5 px-2 py-1 bg-surface-muted border border-border-subtle rounded-md text-text-primary font-mono text-[10px] shadow-sm">Ctrl+Shift+O</kbd> for commands
          </p>
        </div>
      </div>
    </div>
  )
}
