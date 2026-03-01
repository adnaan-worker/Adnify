/**
 * 搜索视图
 */

import { api } from '@/renderer/services/electronAPI'
import { useState, useCallback, useMemo } from 'react'
import { ChevronRight, ChevronDown, FileText, Edit2, Box, MoreHorizontal, Loader2, Search, Crosshair } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { getFileName, joinPath } from '@shared/utils/pathUtils'
import { Input } from '../../ui'
import { toast } from '../../common/ToastProvider'

export function SearchView() {
  const [query, setQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [isCaseSensitive, setIsCaseSensitive] = useState(false)
  const [isWholeWord, setIsWholeWord] = useState(false)
  const [excludePattern, setExcludePattern] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [showReplace, setShowReplace] = useState(false)

  const [searchResults, setSearchResults] = useState<{ path: string; line: number; text: string }[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())

  const [searchInOpenFiles, setSearchInOpenFiles] = useState(false)
  const [replaceInSelection, setReplaceInSelection] = useState(false)

  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('adnify-search-history')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [showHistory, setShowHistory] = useState(false)

  const { workspacePath, workspace, openFile, setActiveFile, language, openFiles, setActiveSidePanel } = useStore()

  const addToHistory = useCallback((searchQuery: string) => {
    if (!searchQuery.trim()) return
    setSearchHistory((prev) => {
      const filtered = prev.filter((h) => h !== searchQuery)
      const newHistory = [searchQuery, ...filtered].slice(0, 20)
      localStorage.setItem('adnify-search-history', JSON.stringify(newHistory))
      return newHistory
    })
  }, [])

  const resultsByFile = useMemo(() => {
    const groups: Record<string, typeof searchResults> = {}
    searchResults.forEach((res) => {
      if (!groups[res.path]) groups[res.path] = []
      groups[res.path].push(res)
    })
    return groups
  }, [searchResults])

  const handleSearch = async () => {
    if (!query.trim()) return

    setIsSearching(true)
    setSearchResults([])
    addToHistory(query)
    setShowHistory(false)

    try {
      if (searchInOpenFiles) {
        const results: { path: string; line: number; text: string }[] = []
        const flags = (isCaseSensitive ? '' : 'i') + 'g'

        openFiles.forEach((file) => {
          const lines = file.content.split('\n')
          lines.forEach((lineContent, lineIndex) => {
            let match = false
            if (isRegex) {
              try {
                const regex = new RegExp(query, flags)
                match = regex.test(lineContent)
              } catch {
                // Invalid regex
              }
            } else {
              if (isWholeWord) {
                const regex = new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, flags)
                match = regex.test(lineContent)
              } else {
                if (isCaseSensitive) {
                  match = lineContent.includes(query)
                } else {
                  match = lineContent.toLowerCase().includes(query.toLowerCase())
                }
              }
            }

            if (match) {
              results.push({
                path: file.path,
                line: lineIndex + 1,
                text: lineContent.trim(),
              })
            }
          })
        })
        setSearchResults(results)
      } else {
        const roots = (workspace?.roots || [workspacePath].filter(Boolean)) as string[]
        if (roots.length > 0) {
          const results = await api.file.search(query, roots, {
            isRegex,
            isCaseSensitive,
            isWholeWord,
            exclude: excludePattern,
          })
          setSearchResults(results)
        }
      }
    } finally {
      setIsSearching(false)
    }
  }

  const toggleFileCollapse = (path: string) => {
    const newSet = new Set(collapsedFiles)
    if (newSet.has(path)) newSet.delete(path)
    else newSet.add(path)
    setCollapsedFiles(newSet)
  }

  const handleResultClick = async (result: { path: string; line: number }) => {
    // 如果是相对路径，转换为绝对路径
    let filePath = result.path
    const isAbsolute = /^[a-zA-Z]:[\\/]|^\//.test(filePath)
    if (!isAbsolute && workspacePath) {
      filePath = joinPath(workspacePath, filePath)
    }

    const content = await api.file.read(filePath)
    if (content !== null) {
      openFile(filePath, content)
      setActiveFile(filePath)

      // 增加延迟，确保编辑器完全准备好
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('editor:goto-line', {
            detail: { line: result.line, column: 1 },
          })
        )
      }, 200)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 忽略 IME 组合状态中的按键
    if (e.nativeEvent.isComposing) return

    if (e.key === 'Enter') handleSearch()
  }

  const handleReplaceInFile = async () => {
    if (!replaceQuery) return

    if (replaceInSelection) {
      window.dispatchEvent(
        new CustomEvent('editor:replace-selection', {
          detail: { query, replaceQuery, isRegex, isCaseSensitive, isWholeWord },
        })
      )
      return
    }

    if (searchResults.length === 0) return

    const firstResult = searchResults[0]
    if (!firstResult) return

    const content = await api.file.read(firstResult.path)
    if (content === null) return

    let newContent = content
    if (isRegex) {
      try {
        const regex = new RegExp(query, isCaseSensitive ? 'g' : 'gi')
        newContent = content.replace(regex, replaceQuery)
      } catch {
        return
      }
    } else {
      const flags = isCaseSensitive ? 'g' : 'gi'
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = isWholeWord ? new RegExp(`\\b${escapedQuery}\\b`, flags) : new RegExp(escapedQuery, flags)
      newContent = content.replace(regex, replaceQuery)
    }

    if (newContent !== content) {
      await api.file.write(firstResult.path, newContent)
      handleSearch()
    }
  }

  const handleReplaceAll = async () => {
    if (!replaceQuery) return

    if (replaceInSelection) {
      handleReplaceInFile()
      return
    }

    if (searchResults.length === 0) return

    const filePaths = [...new Set(searchResults.map((r) => r.path))]
    const fileCount = filePaths.length
    const matchCount = searchResults.length

    // 确认对话框
    const confirmMessage = language === 'zh'
      ? `确定要在 ${fileCount} 个文件中替换 ${matchCount} 处匹配吗？`
      : `Replace ${matchCount} matches in ${fileCount} files?`

    const { globalConfirm } = await import('@components/common/ConfirmDialog')
    const confirmed = await globalConfirm({
      title: language === 'zh' ? '替换确认' : 'Replace Confirmation',
      message: confirmMessage,
      variant: 'warning',
    })
    if (!confirmed) return

    let replacedCount = 0
    for (const filePath of filePaths) {
      const content = await api.file.read(filePath)
      if (content === null) continue

      let newContent = content
      if (isRegex) {
        try {
          const regex = new RegExp(query, isCaseSensitive ? 'g' : 'gi')
          newContent = content.replace(regex, replaceQuery)
        } catch {
          continue
        }
      } else {
        const flags = isCaseSensitive ? 'g' : 'gi'
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = isWholeWord ? new RegExp(`\\b${escapedQuery}\\b`, flags) : new RegExp(escapedQuery, flags)
        newContent = content.replace(regex, replaceQuery)
      }

      if (newContent !== content) {
        await api.file.write(filePath, newContent)
        replacedCount++
      }
    }

    // 显示替换结果
    const resultMessage = language === 'zh'
      ? `已在 ${replacedCount} 个文件中完成替换`
      : `Replaced in ${replacedCount} files`
    toast.success(resultMessage)

    handleSearch()
  }

  return (
    <div className="flex flex-col h-full bg-transparent text-sm">
      <div className="h-10 px-3 flex items-center border-b border-border sticky top-0 z-10 bg-transparent">
        <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider opacity-80">
          {t('search', language)}
        </span>
      </div>

      <div className="p-4 border-b border-border/50 flex flex-col gap-3 bg-transparent">
        {/* Search Input Area */}
        <div className="relative">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => searchHistory.length > 0 && setShowHistory(true)}
            onBlur={() => setTimeout(() => setShowHistory(false), 200)}
            placeholder={t('searchPlaceholder', language)}
            className="w-full h-9 text-xs pr-24" // Reserve space for icons
          />

          {/* Search Options (Inside Input) */}
          <div className="absolute right-1.5 top-1.5 flex gap-0.5">
            <button
              onClick={() => setIsCaseSensitive(!isCaseSensitive)}
              title={t('matchCase', language)}
              className={`p-0.5 rounded transition-colors ${isCaseSensitive ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-surface-active'}`}
            >
              <span className="text-[10px] font-bold px-1">Aa</span>
            </button>
            <button
              onClick={() => setIsWholeWord(!isWholeWord)}
              title={t('matchWholeWord', language)}
              className={`p-0.5 rounded transition-colors ${isWholeWord ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-surface-active'}`}
            >
              <span className="text-[10px] font-bold px-0.5 border border-current rounded-[2px]">ab</span>
            </button>
            <button
              onClick={() => setIsRegex(!isRegex)}
              title={t('useRegex', language)}
              className={`p-0.5 rounded transition-colors ${isRegex ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-surface-active'}`}
            >
              <span className="text-[10px] font-bold px-1">.*</span>
            </button>
          </div>

          {showHistory && searchHistory.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border-subtle rounded-md shadow-lg z-20 max-h-48 overflow-y-auto animate-slide-in">
              <div className="px-2 py-1 text-[10px] text-text-muted font-semibold border-b border-border-subtle bg-surface/50 backdrop-blur-sm">
                Recent Searches
              </div>
              {searchHistory.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    setQuery(item)
                    setShowHistory(false)
                  }}
                  className="px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover cursor-pointer truncate"
                >
                  {item}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action Bar (Replace Toggle + File Filter) */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowReplace(!showReplace)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors text-[11px] font-medium ${showReplace ? 'text-text-primary bg-surface-active' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'}`}
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${showReplace ? 'rotate-90' : ''}`} />
            {t('replace', language)}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSearchInOpenFiles(!searchInOpenFiles)}
              title={t('searchInOpenFiles', language)}
              className={`p-1 rounded transition-colors ${searchInOpenFiles ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-surface-active hover:text-text-primary'}`}
            >
              <FileText className="w-3.5 h-3.5" />
            </button>
            {showReplace && (
              <button
                onClick={() => setReplaceInSelection(!replaceInSelection)}
                title={language === 'zh' ? '仅在选中区域替换' : 'Replace in selection only'}
                className={`p-1 rounded transition-colors ${replaceInSelection ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-surface-active hover:text-text-primary'}`}
              >
                <span className="text-[10px] font-bold px-1 border border-current rounded-[2px]">Sel</span>
              </button>
            )}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className={`p-1 rounded transition-colors ${showDetails ? 'bg-surface-active text-text-primary' : 'text-text-muted hover:bg-surface-active hover:text-text-primary'}`}
              title={t('filesToExclude', language)}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Replace Input (Collapsible) */}
        {showReplace && (
          <div className="flex items-center animate-slide-in gap-2">
            <Input
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              placeholder={t('replacePlaceholder', language)}
              className="flex-1 h-8 text-xs"
            />
            <button
              onClick={handleReplaceInFile}
              disabled={!replaceQuery || searchResults.length === 0}
              className="p-1.5 hover:bg-surface-active rounded transition-colors disabled:opacity-30 text-text-muted hover:text-text-primary"
              title={t('replace', language)}
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleReplaceAll()}
              disabled={!replaceQuery || searchResults.length === 0}
              className="p-1.5 hover:bg-surface-active rounded transition-colors disabled:opacity-30 text-text-muted hover:text-text-primary"
              title={t('replaceAll', language)}
            >
              <Box className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Exclude Pattern (Collapsible) */}
        {showDetails && (
          <div className="animate-slide-in">
            <Input
              value={excludePattern}
              onChange={(e) => setExcludePattern(e.target.value)}
              placeholder={t('excludePlaceholder', language)}
              className="w-full h-7 text-xs"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar bg-background-secondary">
        {isSearching && (
          <div className="p-4 flex justify-center">
            <Loader2 className="w-5 h-5 text-accent animate-spin" />
          </div>
        )}

        {!isSearching && searchResults.length > 0 && (
          <div className="flex flex-col">
            <div className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-background-secondary border-b border-border-subtle sticky top-0 z-10">
              {t('searchResultsCount', language, {
                results: String(searchResults.length),
                files: String(Object.keys(resultsByFile).length),
              })}
            </div>

            {Object.entries(resultsByFile).map(([filePath, results]) => {
              const fileName = getFileName(filePath)
              const isCollapsed = collapsedFiles.has(filePath)

              return (
                <div key={filePath} className="flex flex-col">
                  <div
                    onClick={() => toggleFileCollapse(filePath)}
                    className="group flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-surface-hover text-text-secondary sticky top-0 bg-background-secondary/95 backdrop-blur-sm z-0"
                  >
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-text-muted transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                    />
                    <FileText className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-xs font-medium truncate flex-1" title={filePath}>
                      {fileName}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        // 将相对路径转为绝对路径
                        let absPath = filePath
                        const isAbsolute = /^[a-zA-Z]:[\\/]|^\//.test(absPath)
                        if (!isAbsolute && workspacePath) {
                          absPath = joinPath(workspacePath, absPath)
                        }
                        // 先切换到资源管理器面板
                        setActiveSidePanel('explorer')
                        // 延迟一帧等面板渲染，再触发定位
                        requestAnimationFrame(() => {
                          window.dispatchEvent(new CustomEvent('explorer:reveal-file', { detail: { filePath: absPath } }))
                        })
                      }}
                      className="p-0.5 rounded hover:bg-surface-active text-text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
                      title={language === 'zh' ? '在侧边栏中定位' : 'Reveal in Sidebar'}
                    >
                      <Crosshair className="w-3 h-3" />
                    </button>
                    <span className="text-[10px] text-text-muted bg-surface-active px-1.5 rounded-full">
                      {results.length}
                    </span>
                  </div>

                  {!isCollapsed && (
                    <div className="flex flex-col gap-0.5 mt-0.5">
                      {results.map((res, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleResultClick(res)}
                          className="relative pl-3 pr-2 py-1.5 mx-2 rounded-md cursor-pointer hover:bg-surface-hover hover:text-text-primary group flex gap-2 text-[11px] font-mono text-text-muted transition-colors border border-transparent hover:border-border-subtle"
                        >
                          {/* Hover Indicator */}
                          <div className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-accent rounded-r-full opacity-0 group-hover:opacity-100 transition-opacity" />

                          <span className="w-8 text-right flex-shrink-0 opacity-50 select-none border-r border-border/50 pr-2 mr-1">{res.line}</span>
                          <span className="truncate opacity-80 group-hover:opacity-100 flex-1">{res.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!isSearching && query && searchResults.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center animate-fade-in opacity-60">
            <div className="w-12 h-12 bg-surface/30 rounded-2xl flex items-center justify-center mb-3 border border-border">
              <Search className="w-6 h-6 text-text-muted" />
            </div>
            <p className="text-xs font-medium text-text-secondary">{t('noResults', language)}</p>
            <p className="text-[10px] text-text-muted mt-1">Try a different keyword or regex</p>
          </div>
        )}

        {!isSearching && !query && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in opacity-40 select-none">
            <Search className="w-8 h-8 text-text-muted mb-2" />
            <p className="text-xs font-medium text-text-muted">Type to search across files</p>
          </div>
        )}
      </div>
    </div>
  )
}
