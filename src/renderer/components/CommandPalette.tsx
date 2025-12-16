/**
 * 命令面板
 * 类似 VS Code 的 Ctrl+Shift+P
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react'
import {
  Search, FolderOpen, Settings, Terminal,
  MessageSquare, History, Trash2, RefreshCw, Save,
  X, Zap, Keyboard
} from 'lucide-react'
import { useStore } from '../store'
import { t } from '../i18n'

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
        flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors
        ${isSelected ? 'bg-editor-accent/20 text-editor-text' : 'text-editor-text-muted hover:bg-editor-hover'}
      `}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{command.label}</div>
        {command.description && (
          <div className="text-xs text-editor-text-muted truncate">{command.description}</div>
        )}
      </div>
      {command.shortcut && (
        <kbd className="px-2 py-0.5 text-xs font-mono bg-editor-bg border border-editor-border rounded">
          {command.shortcut}
        </kbd>
      )}
    </div>
  )
})

export default function CommandPalette({ onClose, onShowKeyboardShortcuts }: CommandPaletteProps) {
  const {
    setShowSettings,
    setTerminalVisible,
    terminalVisible,
    setChatMode,
    clearMessages,
    clearCheckpoints,
    workspacePath,
    activeFilePath,
    setInputPrompt,
    language,
  } = useStore()

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 定义所有命令
  const commands: Command[] = [
    {
      id: 'open-folder',
      label: 'Open Folder',
      description: 'Open a workspace folder',
      icon: FolderOpen,
      category: 'File',
      action: () => window.electronAPI.openFolder(),
      shortcut: 'Ctrl+O',
    },
    // AI Commands
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
        id: 'ai-test',
        label: 'Generate Tests',
        description: 'Generate unit tests for current file',
        icon: Zap,
        category: 'AI Helper',
        action: () => {
            if (activeFilePath) {
                setChatMode('chat')
                setInputPrompt(`Generate unit tests for ${activeFilePath}. Using Vitest/Jest.`)
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
    {
      id: 'save-file',
      label: 'Save File',
      description: 'Save the current file',
      icon: Save,
      category: 'File',
      action: () => {
        // 触发保存事件
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
      },
      shortcut: 'Ctrl+S',
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
      id: 'toggle-terminal',
      label: terminalVisible ? 'Hide Terminal' : 'Show Terminal',
      description: 'Toggle the terminal panel',
      icon: Terminal,
      category: 'View',
      action: () => setTerminalVisible(!terminalVisible),
      shortcut: 'Ctrl+`',
    },
    {
      id: 'chat-mode',
      label: 'Switch to Chat Mode',
      description: 'Use AI for conversation only',
      icon: MessageSquare,
      category: 'AI',
      action: () => setChatMode('chat'),
    },
    {
      id: 'agent-mode',
      label: 'Switch to Agent Mode',
      description: 'Enable AI to edit files and run commands',
      icon: Zap,
      category: 'AI',
      action: () => setChatMode('agent'),
    },
    {
      id: 'clear-chat',
      label: 'Clear Chat History',
      description: 'Remove all messages from the chat',
      icon: Trash2,
      category: 'AI',
      action: () => clearMessages(),
    },
    {
      id: 'clear-checkpoints',
      label: 'Clear All Checkpoints',
      description: 'Remove all saved checkpoints',
      icon: History,
      category: 'AI',
      action: () => clearCheckpoints(),
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
    {
      id: 'keyboard-shortcuts',
      label: 'Keyboard Shortcuts',
      description: 'View all keyboard shortcuts',
      icon: Keyboard,
      category: 'Help',
      action: () => onShowKeyboardShortcuts(),
      shortcut: '?',
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
      className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[15vh] z-50"
      onClick={onClose}
    >
      <div
        className="bg-editor-sidebar border border-editor-border rounded-xl shadow-2xl w-[500px] max-h-[60vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-editor-border">
          <Search className="w-5 h-5 text-editor-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('typeCommandOrSearch', language)}
            className="flex-1 bg-transparent text-editor-text placeholder-editor-text-muted focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded hover:bg-editor-hover transition-colors"
            >
              <X className="w-4 h-4 text-editor-text-muted" />
            </button>
          )}
        </div>

        {/* Command List */}
        <div ref={listRef} className="overflow-y-auto max-h-[calc(60vh-60px)]">
          {Object.entries(groupedCommands).map(([category, cmds]) => (
            <div key={category}>
              <div className="px-4 py-2 text-xs font-medium text-editor-text-muted bg-editor-bg/50 sticky top-0">
                {category}
              </div>
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
          ))}

          {flatCommands.length === 0 && (
            <div className="px-4 py-8 text-center text-editor-text-muted">
              {t('noCommandsFound', language)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
