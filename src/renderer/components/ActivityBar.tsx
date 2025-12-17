import { Files, Search, GitBranch, Settings, Sparkles, AlertCircle, ListTree } from 'lucide-react'
import { useStore } from '../store'
import { t } from '../i18n'

export default function ActivityBar() {
  const { activeSidePanel, setActiveSidePanel, language, setShowSettings, setShowComposer } = useStore()

  const items = [
    { id: 'explorer', icon: Files, label: t('explorer', language) },
    { id: 'search', icon: Search, label: t('search', language) },
    { id: 'git', icon: GitBranch, label: 'Git' },
    { id: 'problems', icon: AlertCircle, label: language === 'zh' ? '问题' : 'Problems' },
    { id: 'outline', icon: ListTree, label: language === 'zh' ? '大纲' : 'Outline' },
  ] as const

  return (
    <div className="w-[50px] bg-background/80 backdrop-blur-xl flex flex-col items-center py-3 border-r border-white/5 z-30">
      {/* Top Actions */}
      <div className="flex-1 flex flex-col gap-3 w-full px-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveSidePanel(activeSidePanel === item.id ? null : item.id)}
            className={`
              w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 group relative
              ${activeSidePanel === item.id
                ? 'bg-accent/10 text-accent shadow-sm shadow-accent/10'
                : 'text-text-muted hover:text-text-primary hover:bg-white/5'}
            `}
            title={item.label}
          >
            <item.icon className={`w-5 h-5 transition-transform duration-300 ${activeSidePanel === item.id ? 'scale-110' : 'group-hover:scale-110'}`} strokeWidth={1.5} />

            {/* Active Indicator - Dot style */}
            {activeSidePanel === item.id && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-3 bg-accent rounded-r-full" />
            )}
          </button>
        ))}
      </div>

      {/* Bottom Actions */}
      <div className="flex flex-col gap-3 w-full px-2 mb-2">
        <button
          onClick={() => setShowComposer(true)}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-white/5 transition-all duration-300 group"
          title={`${t('composer', language)} (Ctrl+Shift+I)`}
        >
          <Sparkles className="w-5 h-5 group-hover:text-accent transition-colors" strokeWidth={1.5} />
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-white/5 transition-all duration-300 group"
          title={t('settings', language)}
        >
          <Settings className="w-5 h-5 group-hover:rotate-45 transition-transform duration-500" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}
