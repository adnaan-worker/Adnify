/**
 * 编辑器面包屑导航组件
 */
import { memo } from 'react'
import { Home, ChevronRight, AlertTriangle } from 'lucide-react'
import { getPathSeparator } from '@shared/utils/pathUtils'
import { getLargeFileWarning } from '@renderer/services/largeFileService'
import type { LargeFileInfo } from '@renderer/services/largeFileService'

interface EditorBreadcrumbsProps {
  filePath: string
  largeFileInfo: LargeFileInfo | null
  language: 'en' | 'zh'
}

function getBreadcrumbs(path: string) {
  const sep = getPathSeparator(path)
  const parts = path.split(sep === '\\' ? /\\/ : /\//)
  return parts.slice(-4)
}

export const EditorBreadcrumbs = memo(function EditorBreadcrumbs({
  filePath,
  largeFileInfo,
  language,
}: EditorBreadcrumbsProps) {
  const breadcrumbs = getBreadcrumbs(filePath)

  return (
    <div className="h-7 flex items-center px-4 bg-background/50 border-b border-border/30 backdrop-blur-sm text-[11px] text-text-muted select-none">
      <div className="flex items-center gap-1 hover:text-text-primary transition-colors cursor-pointer">
        <Home className="w-3 h-3" />
      </div>
      <span className="mx-1 opacity-30">/</span>
      {breadcrumbs.map((part, index, arr) => (
        <div key={`${part}-${index}`} className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`hover:text-text-primary transition-colors cursor-pointer px-1.5 py-0.5 rounded-sm ${index === arr.length - 1 ? 'text-text-primary font-medium bg-surface-hover/50' : ''}`}>
            {part}
          </span>
          {index < arr.length - 1 && <ChevronRight className="w-3 h-3 opacity-30" />}
        </div>
      ))}

      {largeFileInfo?.isLarge && (
        <div className="ml-auto flex items-center gap-1 text-status-warning">
          <AlertTriangle className="w-3 h-3" />
          <span>{getLargeFileWarning(largeFileInfo, language)}</span>
        </div>
      )}
    </div>
  )
})
