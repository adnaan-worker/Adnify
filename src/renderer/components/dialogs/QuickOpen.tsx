/**
 * 快速打开文件
 * 类似 VS Code 的 Ctrl+P
 */

import { api } from '@/renderer/services/electronAPI'
import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { Search, X } from 'lucide-react'
import { useStore } from '@store'
import { getFileName } from '@shared/utils/pathUtils'
import { keybindingService } from '@services/keybindingService'
import { t } from '@renderer/i18n'
import { Button } from '../ui'
import FileIcon from '../common/FileIcon'

interface QuickOpenProps {
  onClose: () => void
}

interface FileMatch {
  path: string
  name: string
  score: number
  matches: number[]
}

// 模糊匹配算法
function fuzzyMatch(query: string, text: string): { score: number; matches: number[] } | null {
  const queryLower = query.toLowerCase()
  const textLower = text.toLowerCase()

  let queryIdx = 0
  let score = 0
  const matches: number[] = []
  let consecutiveBonus = 0

  for (let i = 0; i < text.length && queryIdx < query.length; i++) {
    if (textLower[i] === queryLower[queryIdx]) {
      matches.push(i)

      // 连续匹配加分
      if (matches.length > 1 && matches[matches.length - 1] === matches[matches.length - 2] + 1) {
        consecutiveBonus += 5
      }

      // 单词开头加分
      if (i === 0 || text[i - 1] === '/' || text[i - 1] === '\\' || text[i - 1] === '.' || text[i - 1] === '-' || text[i - 1] === '_') {
        score += 10
      }

      // 大写字母加分（驼峰匹配）
      if (text[i] === text[i].toUpperCase() && text[i] !== text[i].toLowerCase()) {
        score += 5
      }

      score += 1
      queryIdx++
    }
  }

  if (queryIdx !== query.length) {
    return null
  }

  score += consecutiveBonus

  // 短文件名加分
  score -= text.length * 0.1

  return { score, matches }
}

// 高亮匹配字符
const HighlightedText = memo(function HighlightedText({
  text,
  matches,
}: {
  text: string
  matches: number[]
}) {
  const parts: JSX.Element[] = []
  let lastIdx = 0

  for (const matchIdx of matches) {
    if (matchIdx > lastIdx) {
      parts.push(
        <span key={`text-${lastIdx}`} className="text-text-muted">
          {text.slice(lastIdx, matchIdx)}
        </span>
      )
    }
    parts.push(
      <span key={`match-${matchIdx}`} className="text-accent font-medium">
        {text[matchIdx]}
      </span>
    )
    lastIdx = matchIdx + 1
  }

  if (lastIdx < text.length) {
    parts.push(
      <span key={`text-${lastIdx}`} className="text-text-primary/70">
        {text.slice(lastIdx)}
      </span>
    )
  }

  return <>{parts}</>
})

const FileMatchItem = memo(function FileMatchItem({
  file,
  isSelected,
  onSelect,
}: {
  file: FileMatch
  isSelected: boolean
  onSelect: () => void
}) {
  const fileName = getFileName(file.path) || file.path
  const dirPath = file.path.slice(0, file.path.length - fileName.length - 1)

  // 计算文件名中的匹配位置
  const fileNameStart = file.path.length - fileName.length
  const fileNameMatches = file.matches
    .filter(m => m >= fileNameStart)
    .map(m => m - fileNameStart)

  return (
    <div
      onClick={onSelect}
      className={`
        relative flex items-center gap-3 px-4 py-3 cursor-pointer transition-all duration-200 mx-2 rounded-lg group
        ${isSelected ? 'bg-surface-active text-text-primary' : 'text-text-secondary hover:bg-surface-hover'}
      `}
    >
      {/* Active Indicator */}
      {isSelected && (
        <div className="absolute left-0 top-2 bottom-2 w-1 bg-accent rounded-r-full shadow-[0_0_8px_rgba(var(--accent),0.6)]" />
      )}

      <div className="flex-shrink-0">
        <FileIcon filename={fileName} size={18} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        <div className="text-sm font-medium truncate leading-none">
          <HighlightedText text={fileName} matches={fileNameMatches} />
        </div>
        {dirPath && (
          <div className="text-[10px] text-text-muted truncate opacity-60 leading-none">
            {dirPath}
          </div>
        )}
      </div>

      {/* Right Action Hint */}
      {isSelected && (
        <div className="flex-shrink-0 text-[10px] font-mono text-text-muted bg-surface px-1.5 py-0.5 rounded border border-border opacity-0 group-hover:opacity-100 transition-opacity animate-fade-in">
          ⏎ Open
        </div>
      )}
    </div>
  )
})

