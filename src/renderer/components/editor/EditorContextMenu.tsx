/**
 * 编辑器自定义右键菜单组件
 * 完全国际化支持
 */
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@store'
import { api } from '@/renderer/services/electronAPI'
import { t, TranslationKey } from '@renderer/i18n'
import { getIncomingCalls, getOutgoingCalls, lspUriToPath } from '@renderer/services/lspService'
import { getFileName } from '@shared/utils/pathUtils'
import type { editor } from 'monaco-editor'
import { logger } from '@shared/utils/Logger'

// 支持 Call Hierarchy 的语言（只有支持函数/方法调用的语言才有意义）
const CALL_HIERARCHY_SUPPORTED_LANGUAGES = [
  'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
  'python', 'go', 'rust', 'java', 'csharp', 'cpp', 'c'
]

interface MenuItem {
  id: string
  labelKey: TranslationKey
  shortcut?: string
  action: () => void
  divider?: boolean
  disabled?: boolean
  hidden?: boolean
}

interface CallHierarchyItem {
  from?: {
    name: string
    uri: string
    range?: {
      start: { line: number; character: number }
      end?: { line: number; character: number }
    }
  }
  to?: {
    name: string
    uri: string
    range?: {
      start: { line: number; character: number }
      end?: { line: number; character: number }
    }
  }
}

interface CallHierarchyResult {
  type: 'callers' | 'callees'
  items: Array<{
    name: string
    uri: string
    line: number
    character: number
  }>
}

interface EditorContextMenuProps {
  x: number
  y: number
  editor: editor.IStandaloneCodeEditor
  onClose: () => void
}

