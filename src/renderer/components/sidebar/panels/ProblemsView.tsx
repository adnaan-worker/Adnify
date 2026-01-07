/**
 * 问题面板 - 显示所有诊断错误
 */

import { api } from '@/renderer/services/electronAPI'
import { useState, useMemo } from 'react'
import { ChevronRight, FileText, AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react'
import { useStore } from '@store'
import type { LspDiagnostic } from '@shared/types'
import { useDiagnosticsStore } from '@services/diagnosticsStore'

export function ProblemsView() {
  const { openFile, setActiveFile, language } = useStore()
  
  // 从全局 store 获取诊断数据
  const diagnostics = useDiagnosticsStore(state => state.diagnostics)
  const errorCount = useDiagnosticsStore(state => state.errorCount)
  const warningCount = useDiagnosticsStore(state => state.warningCount)
  
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings'>('all')

  const toggleFile = (uri: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(uri)) next.delete(uri)
      else next.add(uri)
      return next
    })
  }

  const handleDiagnosticClick = async (uri: string, diag: LspDiagnostic) => {
    let filePath = uri
    if (uri.startsWith('file:///')) {
      filePath = uri.slice(8)
      filePath = decodeURIComponent(filePath)
      if (/^[a-zA-Z]:/.test(filePath)) {
        filePath = filePath.replace(/\//g, '\\')
      }
    }

    const content = await api.file.read(filePath)
    if (content !== null) {
      openFile(filePath, content)
      setActiveFile(filePath)

      window.dispatchEvent(
        new CustomEvent('editor:goto-line', {
          detail: {
            line: diag.range.start.line + 1,
            column: diag.range.start.character + 1,
          },
        })
      )
    }
  }

  // 过滤后的诊断
  const filteredDiagnostics = useMemo(() => {
    const result = new Map<string, LspDiagnostic[]>()
    diagnostics.forEach((diags, uri) => {
      const filtered = diags.filter((d) => {
        if (filter === 'errors') return d.severity === 1
        if (filter === 'warnings') return d.severity === 2
        return true
      })
      if (filtered.length > 0) result.set(uri, filtered)
    })
    return result
  }, [diagnostics, filter])

  const getSeverityIcon = (severity: number | undefined) => {
    if (severity === 1) return <AlertCircle className="w-3.5 h-3.5 text-status-error" />
    if (severity === 2) return <AlertTriangle className="w-3.5 h-3.5 text-status-warning" />
    return <Info className="w-3.5 h-3.5 text-blue-400" />
  }

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="h-10 px-3 flex items-center justify-between border-b border-border bg-transparent sticky top-0 z-10">
        <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider opacity-80">
          {language === 'zh' ? '问题' : 'Problems'}
        </span>
        <div className="flex items-center gap-2 text-[10px]">
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-status-error">
              <AlertCircle className="w-3 h-3" /> {errorCount}
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1 text-status-warning">
              <AlertTriangle className="w-3 h-3" /> {warningCount}
            </span>
          )}
        </div>
      </div>

      {/* 过滤器 */}
      <div className="px-3 py-2 border-b border-border-subtle flex gap-1">
        {(['all', 'errors', 'warnings'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-1 text-[10px] rounded transition-colors ${
              filter === f ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-surface-hover'
            }`}
          >
            {f === 'all'
              ? language === 'zh'
                ? '全部'
                : 'All'
              : f === 'errors'
                ? language === 'zh'
                  ? '错误'
                  : 'Errors'
                : language === 'zh'
                  ? '警告'
                  : 'Warnings'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filteredDiagnostics.size === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in select-none">
            <div className="w-12 h-12 bg-green-500/10 rounded-2xl flex items-center justify-center mb-3 border border-green-500/20 shadow-sm">
              <CheckCircle2 className="w-6 h-6 text-green-500" />
            </div>
            <p className="text-xs font-medium text-text-primary">
              {language === 'zh' ? '未发现问题' : 'No problems detected'}
            </p>
            <p className="text-[10px] text-text-muted mt-1 opacity-60">
              {language === 'zh' ? '代码看起来很棒！' : 'Your code looks great!'}
            </p>
          </div>
        ) : (
          Array.from(filteredDiagnostics.entries()).map(([uri, diags]) => {
            const fileName = uri.split(/[\\/]/).pop() || uri
            const isExpanded = expandedFiles.has(uri)

            return (
              <div key={uri} className="border-b border-border-subtle/50">
                <div
                  onClick={() => toggleFile(uri)}
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-hover"
                >
                  <ChevronRight
                    className={`w-3 h-3 text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  />
                  <FileText className="w-3.5 h-3.5 text-text-muted" />
                  <span className="text-xs text-text-secondary flex-1 truncate">{fileName}</span>
                  <span className="text-[10px] text-text-muted bg-surface-active px-1.5 rounded">{diags.length}</span>
                </div>

                {isExpanded && (
                  <div className="pb-1">
                    {diags.map((diag, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleDiagnosticClick(uri, diag)}
                        className="flex items-start gap-2 px-3 py-1.5 pl-8 cursor-pointer hover:bg-surface-hover group"
                      >
                        {getSeverityIcon(diag.severity)}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-text-primary truncate">{diag.message}</p>
                          <p className="text-[10px] text-text-muted">
                            {language === 'zh' ? '行' : 'Line'} {diag.range.start.line + 1}
                            {diag.source && ` • ${diag.source}`}
                            {diag.code && ` (${diag.code})`}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
