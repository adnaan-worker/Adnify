/**
 * 聊天面板头部组件
 */
import { History, Trash2 } from 'lucide-react'
import { useStore } from '@store'
import { WorkMode } from '@/renderer/modes/types'
import { t } from '@renderer/i18n'

interface ChatHeaderProps {
  chatMode: WorkMode
  setChatMode: (mode: WorkMode) => void
  showSessions: boolean
  setShowSessions: (show: boolean) => void
  onClearMessages: () => void
}

export default function ChatHeader({
  chatMode,
  setChatMode,
  showSessions,
  setShowSessions,
  onClearMessages,
}: ChatHeaderProps) {
  const { language } = useStore()

  return (
    <div className="h-12 flex items-center justify-between px-4 border-b border-border bg-background/50 backdrop-blur-sm z-20">
      <div className="flex bg-surface rounded-lg p-0.5 border border-border-subtle">
        <button
          onClick={() => setChatMode('chat')}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${chatMode === 'chat'
            ? 'bg-background text-text-primary shadow-sm'
            : 'text-text-muted hover:text-text-primary'
            }`}
        >
          Chat
        </button>
        <button
          onClick={() => setChatMode('agent')}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${chatMode === 'agent'
            ? 'text-accent bg-accent/10 shadow-sm'
            : 'text-text-muted hover:text-text-primary'
            }`}
        >
          Agent
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => setShowSessions(!showSessions)}
          className={`p-1.5 rounded-md hover:bg-surface-hover transition-colors ${showSessions ? 'text-accent' : 'text-text-muted'
            }`}
          title={t('history', language)}
        >
          <History className="w-4 h-4" />
        </button>
        <button
          onClick={onClearMessages}
          className="p-1.5 rounded-md hover:bg-surface-hover hover:text-status-error transition-colors"
          title={t('clearChat', language)}
        >
          <Trash2 className="w-4 h-4 text-text-muted" />
        </button>
      </div>
    </div>
  )
}