export default function EditorContextMenu({ x, y, editor, onClose }: EditorContextMenuProps) {
  const { language, activeFilePath, openFile, setActiveFile } = useStore()
  const menuRef = useRef<HTMLDivElement>(null)
  const [callHierarchyResult, setCallHierarchyResult] = useState<CallHierarchyResult | null>(null)
  const [loading, setLoading] = useState(false)

  // 获取当前编辑器语言
  const editorLanguage = editor.getModel()?.getLanguageId() || 'plaintext'
  const supportsCallHierarchy = CALL_HIERARCHY_SUPPORTED_LANGUAGES.includes(editorLanguage)

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (callHierarchyResult) {
          setCallHierarchyResult(null)
        } else {
          onClose()
        }
      }
    }

    // 监听右键菜单事件（防止在其他地方右键时不关闭）
    const handleContextMenu = () => {
      onClose()
    }
    
    // 延迟添加监听，避免右键点击时立即触发关闭
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside, true)
      document.addEventListener('click', handleClickOutside, true)
      document.addEventListener('contextmenu', handleContextMenu, true)
    }, 0)
    document.addEventListener('keydown', handleKeyDown)
    
    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('click', handleClickOutside, true)
      document.removeEventListener('contextmenu', handleContextMenu, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, callHierarchyResult])

  // 调整菜单位置，防止超出屏幕
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      
      if (x + rect.width > viewportWidth) {
        menuRef.current.style.left = `${viewportWidth - rect.width - 10}px`
      }
      if (y + rect.height > viewportHeight) {
        menuRef.current.style.top = `${viewportHeight - rect.height - 10}px`
      }
    }
  }, [x, y, callHierarchyResult])

  const runAction = (actionId: string) => {
    // 先聚焦编辑器，某些 action（如 quickOutline）需要编辑器处于焦点状态
    editor.focus()
    // 使用 setTimeout 确保焦点已设置
    setTimeout(() => {
      editor.getAction(actionId)?.run()
    }, 0)
    onClose()
  }

  // 剪贴板操作 - 使用原生 API
  const handleCut = async () => {
    const selection = editor.getSelection()
    const model = editor.getModel()
    if (selection && model && !selection.isEmpty()) {
      const text = model.getValueInRange(selection)
      await navigator.clipboard.writeText(text)
      editor.executeEdits('cut', [{
        range: selection,
        text: '',
        forceMoveMarkers: true
      }])
    }
    onClose()
  }

  const handleCopy = async () => {
    const selection = editor.getSelection()
    const model = editor.getModel()
    if (selection && model && !selection.isEmpty()) {
      const text = model.getValueInRange(selection)
      await navigator.clipboard.writeText(text)
    }
    onClose()
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        editor.focus()
        const selection = editor.getSelection()
        if (selection) {
          editor.executeEdits('paste', [{
            range: selection,
            text: text,
            forceMoveMarkers: true
          }])
        }
      }
    } catch (e) {
      logger.ui.error('Paste failed:', e)
    }
    onClose()
  }

  // 获取当前光标位置
  const getPosition = () => {
    const position = editor.getPosition()
    return position ? { line: position.lineNumber - 1, character: position.column - 1 } : null
  }

  // 查找调用者
  const handleFindCallers = async () => {
    if (!activeFilePath) return
    const pos = getPosition()
    if (!pos) return

    setLoading(true)
    try {
      const results = await getIncomingCalls(activeFilePath, pos.line, pos.character)
      if (results && results.length > 0) {
        setCallHierarchyResult({
          type: 'callers',
          items: results.map((r: CallHierarchyItem) => ({
            name: r.from?.name || 'Unknown',
            uri: r.from?.uri || '',
            line: r.from?.range?.start?.line || 0,
            character: r.from?.range?.start?.character || 0,
          })),
        })
      } else {
        // 显示空结果（可能是光标不在函数上，或者没有调用者）
        setCallHierarchyResult({ type: 'callers', items: [] })
      }
    } catch (err) {
      logger.lsp.error('[Call Hierarchy] Failed to get incoming calls:', err)
      setCallHierarchyResult({ type: 'callers', items: [] })
    } finally {
      setLoading(false)
    }
  }

  // 查找被调用者
  const handleFindCallees = async () => {
    if (!activeFilePath) return
    const pos = getPosition()
    if (!pos) return

    setLoading(true)
    try {
      const results = await getOutgoingCalls(activeFilePath, pos.line, pos.character)
      if (results && results.length > 0) {
        setCallHierarchyResult({
          type: 'callees',
          items: results.map((r: CallHierarchyItem) => ({
            name: r.to?.name || 'Unknown',
            uri: r.to?.uri || '',
            line: r.to?.range?.start?.line || 0,
            character: r.to?.range?.start?.character || 0,
          })),
        })
      } else {
        // 显示空结果（可能是光标不在函数上，或者函数没有调用其他函数）
        setCallHierarchyResult({ type: 'callees', items: [] })
      }
    } catch (err) {
      logger.lsp.error('[Call Hierarchy] Failed to get outgoing calls:', err)
      setCallHierarchyResult({ type: 'callees', items: [] })
    } finally {
      setLoading(false)
    }
  }

  // 跳转到调用位置
  const handleJumpToCall = async (item: CallHierarchyResult['items'][0]) => {
    const filePath = lspUriToPath(item.uri)
    if (filePath) {
      const content = await api.file.read(filePath)
      if (content === null) return
      openFile(filePath, content)
      setActiveFile(filePath)
      // 延迟设置光标位置，等待编辑器加载
      setTimeout(() => {
        editor.setPosition({ lineNumber: item.line + 1, column: item.character + 1 })
        editor.revealLineInCenter(item.line + 1)
      }, 100)
    }
    onClose()
  }

  const menuItems: MenuItem[] = [
    // 导航
    { id: 'goto-def', labelKey: 'ctxGotoDefinition', shortcut: 'F12', action: () => runAction('editor.action.revealDefinition') },
    { id: 'find-refs', labelKey: 'ctxFindReferences', shortcut: 'Shift+F12', action: () => runAction('editor.action.goToReferences') },
    { id: 'goto-symbol', labelKey: 'ctxGotoSymbol', shortcut: 'Ctrl+Shift+O', action: () => runAction('editor.action.quickOutline') },
    { id: 'find-callers', labelKey: 'ctxFindCallers', action: handleFindCallers, disabled: !supportsCallHierarchy },
    { id: 'find-callees', labelKey: 'ctxFindCallees', action: handleFindCallees, divider: true, disabled: !supportsCallHierarchy },
    // 编辑
    { id: 'rename', labelKey: 'ctxRename', shortcut: 'F2', action: () => runAction('editor.action.rename') },
    { id: 'change-all', labelKey: 'ctxChangeAll', shortcut: 'Ctrl+F2', action: () => runAction('editor.action.changeAll') },
    { id: 'format', labelKey: 'ctxFormat', shortcut: 'Shift+Alt+F', action: () => runAction('editor.action.formatDocument'), divider: true },
    // 剪贴板
    { id: 'cut', labelKey: 'ctxCut', shortcut: 'Ctrl+X', action: handleCut },
    { id: 'copy', labelKey: 'ctxCopy', shortcut: 'Ctrl+C', action: handleCopy },
    { id: 'paste', labelKey: 'ctxPaste', shortcut: 'Ctrl+V', action: handlePaste, divider: true },
    // 查找
    { id: 'find', labelKey: 'ctxFind', shortcut: 'Ctrl+F', action: () => runAction('actions.find') },
    { id: 'replace', labelKey: 'ctxReplace', shortcut: 'Ctrl+H', action: () => runAction('editor.action.startFindReplaceAction'), divider: true },
    // 其他
    { id: 'comment', labelKey: 'ctxToggleComment', shortcut: 'Ctrl+/', action: () => runAction('editor.action.commentLine') },
    { id: 'delete-line', labelKey: 'ctxDeleteLine', shortcut: 'Ctrl+Shift+K', action: () => runAction('editor.action.deleteLines') },
    { id: 'select-next', labelKey: 'ctxSelectNext', shortcut: 'Ctrl+D', action: () => runAction('editor.action.addSelectionToNextFindMatch') },
  ]

  // 渲染 Call Hierarchy 结果
  if (callHierarchyResult) {
    const title = callHierarchyResult.type === 'callers' 
      ? t('ctxFindCallers', language) 
      : t('ctxFindCallees', language)
    
    return (
      <div
        ref={menuRef}
        className="fixed z-50 bg-surface border border-border-subtle rounded-lg shadow-xl py-1 min-w-[280px] max-w-[400px] select-none"
        style={{ left: x, top: y }}
      >
        <div className="px-3 py-2 text-sm font-medium text-text-primary border-b border-border-subtle flex items-center justify-between">
          <span>{title}</span>
          <button 
            className="text-text-muted hover:text-text-primary text-xs"
            onClick={() => setCallHierarchyResult(null)}
          >
            ← Back
          </button>
        </div>
        {callHierarchyResult.items.length === 0 ? (
          <div className="px-3 py-2 text-sm text-text-muted">
            No results found
          </div>
        ) : (
          <div className="max-h-[300px] overflow-y-auto">
            {callHierarchyResult.items.map((item, index) => (
              <button
                key={index}
                className="w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-surface-hover flex flex-col gap-0.5 transition-colors"
                onClick={() => handleJumpToCall(item)}
              >
                <span className="font-medium">{item.name}</span>
                <span className="text-xs text-text-muted truncate">
                  {getFileName(lspUriToPath(item.uri))}:{item.line + 1}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-surface border border-border-subtle rounded-lg shadow-xl py-1 min-w-[220px] select-none"
      style={{ left: x, top: y }}
    >
      {loading && (
        <div className="absolute inset-0 bg-surface/80 flex items-center justify-center rounded-lg">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {menuItems.filter(item => !item.hidden).map((item, index, filteredItems) => (
        <div key={item.id}>
          <button
            className={`w-full px-3 py-1.5 text-left text-sm flex items-center justify-between gap-4 transition-colors ${
              item.disabled 
                ? 'text-text-muted/50 cursor-not-allowed' 
                : 'text-text-primary hover:bg-surface-hover'
            }`}
            onClick={item.disabled ? undefined : item.action}
            disabled={item.disabled}
          >
            <span>{t(item.labelKey, language)}</span>
            {item.shortcut && (
              <span className="text-xs text-text-muted opacity-60">{item.shortcut}</span>
            )}
          </button>
          {item.divider && index < filteredItems.length - 1 && (
            <div className="my-1 border-t border-border-subtle" />
          )}
        </div>
      ))}
    </div>
  )
}
