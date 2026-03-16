/**
 * 增强版 DiffViewer
 * - 统一使用 Monaco 的 SafeDiffEditor
 * - 移除自研比对算法，依赖纯原生渲染
 * - 解决大文件卡顿和无语法高亮的遗留问题
 */

import { useState, useCallback, useMemo } from 'react'
import { X, Check, ChevronDown, ChevronUp, Copy, FileEdit, Columns, AlignJustify, Loader2 } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { getFileName } from '@shared/utils/pathUtils'
import { SafeDiffEditor } from './SafeDiffEditor'
import { getLanguage } from './utils/languageMap'
import { getEditorConfig } from '@renderer/settings'

interface DiffViewerProps {
  originalContent: string
  modifiedContent: string
  filePath: string
  onAccept: () => void
  onReject: () => void
  onClose?: () => void
  isStreaming?: boolean
  minimal?: boolean
}

export default function DiffViewer({
  originalContent,
  modifiedContent,
  filePath,
  onAccept,
  onReject,
  onClose,
  isStreaming = false,
  minimal = false,
}: DiffViewerProps) {
  const language = useStore(s => s.language)
  const [collapsed, setCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('unified')

  const fileName = getFileName(filePath) || filePath
  const editorConfig = useMemo(() => getEditorConfig(), [])

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(modifiedContent)
  }, [modifiedContent])

  const MonacoWrapper = (
    <div style={{ height: minimal ? '400px' : undefined }} className={`w-full border-t border-border-subtle bg-background ${!minimal ? 'flex-1 overflow-hidden' : ''}`}>
      <SafeDiffEditor
        language={getLanguage(filePath)}
        original={originalContent}
        modified={modifiedContent}
        options={{
          readOnly: true,
          renderSideBySide: viewMode === 'split',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: editorConfig.fontSize,
          fontFamily: editorConfig.fontFamily,
          lineNumbers: 'on',
          glyphMargin: false,
          folding: true,
          lineDecorationsWidth: 10,
          lineNumbersMinChars: 3,
          wordWrap: 'on'
        }}
      />
    </div>
  )

  if (minimal) {
    return (
      <div className="bg-background border border-border rounded-lg overflow-hidden flex flex-col">
        {/* Minimal Top Bar */}
        <div className="flex justify-between items-center px-3 py-2 bg-surface-active/30 border-b border-border-subtle">
          <span className="text-[11px] font-bold text-text-muted">{t('reviewChanges', language)}</span>
          <div className="flex items-center gap-1 bg-surface-hover rounded-md p-0.5">
            <button
              onClick={() => setViewMode('unified')}
              className={`p-1 rounded text-[10px] transition-colors ${viewMode === 'unified' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary'}`}
              title={t('unifiedView', language)}
            >
              <AlignJustify className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`p-1 rounded text-[10px] transition-colors ${viewMode === 'split' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary'}`}
              title={t('splitView', language)}
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {/* Monaco Viewer */}
        {MonacoWrapper}
      </div>
    )
  }

  return (
    <div className="bg-editor-sidebar border border-border rounded-xl shadow-xl flex flex-col h-full w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <FileEdit className="w-5 h-5 text-editor-accent" />
          <span className="font-medium text-text-primary">{fileName}</span>
          <div className="flex items-center gap-2 text-sm text-status-warning">
            {isStreaming && (
              <span className="animate-pulse flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('streaming', language)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-editor-hover rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('unified')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'unified' ? 'bg-editor-accent text-white' : 'text-text-primary-muted hover:text-text-primary'}`}
            >
              <AlignJustify className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'split' ? 'bg-editor-accent text-white' : 'text-text-primary-muted hover:text-text-primary'}`}
            >
              <Columns className="w-4 h-4" />
            </button>
          </div>
          <button onClick={copyToClipboard} className="p-2 rounded-lg hover:bg-editor-hover transition-colors" title={t('copyModified', language)}>
            <Copy className="w-4 h-4 text-text-primary-muted" />
          </button>
          <button onClick={() => setCollapsed(!collapsed)} className="p-2 rounded-lg hover:bg-editor-hover transition-colors">
            {collapsed ? <ChevronDown className="w-4 h-4 text-text-primary-muted" /> : <ChevronUp className="w-4 h-4 text-text-primary-muted" />}
          </button>
          {onClose && (
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-editor-hover transition-colors" title={t('closeMenu', language)}>
              <X className="w-4 h-4 text-text-primary-muted" />
            </button>
          )}
        </div>
      </div>

      {/* Diff Content */}
      <div className={`flex flex-col flex-1 overflow-hidden transition-all duration-300 ${collapsed ? 'hidden' : 'block'}`}>
        {MonacoWrapper}
        {/* Actions */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-background/50 flex-shrink-0">
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onReject}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-status-error hover:bg-status-error/10 transition-colors disabled:opacity-50"
              disabled={isStreaming}
            >
              <X className="w-4 h-4" />
              {t('rejectChanges', language)}
            </button>
            <button
              onClick={onAccept}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-status-success text-white hover:bg-status-success/80 transition-colors disabled:opacity-50"
              disabled={isStreaming}
            >
              <Check className="w-4 h-4" />
              {t('acceptChanges', language)}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
