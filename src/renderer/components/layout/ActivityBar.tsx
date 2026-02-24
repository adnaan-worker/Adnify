import { Files, Search, GitBranch, Settings, Sparkles, AlertCircle, ListTree, History, Brain } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import { useStore } from '@store'
import { t } from '@renderer/i18n'

export default function ActivityBar() {
  const { activeSidePanel, setActiveSidePanel, language, setShowSettings, setShowComposer } = useStore()

  const items = [
    { id: 'explorer', icon: Files, label: t('explorer', language) },
    { id: 'search', icon: Search, label: t('search', language) },
    { id: 'git', icon: GitBranch, label: 'Git' },
    { id: 'emotion', icon: Brain, label: language === 'zh' ? '情绪感知' : 'Mood' },
    { id: 'problems', icon: AlertCircle, label: language === 'zh' ? '问题' : 'Problems' },
    { id: 'outline', icon: ListTree, label: language === 'zh' ? '大纲' : 'Outline' },
    { id: 'history', icon: History, label: language === 'zh' ? '历史' : 'History' },
  ] as const

  return (
    <div className="w-[60px] bg-background-secondary/80 backdrop-blur-xl border-r border-border-subtle flex flex-col z-30 select-none items-center py-4">
      {/* Top Actions */}
      <div className="flex-1 flex flex-col w-full items-center gap-3">
        {items.map((item) => (
          <Tooltip key={item.id} content={item.label} side="right">
            <button
              onClick={() => setActiveSidePanel(activeSidePanel === item.id ? null : item.id)}
              className={`
                w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group relative
                ${activeSidePanel === item.id
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:text-text-primary hover:bg-surface-hover active:scale-95'}
              `}
            >
              {activeSidePanel === item.id && (
                <div className="absolute left-[-10px] top-1/2 -translate-y-1/2 w-[3px] h-6 bg-accent shadow-[0_0_8px_rgba(var(--accent)/0.6)] rounded-r-full" />
              )}
              <item.icon
                className={`w-[22px] h-[22px] transition-all duration-300 
                  ${activeSidePanel === item.id ? 'drop-shadow-[0_0_10px_rgba(var(--accent)/0.6)] scale-105' : 'opacity-70 group-hover:opacity-100 group-hover:scale-105'}
                `}
                strokeWidth={activeSidePanel === item.id ? 2 : 1.5}
              />
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Bottom Actions */}
      <div className="flex flex-col w-full items-center gap-3 pb-2">
        <Tooltip content={`${t('composer', language)} (Ctrl+Shift+I)`} side="right">
          <button
            onClick={() => setShowComposer(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover active:scale-95 transition-all duration-300 group"
          >
            <Sparkles className="w-[22px] h-[22px] opacity-70 group-hover:opacity-100 group-hover:text-accent transition-all group-hover:drop-shadow-[0_0_8px_rgba(var(--accent)/0.4)] group-hover:scale-105" strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content={t('settings', language)} side="right">
          <button
            onClick={() => setShowSettings(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover active:scale-95 transition-all duration-300 group"
          >
            <Settings className="w-[22px] h-[22px] opacity-70 group-hover:opacity-100 group-hover:rotate-45 transition-all duration-500" strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}