export default function QuickOpen({ onClose }: QuickOpenProps) {
  const { workspacePath, openFile, language } = useStore()
  const [query, setQuery] = useState('')
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [matches, setMatches] = useState<FileMatch[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 递归获取所有文件
  const getAllFiles = useCallback(async (dirPath: string, prefix: string = ''): Promise<string[]> => {
    const items = await api.file.readDir(dirPath)
    if (!items) return []

    const files: string[] = []

    for (const item of items) {
      // 跳过隐藏文件和 node_modules
      if (item.name.startsWith('.') || item.name === 'node_modules') continue

      const relativePath = prefix ? `${prefix}/${item.name}` : item.name

      if (item.isDirectory) {
        const subFiles = await getAllFiles(item.path, relativePath)
        files.push(...subFiles)
      } else {
        files.push(relativePath)
      }
    }

    return files
  }, [])

  // 加载文件列表
  useEffect(() => {
    if (!workspacePath) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    getAllFiles(workspacePath).then(files => {
      setAllFiles(files)
      setIsLoading(false)
    })
  }, [workspacePath, getAllFiles])

  // 搜索文件
  useEffect(() => {
    if (!query.trim()) {
      // 显示最近的文件或全部文件（限制数量）
      setMatches(
        allFiles.slice(0, 20).map(path => ({
          path,
          name: getFileName(path) || path,
          score: 0,
          matches: [],
        }))
      )
      return
    }

    const results: FileMatch[] = []

    for (const filePath of allFiles) {
      const result = fuzzyMatch(query, filePath)
      if (result) {
        results.push({
          path: filePath,
          name: getFileName(filePath) || filePath,
          score: result.score,
          matches: result.matches,
        })
      }
    }

    // 按分数排序
    results.sort((a, b) => b.score - a.score)

    setMatches(results.slice(0, 50))
    setSelectedIndex(0)
  }, [query, allFiles])

  // 打开文件
  const handleOpenFile = useCallback(async (filePath: string) => {
    if (!workspacePath) return

    const fullPath = `${workspacePath}/${filePath}`
    const content = await api.file.read(fullPath)

    if (content !== null) {
      openFile(fullPath, content)
      onClose()
    }
  }, [workspacePath, openFile, onClose])

  // 键盘导航
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (keybindingService.matches(e, 'list.focusDown')) {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, matches.length - 1))
    } else if (keybindingService.matches(e, 'list.focusUp')) {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (keybindingService.matches(e, 'list.select')) {
      e.preventDefault()
      if (matches[selectedIndex]) {
        handleOpenFile(matches[selectedIndex].path)
      }
    } else if (keybindingService.matches(e, 'list.cancel')) {
      e.preventDefault()
      onClose()
    }
  }, [matches, selectedIndex, handleOpenFile, onClose])

  // 自动聚焦
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 滚动到选中项
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      selectedEl?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] animate-fade-in"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-background/20 backdrop-blur-sm transition-opacity" />

      <div
        className="
            relative w-[640px] max-h-[65vh] flex flex-col
            bg-background/80 backdrop-blur-2xl 
            border border-border/50 rounded-2xl shadow-2xl shadow-black/40
            overflow-hidden animate-scale-in origin-top ring-1 ring-text-primary/5
        "
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input - Big & Clean */}
        <div className="flex items-center gap-4 px-5 py-5 border-b border-border/40 shrink-0">
          <Search className="w-6 h-6 text-text-muted" strokeWidth={2} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('searchFilesPlaceholder', language)}
            className="flex-1 bg-transparent text-xl font-medium text-text-primary placeholder:text-text-muted/40 focus:outline-none"
            spellCheck={false}
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setQuery('')}
              className="rounded-full w-6 h-6 min-h-0 p-0 text-text-muted hover:text-text-primary"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* File List */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-2 custom-scrollbar scroll-p-2">
          {isLoading ? (
            <div className="px-4 py-16 text-center text-text-muted flex flex-col items-center gap-4">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-medium opacity-70 tracking-wide">{t('loadingFiles', language)}</p>
            </div>
          ) : matches.length === 0 ? (
            <div className="px-4 py-16 text-center text-text-muted flex flex-col items-center gap-2">
              <p className="text-sm font-medium">{query ? t('noFilesFound', language) : t('noFilesInWorkspace', language)}</p>
              {query && <p className="text-xs opacity-50">Try searching for something else</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {matches.map((file, idx) => (
                <div key={file.path} data-index={idx}>
                  <FileMatchItem
                    file={file}
                    isSelected={idx === selectedIndex}
                    onSelect={() => handleOpenFile(file.path)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-surface/30 border-t border-border/40 text-[10px] font-medium text-text-muted/60 flex justify-between items-center shrink-0 backdrop-blur-md">
          <span className="font-mono tracking-tight">{matches.length} matches</span>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <div className="flex gap-0.5">
                <kbd className="font-sans bg-surface/80 border border-border/50 px-1 py-0.5 rounded min-w-[16px] text-center shadow-sm">↑</kbd>
                <kbd className="font-sans bg-surface/80 border border-border/50 px-1 py-0.5 rounded min-w-[16px] text-center shadow-sm">↓</kbd>
              </div>
              <span>to navigate</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="font-sans bg-surface/80 border border-border/50 px-1.5 py-0.5 rounded shadow-sm">↵</kbd>
              <span>to open</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="font-sans bg-surface/80 border border-border/50 px-1.5 py-0.5 rounded shadow-sm">esc</kbd>
              <span>to close</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}