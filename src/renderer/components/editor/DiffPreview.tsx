/**
 * Diff 预览组件
 */
import { memo, useCallback, useState, useRef } from 'react'
import { X, Check, Columns, AlignJustify, ChevronDown, ChevronUp, Settings2 } from 'lucide-react'
import { t } from '@renderer/i18n'
import type { editor } from 'monaco-editor'
import { SafeDiffEditor } from './SafeDiffEditor'
import { getLanguage } from './utils/languageMap'
import type { DiffView } from '@store'

interface DiffPreviewProps {
  diff: DiffView
  isPending: boolean
  language: 'en' | 'zh'
  onClose: () => void
  onAccept?: () => void
  onReject?: () => void
  onChange?: (newContent: string) => void
}

export const DiffPreview = memo(function DiffPreview({
  diff,
  isPending,
  language,
  onClose,
  onAccept,
  onReject,
  onChange,
}: DiffPreviewProps) {
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split')
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)

  const handleClose = useCallback(() => {
    setTimeout(() => onClose(), 0)
  }, [onClose])

  const goToNextChange = useCallback(() => {
    if (diffEditorRef.current) {
      const changes = diffEditorRef.current.getLineChanges()
      if (!changes || changes.length === 0) return

      const modifiedEditor = diffEditorRef.current.getModifiedEditor()
      const position = modifiedEditor.getPosition()
      if (!position) return

      for (const change of changes) {
        if (change.modifiedStartLineNumber > position.lineNumber) {
          modifiedEditor.revealLineInCenter(change.modifiedStartLineNumber)
          modifiedEditor.setPosition({ lineNumber: change.modifiedStartLineNumber, column: 1 })
          return
        }
      }
      modifiedEditor.revealLineInCenter(changes[0].modifiedStartLineNumber)
      modifiedEditor.setPosition({ lineNumber: changes[0].modifiedStartLineNumber, column: 1 })
    }
  }, [])

  const goToPrevChange = useCallback(() => {
    if (diffEditorRef.current) {
      const changes = diffEditorRef.current.getLineChanges()
      if (!changes || changes.length === 0) return

      const modifiedEditor = diffEditorRef.current.getModifiedEditor()
      const position = modifiedEditor.getPosition()
      if (!position) return

      for (let i = changes.length - 1; i >= 0; i--) {
        const change = changes[i]
        // If the change is fully above the current cursor
        if (change.modifiedStartLineNumber < position.lineNumber && change.modifiedEndLineNumber < position.lineNumber) {
          modifiedEditor.revealLineInCenter(change.modifiedStartLineNumber)
          modifiedEditor.setPosition({ lineNumber: change.modifiedStartLineNumber, column: 1 })
          return
        }
      }
      const lastChange = changes[changes.length - 1]
      modifiedEditor.revealLineInCenter(lastChange.modifiedStartLineNumber)
      modifiedEditor.setPosition({ lineNumber: lastChange.modifiedStartLineNumber, column: 1 })
    }
  }, [])

  const handleEditorMount = (editor: editor.IStandaloneDiffEditor) => {
    diffEditorRef.current = editor
    const modifiedEditor = editor.getModifiedEditor()
    modifiedEditor.onDidChangeModelContent(() => {
      if (onChange) {
        onChange(modifiedEditor.getValue())
      }
    })
  }

  return (
    <div className="flex-1 flex flex-col w-full h-full bg-background animate-in fade-in duration-200">
      {/* 现代化的 Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface/30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-text-primary">
              {t('reviewChanges', language)}
            </span>
            {isPending && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded">
                {t('pending', language)}
              </span>
            )}
          </div>

          <div className="w-px h-4 bg-border mx-2" />

          {/* 视图切换 */}
          <div className="flex items-center bg-surface-hover rounded-md p-0.5">
            <button
              onClick={() => setViewMode('unified')}
              className={`p-1.5 rounded transition-all ${viewMode === 'unified' ? 'bg-background shadow-sm text-accent' : 'text-text-muted hover:text-text-primary'}`}
              title={t('unifiedView', language)}
            >
              <AlignJustify className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`p-1.5 rounded transition-all ${viewMode === 'split' ? 'bg-background shadow-sm text-accent' : 'text-text-muted hover:text-text-primary'}`}
              title={t('splitView', language)}
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="w-px h-4 bg-border mx-1" />

          {/* 导航与设置 */}
          <div className="flex items-center gap-1">
            <button
              onClick={goToPrevChange}
              className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded-md transition-colors"
              title={t('previousChange', language)}
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={goToNextChange}
              className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded-md transition-colors"
              title={t('nextChange', language)}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIgnoreWhitespace(!ignoreWhitespace)}
              className={`p-1.5 rounded transition-all ${ignoreWhitespace ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'}`}
              title={t('ignoreWhitespace', language)}
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isPending ? (
            <>
              <button
                onClick={onReject}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-status-error hover:bg-status-error/10 rounded-md transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                {t('rejectChanges', language)}
              </button>
              <button
                onClick={onAccept}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-status-success/10 text-status-success border border-status-success/20 hover:bg-status-success hover:text-white rounded-md transition-all"
              >
                <Check className="w-3.5 h-3.5" />
                {t('acceptChanges', language)}
              </button>
            </>
          ) : (
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-primary hover:bg-surface-active rounded-md transition-colors"
            >
              {t('closeMenu', language) || 'Close'}
            </button>
          )}
        </div>
      </div>

      {/* Monaco Diff Editor */}
      <div className="flex-1 relative">
        <SafeDiffEditor
          key={`diff-${diff.filePath}-${viewMode}-${ignoreWhitespace}`}
          language={getLanguage(diff.filePath)}
          original={diff.original}
          modified={diff.modified}
          onMount={handleEditorMount}
          options={{
            readOnly: false,
            renderSideBySide: viewMode === 'split',
            ignoreTrimWhitespace: ignoreWhitespace,
            renderMarginRevertIcon: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: 'on',
            glyphMargin: true,
            folding: true,
            lineDecorationsWidth: 20,
            lineNumbersMinChars: 3,
            wordWrap: 'on'
          }}
        />
      </div>
    </div>
  )
})
