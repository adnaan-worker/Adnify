import { Minus, Square, X, Command, Search } from 'lucide-react'
import { useStore } from '../store'
import { Logo } from './Logo'

export default function TitleBar() {
  return (
    <div className="h-10 bg-background flex items-center justify-between px-3 drag-region select-none border-b border-border-subtle z-50">
      
      {/* Left Spacer / Logo */}
      <div className="flex items-center gap-3 no-drag w-1/3 pl-2 opacity-90 hover:opacity-100 transition-opacity cursor-default">
          <Logo className="w-5 h-5" glow />
          <span className="text-sm font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 tracking-wider font-sans">ADNIFY</span>
      </div>

      {/* Center - Command Palette Trigger */}
      <div className="flex-1 flex justify-center no-drag">
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-surface/50 border border-border-subtle hover:border-accent/30 hover:bg-surface hover:shadow-sm transition-all cursor-pointer group w-80 text-xs">
            <Search className="w-3.5 h-3.5 text-text-muted group-hover:text-accent transition-colors" />
            <span className="text-text-muted group-hover:text-text-primary transition-colors">Search files...</span>
            <div className="flex items-center gap-1 ml-auto">
                <kbd className="hidden sm:inline-block font-mono bg-background border border-border-subtle rounded px-1.5 text-[10px] text-text-muted">Ctrl P</kbd>
            </div>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center justify-end gap-2 no-drag w-1/3">
        <button
          onClick={() => window.electronAPI.minimize()}
          className="p-1.5 rounded-md hover:bg-surface-hover transition-colors text-text-muted hover:text-text-primary"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => window.electronAPI.maximize()}
          className="p-1.5 rounded-md hover:bg-surface-hover transition-colors text-text-muted hover:text-text-primary"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => window.electronAPI.close()}
          className="p-1.5 rounded-md hover:bg-status-error hover:text-white transition-colors text-text-muted"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
