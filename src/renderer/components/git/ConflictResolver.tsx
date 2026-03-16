/**
 * Git 冲突解决组件
 * 提供三方合并视图和冲突解决操作
 */

import { api } from '@/renderer/services/electronAPI'
import { useState, useEffect, useCallback } from 'react'
import { GitMerge, Check, X, ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import { useStore } from '@store'
import { t, type TranslationKey } from '@renderer/i18n'
import { gitService } from '@renderer/services/gitService'
import { toast } from '@components/common/ToastProvider'
import { Button } from '@components/ui'
import { getFileName } from '@shared/utils/pathUtils'

interface ConflictMarker {
  startLine: number
  endLine: number
  oursStart: number
  oursEnd: number
  theirsStart: number
  theirsEnd: number
  baseStart?: number
  baseEnd?: number
}

interface ConflictResolverProps {
  filePath: string
  onResolved: () => void
  onCancel: () => void
}

/**
 * 解析冲突标记
 */
function parseConflicts(content: string): ConflictMarker[] {
  const lines = content.split('\n')
  const conflicts: ConflictMarker[] = []
  
  let i = 0
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      const startLine = i
      let oursEnd = i
      let baseStart: number | undefined
      let baseEnd: number | undefined
      let theirsStart = i
      let endLine = i
      
      // 查找 ours 部分结束
      while (i < lines.length && !lines[i].startsWith('|||||||') && !lines[i].startsWith('=======')) {
        i++
      }
      oursEnd = i - 1
      
      // 检查是否有 base 部分 (diff3 格式)
      if (lines[i]?.startsWith('|||||||')) {
        baseStart = i + 1
        i++
        while (i < lines.length && !lines[i].startsWith('=======')) {
          i++
        }
        baseEnd = i - 1
      }
      
      // 查找 theirs 部分
      if (lines[i]?.startsWith('=======')) {
        theirsStart = i + 1
        i++
        while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
          i++
        }
        endLine = i
      }
      
      conflicts.push({
        startLine,
        endLine,
        oursStart: startLine + 1,
        oursEnd,
        theirsStart,
        theirsEnd: endLine - 1,
        baseStart,
        baseEnd,
      })
    }
    i++
  }
  
  return conflicts
}

/**
 * 提取冲突区域的内容
 */
function extractConflictContent(content: string, marker: ConflictMarker): {
  ours: string
  theirs: string
  base?: string
} {
  const lines = content.split('\n')
  
  return {
    ours: lines.slice(marker.oursStart, marker.oursEnd + 1).join('\n'),
    theirs: lines.slice(marker.theirsStart, marker.theirsEnd + 1).join('\n'),
    base: marker.baseStart !== undefined && marker.baseEnd !== undefined
      ? lines.slice(marker.baseStart, marker.baseEnd + 1).join('\n')
      : undefined,
  }
}

