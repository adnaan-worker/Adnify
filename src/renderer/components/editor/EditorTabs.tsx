/**
 * 编辑器标签栏组件
 */
import { memo } from 'react'
import { X, AlertCircle, AlertTriangle, RefreshCw, FileX } from 'lucide-react'
import { getFileName } from '@shared/utils/pathUtils'
import { useAgentStore } from '@renderer/agent'
import type { OpenFile } from '@store'

interface EditorTabsProps {
  openFiles: OpenFile[]
  activeFilePath: string | null
  onSelectFile: (path: string) => void
  onCloseFile: (path: string) => void
  onContextMenu: (e: React.MouseEvent, filePath: string) => void
  lintErrorCount: number
  lintWarningCount: number
  isLinting: boolean
  onRunLint: () => void
}

/**
 * 获取 tab 显示名称
 */
function getTabDisplayName(filePath: string): string {
  return getFileName(filePath)
}

export const EditorTabs = memo(function EditorTabs({
  openFiles,
  activeFilePath,
  onSelectFile,
  onCloseFile,
  onContextMenu,
  lintErrorCount,
  lintWarningCount,
  isLinting,
  onRunLint,
}: EditorTabsProps) {
  // 获取计划数据
  const plans = useAgentStore(state => state.plans)

  return (
    <div className="h-9 flex items-center bg-background border-b border-border overflow-x-auto custom-scrollbar select-none">
      {openFiles.map((file) => {
        const isActive = file.path === activeFilePath

        // 计算显示名称
        let fileName = getTabDisplayName(file.path)

        // 如果是计划文件，尝试显示计划名称
        if (file.path.includes('/.adnify/plan/') && file.path.endsWith('.json')) {
          const planId = fileName.replace('.json', '')
          const plan = plans.find(p => p.id === planId)
          if (plan) {
            fileName = `📋 ${plan.name}`
          }
        }

        return (
          <div
            key={file.path}
            className={`
              group relative flex items-center gap-2 px-4 h-full min-w-[120px] max-w-[200px] cursor-pointer transition-all duration-200 border-r border-border
              ${isActive
                ? 'bg-transparent text-text-primary font-medium'
                : 'bg-transparent text-text-muted hover:bg-white/5 hover:text-text-primary'}
              ${file.isDeleted ? 'opacity-60' : ''}
            `}
            onClick={() => onSelectFile(file.path)}
            onContextMenu={(e) => {
              e.preventDefault()
              onContextMenu(e, file.path)
            }}
          >
            {isActive && (
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-accent shadow-[0_0_10px_rgba(var(--accent)/0.8)] z-10" />
            )}

            {/* 已删除文件图标 */}
            {file.isDeleted && (
              <span title="文件已被删除">
                <FileX className="w-3.5 h-3.5 text-status-error flex-shrink-0" />
              </span>
            )}

            <span className={`text-[13px] truncate flex-1 ${file.isDeleted ? 'line-through text-text-muted' : ''}`}>{fileName}</span>

            <div
              className="flex items-center justify-center w-5 h-5 rounded-lg hover:bg-white/10 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                onCloseFile(file.path)
              }}
            >
              {file.isDirty ? (
                <div className="w-2 h-2 rounded-full bg-accent group-hover:hidden" />
              ) : null}
              <X className={`w-3.5 h-3.5 ${file.isDirty ? 'hidden group-hover:block' : 'opacity-0 group-hover:opacity-100'} transition-opacity`} />
            </div>
          </div>
        )
      })}

      {/* Lint 状态 */}
      {activeFilePath && (
        <div className="ml-auto flex items-center gap-2 px-3 flex-shrink-0 h-full border-l border-border bg-transparent">
          {(lintErrorCount > 0 || lintWarningCount > 0) && (
            <div className="flex items-center gap-2 text-xs mr-2">
              {lintErrorCount > 0 && (
                <span className="flex items-center gap-1 text-status-error" title="Errors">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {lintErrorCount}
                </span>
              )}
              {lintWarningCount > 0 && (
                <span className="flex items-center gap-1 text-status-warning" title="Warnings">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {lintWarningCount}
                </span>
              )}
            </div>
          )}
          <button
            onClick={onRunLint}
            disabled={isLinting}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50 group"
            title="Run lint check"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-text-muted group-hover:text-text-primary ${isLinting ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}
    </div>
  )
})
