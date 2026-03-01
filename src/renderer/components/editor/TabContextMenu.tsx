/**
 * Tab 右键菜单组件
 */

import { api } from '@/renderer/services/electronAPI'
import { useRef, useEffect } from 'react'
import { toast } from '../common/ToastProvider'
import { keybindingService } from '@services/keybindingService'

interface TabContextMenuProps {
  x: number
  y: number
  filePath: string
  onClose: () => void
  onCloseFile: (path: string) => void
  onCloseOthers: (path: string) => void
  onCloseAll: () => void
  onCloseToRight: (path: string) => void
  onSave: (path: string) => void
  isDirty: boolean
  language: string
}

export function TabContextMenu({
  x, y, filePath, onClose, onCloseFile, onCloseOthers, onCloseAll, onCloseToRight, onSave, isDirty, language
}: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const isZh = language === 'zh'

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (keybindingService.matches(e, 'editor.cancel')) onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const menuItems = [
    { label: isZh ? '关闭' : 'Close', action: () => onCloseFile(filePath), shortcut: 'Ctrl+W' },
    { label: isZh ? '关闭其他' : 'Close Others', action: () => onCloseOthers(filePath) },
    { label: isZh ? '关闭右侧' : 'Close to the Right', action: () => onCloseToRight(filePath) },
    { label: isZh ? '关闭全部' : 'Close All', action: () => onCloseAll() },
    { type: 'separator' as const },
    { label: isZh ? '保存' : 'Save', action: () => onSave(filePath), shortcut: 'Ctrl+S', disabled: !isDirty },
    { type: 'separator' as const },
    {
      label: isZh ? '复制路径' : 'Copy Path',
      action: () => {
        navigator.clipboard.writeText(filePath)
        toast.success(isZh ? '已复制路径' : 'Path Copied')
      }
    },
    {
      label: isZh ? '在资源管理器中显示' : 'Reveal in Explorer',
      action: () => api.file.showInFolder(filePath)
    },
    {
      label: isZh ? '在侧边栏中定位' : 'Reveal in Sidebar',
      action: () => window.dispatchEvent(new CustomEvent('explorer:reveal-file', { detail: { filePath } }))
    },
    { type: 'separator' as const },
    {
      label: isZh ? '在浏览器中打开' : 'Open in Browser',
      action: async () => {
        const success = await api.file.openInBrowser(filePath)
        if (!success) toast.error(isZh ? '打开失败' : 'Failed to open')
      }
    },
  ]

  return (
    <div
      ref={menuRef}
      className="fixed bg-background-secondary border border-border-subtle rounded-lg shadow-xl py-1 z-[9999] min-w-[180px]"
      style={{ left: x, top: y }}
    >
      {menuItems.map((item, index) =>
        item.type === 'separator' ? (
          <div key={index} className="h-px bg-border-subtle my-1" />
        ) : (
          <button
            key={index}
            onClick={() => { item.action?.(); onClose() }}
            disabled={item.disabled}
            className="w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="text-xs text-text-muted ml-4">{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  )
}