export function ConflictResolver({ filePath, onResolved, onCancel }: ConflictResolverProps) {
  const language = useStore(s => s.language)
  const [content, setContent] = useState<string>('')
  const [conflicts, setConflicts] = useState<ConflictMarker[]>([])
  const [currentConflict, setCurrentConflict] = useState(0)
  const [resolvedContent, setResolvedContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)

  const tt = useCallback((key: string) => t(key as TranslationKey, language), [language])

  // 加载文件内容
  useEffect(() => {
    const loadFile = async () => {
      setIsLoading(true)
      try {
        const fileContent = await api.file.read(filePath)
        if (fileContent) {
          setContent(fileContent)
          setResolvedContent(fileContent)
          setConflicts(parseConflicts(fileContent))
        }
      } catch (e) {
        toast.error('Failed to load file')
      } finally {
        setIsLoading(false)
      }
    }
    loadFile()
  }, [filePath])

  // 选择 ours 版本
  const acceptOurs = useCallback(() => {
    if (conflicts.length === 0) return
    
    const marker = conflicts[currentConflict]
    const { ours } = extractConflictContent(content, marker)
    
    const lines = resolvedContent.split('\n')
    const before = lines.slice(0, marker.startLine)
    const after = lines.slice(marker.endLine + 1)
    
    const newContent = [...before, ours, ...after].join('\n')
    setResolvedContent(newContent)
    
    // 更新冲突列表
    const newConflicts = parseConflicts(newContent)
    setConflicts(newConflicts)
    
    if (currentConflict >= newConflicts.length && newConflicts.length > 0) {
      setCurrentConflict(newConflicts.length - 1)
    }
  }, [conflicts, currentConflict, content, resolvedContent])

  // 选择 theirs 版本
  const acceptTheirs = useCallback(() => {
    if (conflicts.length === 0) return
    
    const marker = conflicts[currentConflict]
    const { theirs } = extractConflictContent(content, marker)
    
    const lines = resolvedContent.split('\n')
    const before = lines.slice(0, marker.startLine)
    const after = lines.slice(marker.endLine + 1)
    
    const newContent = [...before, theirs, ...after].join('\n')
    setResolvedContent(newContent)
    
    // 更新冲突列表
    const newConflicts = parseConflicts(newContent)
    setConflicts(newConflicts)
    
    if (currentConflict >= newConflicts.length && newConflicts.length > 0) {
      setCurrentConflict(newConflicts.length - 1)
    }
  }, [conflicts, currentConflict, content, resolvedContent])

  // 接受两者
  const acceptBoth = useCallback(() => {
    if (conflicts.length === 0) return
    
    const marker = conflicts[currentConflict]
    const { ours, theirs } = extractConflictContent(content, marker)
    
    const lines = resolvedContent.split('\n')
    const before = lines.slice(0, marker.startLine)
    const after = lines.slice(marker.endLine + 1)
    
    const newContent = [...before, ours, theirs, ...after].join('\n')
    setResolvedContent(newContent)
    
    // 更新冲突列表
    const newConflicts = parseConflicts(newContent)
    setConflicts(newConflicts)
    
    if (currentConflict >= newConflicts.length && newConflicts.length > 0) {
      setCurrentConflict(newConflicts.length - 1)
    }
  }, [conflicts, currentConflict, content, resolvedContent])

  // 保存并标记为已解决
  const saveAndResolve = useCallback(async () => {
    if (conflicts.length > 0) {
      toast.warning(tt('git.unresolvedConflicts'))
      return
    }
    
    try {
      await api.file.write(filePath, resolvedContent)
      await gitService.stageFile(filePath)
      toast.success(tt('git.conflictResolved'))
      onResolved()
    } catch (e) {
      toast.error('Failed to save file')
    }
  }, [conflicts, filePath, resolvedContent, tt, onResolved])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-6 h-6 animate-spin text-accent" />
      </div>
    )
  }

  const currentMarker = conflicts[currentConflict]
  const currentContent = currentMarker ? extractConflictContent(content, currentMarker) : null

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface">
        <div className="flex items-center gap-2">
          <GitMerge className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium">{tt('git.resolveConflicts')}</span>
          <span className="text-xs text-text-muted">
            {getFileName(filePath)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {conflicts.length > 0 && (
            <span className="text-xs text-status-warning">
              {conflicts.length} {tt('git.conflictsRemaining')}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 冲突导航 */}
      {conflicts.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface/50">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={currentConflict === 0}
              onClick={() => setCurrentConflict(c => Math.max(0, c - 1))}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs">
              {currentConflict + 1} / {conflicts.length}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={currentConflict >= conflicts.length - 1}
              onClick={() => setCurrentConflict(c => Math.min(conflicts.length - 1, c + 1))}
            >
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={acceptOurs}>
              {tt('git.acceptOurs')}
            </Button>
            <Button variant="secondary" size="sm" onClick={acceptTheirs}>
              {tt('git.acceptTheirs')}
            </Button>
            <Button variant="secondary" size="sm" onClick={acceptBoth}>
              {tt('git.acceptBoth')}
            </Button>
          </div>
        </div>
      )}

      {/* 冲突内容 */}
      <div className="flex-1 overflow-auto p-4">
        {currentContent ? (
          <div className="grid grid-cols-2 gap-4 h-full">
            {/* Ours */}
            <div className="flex flex-col border border-border-subtle rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-green-500/10 border-b border-border-subtle">
                <span className="text-xs font-medium text-green-400">
                  {tt('git.currentChanges')} (Ours)
                </span>
              </div>
              <pre className="flex-1 p-3 text-xs font-mono overflow-auto bg-surface/30">
                {currentContent.ours}
              </pre>
            </div>

            {/* Theirs */}
            <div className="flex flex-col border border-border-subtle rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-blue-500/10 border-b border-border-subtle">
                <span className="text-xs font-medium text-blue-400">
                  {tt('git.incomingChanges')} (Theirs)
                </span>
              </div>
              <pre className="flex-1 p-3 text-xs font-mono overflow-auto bg-surface/30">
                {currentContent.theirs}
              </pre>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <Check className="w-12 h-12 text-green-400 mb-4" />
            <p className="text-sm">{tt('git.allConflictsResolved')}</p>
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-subtle bg-surface">
        <Button variant="ghost" onClick={onCancel}>
          {tt('cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={conflicts.length > 0}
          onClick={saveAndResolve}
        >
          <Check className="w-4 h-4 mr-1" />
          {tt('git.markResolved')}
        </Button>
      </div>
    </div>
  )
}

export default ConflictResolver
