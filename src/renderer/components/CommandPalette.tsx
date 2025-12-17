/**
 * 命令面板
 * 类似 Cursor/VS Code 的中央控制枢纽
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react'
import {
  Search, FolderOpen, Settings, Terminal,
  MessageSquare, History, Trash2, RefreshCw, Save,
  X, Zap, Keyboard, Sparkles, ArrowRight
} from 'lucide-react'
import { useStore } from '@/renderer/store'
import { useAgent } from '@/renderer/hooks/useAgent'
import { t } from '@/renderer/i18n'

interface Command {
  id: string
  label: string
  description?: string
  icon: typeof Search
  category: string
  action: () => void
  shortcut?: string
}

interface CommandPaletteProps {
  onClose: () => void
  onShowKeyboardShortcuts: () => void
}

const CommandItem = memo(function CommandItem({
  command,
  isSelected,
  onSelect,
}: {
  command: Command
  isSelected: boolean
  onSelect: () => void
}) {
  const Icon = command.icon

  return (
    <div
      onClick={onSelect}
      className={`
        flex items-center gap-3 px-3 py-3 mx-2 rounded-lg cursor-pointer transition-all duration-200
        ${isSelected
          ? 'bg-accent/10 text-accent-foreground shadow-sm'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'}
      `}
    >
      <div className={`p-1.5 rounded-md ${isSelected ? 'bg-accent/20 text-accent' : 'bg-surface text-text-muted'}`}>
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className={`text-sm font-medium ${isSelected ? 'text-text-primary' : ''}`}>{command.label}</div>
        {command.description && (
          <div className="text-xs text-text-muted truncate opacity-80">{command.description}</div>
        )}
      </div>

      {command.shortcut && (
        <kbd className={`
          px-2 py-0.5 text-[10px] font-mono rounded border
          ${isSelected
            ? 'bg-background/50 border-accent/20 text-accent'
            : 'bg-surface border-border-subtle text-text-muted'}
        `}>
          {command.shortcut}
        </kbd>
      )}

      {isSelected && <ArrowRight className="w-3 h-3 text-accent animate-pulse ml-2" />}
    </div>
  )
})

export default function CommandPalette({ onClose, onShowKeyboardShortcuts }: CommandPaletteProps) {
  const {
    setShowSettings,
    setTerminalVisible,
    terminalVisible,
    setChatMode,
    clearCheckpoints,
    workspacePath,
    activeFilePath,
    setInputPrompt,
    language,
  } = useStore()

  const { clearMessages } = useAgent()

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 定义所有命令
  const commands: Command[] = [
    // AI Actions (Priority)
    {
      id: 'ai-chat',
      label: 'Ask AI...',
      description: 'Start a new chat conversation',
      icon: Sparkles,
      category: 'AI',
      action: () => {
        setChatMode('chat')
        if (query) setInputPrompt(query)
      }
    },
    {
      id: 'ai-explain',
      label: 'Explain Current File',
      description: 'Ask AI to explain the active file',
      icon: MessageSquare,
      category: 'AI Helper',
      action: () => {
        if (activeFilePath) {
          setChatMode('chat')
          setInputPrompt(`Explain the file ${activeFilePath} in detail.`)
        }
      }
    },
    {
      id: 'ai-refactor',
      label: 'Refactor File',
      description: 'Ask AI to suggest refactoring improvements',
      icon: Zap,
      category: 'AI Helper',
      action: () => {
        if (activeFilePath) {
          setChatMode('chat')
          setInputPrompt(`Analyze ${activeFilePath} and suggest refactoring improvements for readability and performance.`)
        }
      }
    },
    {
      id: 'ai-fix',
      label: 'Fix Bugs',
      description: 'Ask AI to find and fix bugs in current file',
      icon: Zap,
      category: 'AI Helper',
      action: () => {
        if (activeFilePath) {
          setChatMode('chat')
          setInputPrompt(`Find potential bugs in ${activeFilePath} and provide fixes.`)
        }
      }
    },

    // File Operations
    {
      id: 'open-folder',
      label: 'Open Folder',
      description: 'Open a workspace folder',
      icon: FolderOpen,
      category: 'File',
      action: () => window.electronAPI.openFolder(),
      shortcut: 'Ctrl+O',
    },
    {
      id: 'save-file',
      label: 'Save File',
      description: 'Save the current file',
      icon: Save,
      category: 'File',
      action: () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
      },
      shortcut: 'Ctrl+S',
    },
    {
      id: 'refresh-files',
      label: 'Refresh File Explorer',
      description: 'Reload the file tree',
      icon: RefreshCw,
      category: 'File',
      action: async () => {
        if (workspacePath) {
          const files = await window.electronAPI.readDir(workspacePath)
          if (files) {
            useStore.getState().setFiles(files)
          }
        }
      },
    },

    // View & Settings
    {
      id: 'toggle-terminal',
      label: terminalVisible ? 'Hide Terminal' : 'Show Terminal',
      description: 'Toggle the terminal panel',
      icon: Terminal,
      category: 'View',
      action: () => setTerminalVisible(!terminalVisible),
      shortcut: 'Ctrl+`',
    },
    {
      id: 'settings',
      label: 'Open Settings',
      description: 'Configure API keys and preferences',
      icon: Settings,
      category: 'Preferences',
      action: () => setShowSettings(true),
      shortcut: 'Ctrl+,',
    },
    {
      id: 'keyboard-shortcuts',
      label: 'Keyboard Shortcuts',
      description: 'View all keyboard shortcuts',
      icon: Keyboard,
      category: 'Help',
      action: () => onShowKeyboardShortcuts(),
      shortcut: '?',
    },

    // AI Tools
    {
      id: 'clear-chat',
      label: 'Clear Chat History',
      description: 'Remove all messages from the chat',
      icon: Trash2,
      category: 'AI Tools',
      action: () => clearMessages(),
    },
    {
      id: 'clear-checkpoints',
      label: 'Clear All Checkpoints',
      description: 'Remove all saved checkpoints',
      icon: History,
      category: 'AI Tools',
      action: () => clearCheckpoints(),
    },
  ]

  // 过滤命令
  const filteredCommands = commands.filter(cmd => {
    if (!query) return true
    const searchStr = `${cmd.label} ${cmd.description || ''} ${cmd.category}`.toLowerCase()
    return searchStr.includes(query.toLowerCase())
  })

  // 按类别分组
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) {
      acc[cmd.category] = []
    }
    acc[cmd.category].push(cmd)
    return acc
  }, {} as Record<string, Command[]>)

  // 扁平化用于键盘导航
  const flatCommands = Object.values(groupedCommands).flat()

  // 键盘导航
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, flatCommands.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (flatCommands[selectedIndex]) {
          flatCommands[selectedIndex].action()
          onClose()
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [flatCommands, selectedIndex, onClose])

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 重置选中索引
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // 滚动到选中项
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      selectedEl?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  let commandIndex = 0

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[15vh] z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="
            w-[600px] max-h-[60vh] flex flex-col
            bg-background/90 backdrop-blur-xl 
            border border-border/50 rounded-xl shadow-2xl shadow-black/50
            overflow-hidden animate-slide-up
        "
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-4 px-5 py-4 border-b border-border/40">
          <Search className="w-5 h-5 text-accent" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('typeCommandOrSearch', language)}
            className="flex-1 bg-transparent text-lg text-text-primary placeholder-text-muted focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded-full hover:bg-surface-hover transition-colors"
            >
              <X className="w-4 h-4 text-text-muted" />
            </button>
          )}
        </div>

        {/* Command List */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-2 custom-scrollbar">
          {Object.entries(groupedCommands).map(([category, cmds]) => (
            <div key={category} className="mb-2">
              <div className="px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted/60 sticky top-0 bg-background/95 backdrop-blur z-10">
                {category}
              </div>
              <div className="space-y-0.5">
                {cmds.map((cmd) => {
                  const idx = commandIndex++
                  return (
                    <div key={cmd.id} data-index={idx}>
                      <CommandItem
                        command={cmd}
                        isSelected={idx === selectedIndex}
                        onSelect={() => {
                          cmd.action()
                          onClose()
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {flatCommands.length === 0 && (
            <div className="px-4 py-12 text-center text-text-muted flex flex-col items-center gap-2">
              <Sparkles className="w-8 h-8 opacity-20" />
              <p>{t('noCommandsFound', language)}</p>
            </div>
          )}
        </div>

        {/* Footer Hint */}
        <div className="px-5 py-2 bg-surface/30 border-t border-border/30 text-[10px] text-text-muted flex justify-between items-center">
          <div className="flex gap-3">
            <span><kbd className="font-mono bg-surface/50 px-1 rounded">↑↓</kbd> to navigate</span>
            <span><kbd className="font-mono bg-surface/50 px-1 rounded">Enter</kbd> to select</span>
          </div>
          <div>
            <span>Adnify AI</span>
          </div>
        </div>
      </div>
    </div>
  )
}
