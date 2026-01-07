/**
 * 搜索视图
 */

import { api } from '@/renderer/services/electronAPI'
import { useState, useCallback, useMemo } from 'react'
import { ChevronRight, ChevronDown, FileText, Edit2, Box, MoreHorizontal, Loader2, Search } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { getFileName } from '@utils/pathUtils'
import { Input } from '../../ui'

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

  const { workspacePath, workspace, openFile, setActiveFile, language, openFiles } = useStore()

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
    const content = await api.file.read(result.path)
    if (content !== null) {
      openFile(result.path, content)
      setActiveFile(result.path)
      window.dispatchEvent(
        new CustomEvent('editor:goto-line', {
          detail: { line: result.line, column: 1 },
        })
      )
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
      }
    }

    handleSearch()
  }

  return (
    <div className="flex flex-col h-full bg-transparent text-sm">
      <div className="h-10 px-3 flex items-center border-b border-border sticky top-0 z-10 bg-transparent">
        <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider opacity-80">
          {t('search', language)}
        </span>
      </div>

      <div className="p-3 border-b border-border flex flex-col gap-2 bg-transparent">
        <div className="relative flex items-center">
          <div className="absolute left-0 z-10 p-1">
            <button
              onClick={() => setShowReplace(!showReplace)}
              className="p-0.5 hover:bg-white/5 rounded transition-colors"
            >
              <ChevronRight
                className={`w-3.5 h-3.5 text-text-muted transition-transform ${showReplace ? 'rotate-90' : ''}`}
              />
            </button>
          </div>
          <div className="relative flex-1 ml-5">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => searchHistory.length > 0 && setShowHistory(true)}
              onBlur={() => setTimeout(() => setShowHistory(false), 200)}
              placeholder={t('searchPlaceholder', language)}
              className="w-full h-8 text-xs"
            />

            {showHistory && searchHistory.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border-subtle rounded-md shadow-lg z-20 max-h-48 overflow-y-auto animate-slide-in">
                <div className="px-2 py-1 text-[10px] text-text-muted font-semibold border-b border-border-subtle">
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

            <div className="absolute right-1 top-1 flex gap-0.5">
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

            <div className="absolute right-1 top-8 flex gap-0.5">
              <button
                onClick={() => setSearchInOpenFiles(!searchInOpenFiles)}
                title={t('searchInOpenFiles', language)}
                className={`p-0.5 rounded transition-colors ${searchInOpenFiles ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-surface-active'}`}
              >
                <FileText className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {showReplace && (
          <div className="relative flex items-center ml-5 animate-slide-in gap-1">
            <Input
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              placeholder={t('replacePlaceholder', language)}
              className="flex-1 h-8 text-xs"
            />
            <button
              onClick={handleReplaceInFile}
              disabled={!replaceQuery || searchResults.length === 0}
              className="p-1.5 hover:bg-surface-active rounded transition-colors disabled:opacity-30"
              title={t('replace', language)}
            >
              <Edit2 className="w-3 h-3 text-text-muted" />
            </button>
            <button
              onClick={() => handleReplaceAll()}
              disabled={!replaceQuery || searchResults.length === 0}
              className="p-1.5 hover:bg-surface-active rounded transition-colors disabled:opacity-30"
              title={t('replaceAll', language)}
            >
              <span className="text-[10px] font-bold text-text-muted">All</span>
            </button>
            <button
              onClick={() => setReplaceInSelection(!replaceInSelection)}
              className={`p-1.5 hover:bg-surface-active rounded transition-colors ${replaceInSelection ? 'bg-accent/20 text-accent' : 'text-text-muted'}`}
              title={t('replaceInSelection', language)}
            >
              <Box className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="ml-5">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary mb-1 transition-colors"
          >
            <MoreHorizontal className="w-3 h-3" />
            {t('filesToExclude', language)}
          </button>

          {showDetails && (
            <div className="flex flex-col gap-2 animate-slide-in">
              <Input
                value={excludePattern}
                onChange={(e) => setExcludePattern(e.target.value)}
                placeholder={t('excludePlaceholder', language)}
                className="w-full h-7 text-xs"
              />
            </div>
          )}
        </div>
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
                    className="flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-surface-hover text-text-secondary sticky top-0 bg-background-secondary/95 backdrop-blur-sm z-0"
                  >
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-text-muted transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                    />
                    <FileText className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-xs font-medium truncate flex-1" title={filePath}>
                      {fileName}
                    </span>
                    <span className="text-[10px] text-text-muted bg-surface-active px-1.5 rounded-full">
                      {results.length}
                    </span>
                  </div>

                  {!isCollapsed && (
                    <div className="flex flex-col">
                      {results.map((res, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleResultClick(res)}
                          className="pl-8 pr-2 py-0.5 cursor-pointer hover:bg-accent/10 hover:text-text-primary group flex gap-2 text-[11px] font-mono text-text-muted border-l-2 border-transparent hover:border-accent transition-colors"
                        >
                          <span className="w-6 text-right flex-shrink-0 opacity-50 select-none">{res.line}:</span>
                          <span className="truncate opacity-80 group-hover:opacity-100">{res.text}</span>
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
