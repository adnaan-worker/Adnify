import { api } from '@/renderer/services/electronAPI'
import { Minus, Square, X, Search, HelpCircle } from 'lucide-react'
import { useStore } from '@store'
import { Logo } from '../common/Logo'
import WorkspaceDropdown from './WorkspaceDropdown'
import UpdateIndicator from './UpdateIndicator'

// 检测是否为 Mac 平台
const isMac = typeof navigator !== 'undefined' && (
  navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
  (navigator as any).userAgentData?.platform?.toUpperCase().indexOf('MAC') >= 0
)

export default function TitleBar() {
  const { setShowQuickOpen, setShowAbout } = useStore()
  return (
    <div className="h-12 flex items-center justify-between px-0 drag-region select-none bg-background/40 backdrop-blur-md z-50 border-b border-border/50">

      {/* Left - Branding & Workspace */}
      <div className={`
        flex items-center gap-4 h-full transition-all duration-300
        ${isMac ? 'pl-[76px] pr-4' : 'pl-4 pr-4'}
      `}>
        {/* Logo - Clickable to show about */}
        <div
          onClick={() => setShowAbout(true)}
          className="no-drag flex items-center gap-2.5 opacity-80 hover:opacity-100 transition-all cursor-pointer group"
        >
          <div className="relative w-7 h-7 flex items-center justify-center bg-text-primary/[0.03] rounded-lg border border-text-primary/[0.05] group-hover:border-accent/20 group-hover:bg-accent/5 transition-all shadow-sm">
            <Logo className="w-4 h-4 transition-all duration-500 group-hover:drop-shadow-[0_0_8px_rgba(var(--accent)/0.6)]" glow />
          </div>
          <span className="text-[11px] font-black text-text-primary tracking-[0.2em] font-sans uppercase leading-tight hidden xl:block opacity-60 group-hover:opacity-100 transition-all">
            ADNIFY
          </span>
        </div>

        {/* Workspace Selector */}
        <div className="no-drag">
          <WorkspaceDropdown />
        </div>
      </div>

      {/* Center - Command Palette (Mac style center, Windows fluid) */}
      <div className="flex-1 flex justify-center min-w-0 px-4">
        <div
          onClick={() => setShowQuickOpen(true)}
          className="no-drag flex items-center gap-3 px-3 h-[30px] w-full max-w-[480px] rounded-lg bg-text-primary/[0.04] border border-text-primary/[0.03] hover:bg-text-primary/[0.08] hover:border-text-primary/[0.08] shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] transition-all duration-200 cursor-pointer group"
        >
          <Search className="w-3.5 h-3.5 text-text-muted opacity-80 group-hover:text-accent transition-colors" />
          <span className="text-xs text-text-muted opacity-80 group-hover:text-text-primary transition-colors truncate">
            Search files, commands...
          </span>
          <div className="flex items-center gap-1 ml-auto shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
            <kbd className="hidden sm:inline-flex items-center justify-center min-w-[20px] h-5 bg-text-inverted/[0.1] border border-text-primary/5 rounded px-1.5 text-[10px] text-text-muted font-mono font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              {isMac ? '⌘' : 'Ctrl'} P
            </kbd>
          </div>
        </div>
      </div>

      {/* Right - Window Controls & Actions */}
      <div className="flex items-center justify-end h-full pr-2 gap-1">
        <div className="no-drag flex items-center gap-1 h-full mr-2">
          {/* Update Indicator */}
          <UpdateIndicator />

          {/* About Button (Hidden on Mac if needed, or kept for consistency) */}
          <button
            onClick={() => setShowAbout(true)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-all"
            title="About"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>

        {/* Windows Controls */}
        {!isMac && (
          <div className="no-drag flex items-center h-full pl-2 border-l border-border-subtle">
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => api.window.minimize()}
                className="w-9 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-all group"
              >
                <Minus className="w-4 h-4 opacity-70 group-hover:opacity-100" />
              </button>
              <button
                onClick={() => api.window.maximize()}
                className="w-9 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-all group"
              >
                <Square className="w-3 h-3 opacity-70 group-hover:opacity-100" />
              </button>
              <button
                onClick={() => api.window.close()}
                className="w-9 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-red-500/90 transition-all group"
              >
                <X className="w-4 h-4 opacity-70 group-hover:opacity-100" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
