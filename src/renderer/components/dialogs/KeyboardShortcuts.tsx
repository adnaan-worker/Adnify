/**
 * 快捷键帮助面板
 */

import { memo } from 'react'
import { Keyboard, X } from 'lucide-react'
import { formatShortcutKeys } from '@services/keybindingService'

interface ShortcutItem {
  keys: string[]
  description: string
  category: string
}

const shortcuts: ShortcutItem[] = [
  // 文件操作
  { keys: ['Ctrl', 'S'], description: 'Save file', category: 'File' },
  { keys: ['Ctrl', 'W'], description: 'Close file', category: 'File' },
  { keys: ['Ctrl', 'O'], description: 'Open folder', category: 'File' },

  // 编辑
  { keys: ['Ctrl', 'Z'], description: 'Undo', category: 'Edit' },
  { keys: ['Ctrl', 'Shift', 'Z'], description: 'Redo', category: 'Edit' },
  { keys: ['Ctrl', 'C'], description: 'Copy', category: 'Edit' },
  { keys: ['Ctrl', 'V'], description: 'Paste', category: 'Edit' },
  { keys: ['Ctrl', 'X'], description: 'Cut', category: 'Edit' },
  { keys: ['Ctrl', 'A'], description: 'Select all', category: 'Edit' },
  { keys: ['Ctrl', 'F'], description: 'Find', category: 'Edit' },
  { keys: ['Ctrl', 'H'], description: 'Replace', category: 'Edit' },

  // 导航
  { keys: ['Ctrl', 'G'], description: 'Go to line', category: 'Navigation' },
  { keys: ['Ctrl', 'P'], description: 'Quick open file', category: 'Navigation' },
  { keys: ['Ctrl', 'Tab'], description: 'Switch tab', category: 'Navigation' },

  // AI 助手
  { keys: ['Ctrl', 'K'], description: 'Inline edit with AI', category: 'AI Assistant' },
  { keys: ['Ctrl', 'Enter'], description: 'Send message', category: 'AI Assistant' },
  { keys: ['Escape'], description: 'Stop generation', category: 'AI Assistant' },
  { keys: ['@'], description: 'Reference file in chat', category: 'AI Assistant' },

  // 视图
  { keys: ['Ctrl', '`'], description: 'Toggle terminal', category: 'View' },
  { keys: ['Ctrl', 'B'], description: 'Toggle sidebar', category: 'View' },
  { keys: ['Ctrl', ','], description: 'Open settings', category: 'View' },
]

interface KeyboardShortcutsProps {
  onClose: () => void
}

const ShortcutKey = memo(function ShortcutKey({ keyName }: { keyName: string }) {
  return (
    <kbd className="px-2 py-1 text-xs font-mono bg-background border border-border rounded shadow-sm">
      {keyName}
    </kbd>
  )
})

export default function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {

  // 按类别分组
  const categories = shortcuts.reduce((acc, shortcut) => {
    if (!acc[shortcut.category]) {
      acc[shortcut.category] = []
    }
    acc[shortcut.category].push(shortcut)
    return acc
  }, {} as Record<string, ShortcutItem[]>)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-editor-sidebar border border-border rounded-xl shadow-2xl w-[600px] max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Keyboard className="w-5 h-5 text-editor-accent" />
            <h2 className="text-lg font-semibold text-text-primary">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-editor-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-primary-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
          <div className="grid grid-cols-2 gap-6">
            {Object.entries(categories).map(([category, items]) => (
              <div key={category}>
                <h3 className="text-sm font-medium text-editor-accent mb-3">{category}</h3>
                <div className="space-y-2">
                  {items.map((shortcut, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-1.5"
                    >
                      <span className="text-sm text-text-primary-muted">
                        {shortcut.description}
                      </span>
                      <div className="flex items-center gap-1">
                        {formatShortcutKeys(shortcut.keys).map((key, keyIdx) => (
                          <span key={keyIdx} className="flex items-center">
                            <ShortcutKey keyName={key} />
                            {keyIdx < shortcut.keys.length - 1 && (
                              <span className="mx-1 text-text-primary-muted">+</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border bg-background/50">
          <p className="text-xs text-text-primary-muted text-center">
            Press <ShortcutKey keyName="?" /> to toggle this panel
          </p>
        </div>
      </div>
    </div>
  )
}
