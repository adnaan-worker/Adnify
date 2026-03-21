import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  X, 
  History, 
  GitBranch, 
  Search, 
  Trash2, 
  MessageSquare, 
  Clock,
  Check,
  Edit2,
  Plus
} from 'lucide-react'
import { useAgentStore, selectBranches, selectActiveBranch, selectIsOnBranch } from '@/renderer/agent'
import { useAgent, useAllThreads } from '@/renderer/hooks/useAgent'
import { Button } from '../ui'
import { Tooltip } from '../ui/Tooltip'
import { ChatThread, getMessageText } from '@/renderer/agent/types'
import { Branch } from '@/renderer/agent/store/slices/branchSlice'

// 辅助 import Store
import { useStore } from '@store'
import { getRelativeTime } from '@shared/utils'

type Tab = 'history' | 'branches'

interface ConversationSidebarProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: Tab
}

export default function ConversationSidebar({ isOpen, onClose, initialTab = 'history' }: ConversationSidebarProps) {
  const language = useStore(s => s.language)
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [searchQuery, setSearchQuery] = useState('')

  // Sync initialTab when isOpen changes
  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab)
      setSearchQuery('')
    }
  }, [isOpen, initialTab])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/20 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          
          {/* Sidebar */}
          <motion.div
            initial={{ x: '100%', opacity: 0.5 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0.5 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute top-0 right-0 bottom-0 w-[340px] bg-background/95 backdrop-blur-2xl border-l border-border/40 z-50 shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 select-none">
              <h2 className="text-base font-semibold text-text-primary tracking-tight">
                {language === 'zh' ? '对话管理' : 'Conversation'}
              </h2>
              <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full hover:bg-surface/80 text-text-muted hover:text-text-primary transition-colors">
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Tabs - Modern Segmented Control */}
            <div className="px-5 pt-4 pb-2">
               <div className="flex p-1 bg-surface/50 rounded-lg select-none border border-border/20">
                <button
                  onClick={() => setActiveTab('history')}
                  className={`relative flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all duration-200 z-10 ${
                    activeTab === 'history' 
                      ? 'text-text-primary' 
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {activeTab === 'history' && (
                    <motion.div 
                      layoutId="activeTabBg"
                      className="absolute inset-0 bg-background shadow-sm rounded-md border border-border/50 -z-10"
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <History className="w-3.5 h-3.5" />
                  {language === 'zh' ? '历史记录' : 'History'}
                </button>
                <button
                  onClick={() => setActiveTab('branches')}
                  className={`relative flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all duration-200 z-10 ${
                    activeTab === 'branches' 
                      ? 'text-text-primary' 
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {activeTab === 'branches' && (
                    <motion.div 
                      layoutId="activeTabBg"
                      className="absolute inset-0 bg-background shadow-sm rounded-md border border-border/50 -z-10"
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <GitBranch className="w-3.5 h-3.5" />
                  {language === 'zh' ? '分支' : 'Branches'}
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="px-5 py-2">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted/70 group-focus-within:text-accent transition-colors" />
                <input 
                  type="text"
                  placeholder={language === 'zh' ? '搜索...' : 'Search...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-8 text-xs bg-surface/30 border border-border/30 rounded-lg focus:outline-none focus:border-accent/30 focus:bg-surface/50 transition-all placeholder:text-text-muted/40"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary hover:bg-black/10 rounded-full transition-all"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 pb-4 pt-2">
              {activeTab === 'history' ? (
                <HistoryList searchQuery={searchQuery} onClose={onClose} language={language} />
              ) : (
                <BranchList searchQuery={searchQuery} onClose={onClose} language={language} />
              )}
            </div>

            {/* Footer Action */}
            {activeTab === 'history' && (
              <div className="p-4 border-t border-border/30 bg-surface/10 backdrop-blur-sm">
                <Button 
                  className="w-full justify-center gap-2 bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/20 h-10 rounded-xl transition-transform active:scale-[0.98]"
                  onClick={() => {
                    const { createThread } = useAgentStore.getState()
                    createThread()
                    onClose()
                  }}
                >
                  <Plus className="w-4 h-4" />
                  {language === 'zh' ? '新对话' : 'New Chat'}
                </Button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function HistoryList({ searchQuery, onClose, language }: { searchQuery: string, onClose: () => void, language: string }) {
  const { currentThreadId, switchThread, deleteThread } = useAgent()
  const allThreads = useAllThreads()

  const filteredThreads = useMemo(() => {
    return allThreads.filter(thread => {
      if (!searchQuery) return true
      const firstMsg = thread.messages.find(m => m.role === 'user')
      const text = firstMsg ? getMessageText(firstMsg.content) : ''
      return text.toLowerCase().includes(searchQuery.toLowerCase())
    })
  }, [allThreads, searchQuery])

  if (filteredThreads.length === 0) {
    return <EmptyState icon={History} text={language === 'zh' ? '无历史记录' : 'No history found'} />
  }

  return (
    <div className="space-y-1.5">
      {filteredThreads.map(thread => (
        <ThreadItem 
          key={thread.id} 
          thread={thread} 
          isActive={currentThreadId === thread.id}
          language={language}
          onSelect={() => {
            switchThread(thread.id)
            onClose()
          }}
          onDelete={() => deleteThread(thread.id)}
        />
      ))}
    </div>
  )
}

function ThreadItem({ thread, isActive, language, onSelect, onDelete }: { 
  thread: ChatThread, 
  isActive: boolean, 
  language: string,
  onSelect: () => void, 
  onDelete: () => void 
}) {
  const firstUserMsg = thread.messages.find(m => m.role === 'user')
  const preview = firstUserMsg ? getMessageText(firstUserMsg.content).slice(0, 60) : 'New chat'
  const timeStr = getRelativeTime(thread.lastModified, language)

  return (
    <div 
      className={`group relative flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all border overflow-hidden ${
        isActive 
          ? 'bg-accent/5 border-accent/20 shadow-sm shadow-accent/5' 
          : 'bg-transparent border-transparent hover:bg-surface/40 hover:border-border/40'
      }`}
      onClick={onSelect}
    >
      {/* Active Indicator (Left Strip) */}
      {isActive && (
        <div className="absolute left-0 top-3 bottom-3 w-[3px] bg-accent rounded-r-full" />
      )}

      <div className={`mt-0.5 shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
        isActive ? 'bg-accent/20 text-accent' : 'bg-surface/50 text-text-muted group-hover:bg-surface group-hover:text-text-primary'
      }`}>
        <MessageSquare className="w-4 h-4" />
      </div>
      
      <div className="flex-1 min-w-0 overflow-hidden pt-0.5">
        <div className="flex items-center justify-between gap-2">
          <h4 className={`text-sm font-medium truncate pr-6 ${isActive ? 'text-accent' : 'text-text-primary'}`}>
            {preview || 'New Chat'}
          </h4>
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-[10px] text-text-muted/70 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {timeStr}
          </span>
          <span className="text-[10px] text-text-muted/50">
            {thread.messages.length} msgs
          </span>
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="absolute right-2 top-2 p-1.5 rounded-lg text-text-muted/60 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-500 transition-all scale-90 hover:scale-100"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function BranchList({ searchQuery, onClose, language }: { searchQuery: string, onClose: () => void, language: string }) {
  const branches = useAgentStore(selectBranches)
  const activeBranch = useAgentStore(selectActiveBranch)
  const isOnBranch = useAgentStore(selectIsOnBranch)
  const switchBranch = useAgentStore(state => state.switchBranch)
  const switchToMainline = useAgentStore(state => state.switchToMainline)
  const deleteBranch = useAgentStore(state => state.deleteBranch)
  const renameBranch = useAgentStore(state => state.renameBranch)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const handleStartEdit = (branch: Branch) => {
    setEditingId(branch.id)
    setEditName(branch.name)
  }

  const handleSaveEdit = () => {
    if (editingId && editName.trim()) {
      renameBranch(editingId, editName.trim())
    }
    setEditingId(null)
  }

  const filteredBranches = useMemo(() => {
    return branches.filter(b => 
      !searchQuery || b.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [branches, searchQuery])

  return (
    <div className="space-y-4 px-1">
      {/* Mainline */}
      {!searchQuery && (
        <div 
          onClick={() => {
            switchToMainline()
            onClose()
          }}
          className={`relative p-3 rounded-xl border transition-all flex items-center gap-3 cursor-pointer group overflow-hidden ${
            !isOnBranch 
              ? 'bg-accent/5 border-accent/20 shadow-sm shadow-accent/5' 
              : 'bg-surface/20 border-border/40 hover:bg-surface/40 hover:border-border/60'
          }`}
        >
          {/* Active Indicator */}
          {!isOnBranch && (
            <div className="absolute left-0 top-3 bottom-3 w-[3px] bg-accent rounded-r-full" />
          )}

          <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
            !isOnBranch ? 'bg-accent/20 text-accent' : 'bg-surface/80 text-text-muted group-hover:text-text-primary'
          }`}>
             <GitBranch className="w-4 h-4 stroke-[1.5]" />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className={`text-sm font-semibold tracking-tight ${
                !isOnBranch ? 'text-accent' : 'text-text-primary'
              }`}>
                {language === 'zh' ? '主线对话' : 'Main Thread'}
              </span>
              {!isOnBranch && <Check className="w-3.5 h-3.5 text-accent" />}
            </div>
            <p className="text-[11px] text-text-muted/80 mt-0.5 truncate">
              {language === 'zh' ? '原始对话流' : 'Original conversation flow'}
            </p>
          </div>
        </div>
      )}

      {/* Branches */}
      <div className="space-y-2">
        {filteredBranches.length > 0 && (
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider px-2 opacity-70 flex items-center gap-2">
             <GitBranch className="w-3 h-3" />
             {language === 'zh' ? '分支列表' : 'Your Branches'} ({filteredBranches.length})
          </p>
        )}
        
        {filteredBranches.map(branch => {
          const isActive = activeBranch?.id === branch.id
          return (
            <div
              key={branch.id}
              className={`group relative p-3 rounded-xl border transition-all cursor-pointer overflow-hidden ${
                isActive
                  ? 'bg-accent/5 border-accent/20 shadow-sm shadow-accent/5'
                  : 'bg-transparent border-transparent hover:bg-surface/40 hover:border-border/40'
              }`}
            >
              {/* Active Indicator */}
              {isActive && (
                <div className="absolute left-0 top-3 bottom-3 w-[3px] bg-accent rounded-r-full" />
              )}

              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                  isActive ? 'bg-accent/20 text-accent' : 'bg-surface/50 text-text-muted group-hover:bg-surface group-hover:text-text-primary'
                }`}>
                  <GitBranch className="w-4 h-4 stroke-[1.5]" />
                </div>

                <div className="flex-1 min-w-0" onClick={() => {
                  switchBranch(branch.id)
                  onClose()
                }}>
                  {editingId === branch.id ? (
                     <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          className="w-full bg-surface text-sm px-2 py-1 rounded border border-accent/50 focus:outline-none"
                          onClick={e => e.stopPropagation()}
                        />
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-green-400 hover:bg-green-500/10" onClick={(e) => {
                          e.stopPropagation()
                          handleSaveEdit()
                        }}>
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                     </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium truncate ${
                          isActive ? 'text-accent' : 'text-text-primary'
                        }`}>
                          {branch.name}
                        </span>
                        {isActive && (
                          <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-text-muted/70">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {getRelativeTime(branch.createdAt, language)}
                        </span>
                        <span>•</span>
                        <span>{branch.messages.length} msgs</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute right-2 top-2 bg-background/50 backdrop-blur-sm rounded-lg">
                   {editingId !== branch.id && (
                     <>
                        <Tooltip content="Rename">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation()
                              handleStartEdit(branch)
                            }}
                            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-white/5 transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                        <Tooltip content="Delete">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteBranch(branch.id)
                            }}
                            className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                     </>
                   )}
                </div>
              </div>
            </div>
          )
        })}
        
        {filteredBranches.length === 0 && (
           <EmptyState 
             icon={GitBranch} 
             text={language === 'zh' ? '暂无分支' : 'No branches found'} 
             subText={language === 'zh' ? '在消息上点击"重新生成"可创建分支' : 'Click "Regenerate" on messages to create branches'}
           />
        )}
      </div>
    </div>
  )
}

function EmptyState({ icon: Icon, text, subText }: { icon: any, text: string, subText?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-text-muted opacity-50 select-none">
      <div className="w-16 h-16 rounded-full bg-surface/50 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 stroke-[1.5]" />
      </div>
      <p className="text-sm font-medium">{text}</p>
      {subText && <p className="text-xs mt-1.5 text-center max-w-[200px] leading-relaxed opacity-70">{subText}</p>}
    </div>
  )
}
