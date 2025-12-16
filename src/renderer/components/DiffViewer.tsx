/**
 * 增强版 DiffViewer
 * - Split/Unified 视图模式
 * - 虚拟化滚动（大文件优化）
 * - 流式编辑预览
 * - 内存优化
 */

import { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react'
import { X, Check, ChevronDown, ChevronUp, Copy, FileEdit, Columns, AlignJustify } from 'lucide-react'
import { useStore } from '../store'
import { t } from '../i18n'

// ===== 类型定义 =====
interface DiffLine {
  type: 'add' | 'remove' | 'unchanged'
  content: string
  oldLineNum?: number
  newLineNum?: number
}

interface SplitDiffLine {
  left: { lineNum?: number; content: string; type: 'remove' | 'unchanged' | 'empty' }
  right: { lineNum?: number; content: string; type: 'add' | 'unchanged' | 'empty' }
}

interface DiffViewerProps {
  originalContent: string
  modifiedContent: string
  filePath: string
  onAccept: () => void
  onReject: () => void
  onClose?: () => void
  isStreaming?: boolean // 流式编辑模式
  minimal?: boolean // 极简模式（用于 Inline Edit）
}

// ===== 常量 =====
const VIRTUAL_ROW_HEIGHT = 22 // 每行高度
const VIRTUAL_OVERSCAN = 10 // 预渲染行数
const MAX_VISIBLE_ROWS = 500 // 最大可见行数（超过启用虚拟化）

// ===== 优化的 LCS 算法 =====
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length
  const n = b.length

  // 对于大文件，使用空间优化的 LCS
  if (m * n > 1000000) {
    return computeLCSOptimized(a, b)
  }

  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const lcs: string[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  return lcs
}

// 空间优化的 LCS（用于大文件）
function computeLCSOptimized(a: string[], b: string[]): string[] {
  const m = a.length
  const n = b.length

  // 使用两行滚动数组
  let prev = new Array(n + 1).fill(0)
  let curr = new Array(n + 1).fill(0)

  // 记录路径
  const path: number[][] = []

  for (let i = 1; i <= m; i++) {
    path[i] = []
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1
        path[i][j] = 0 // 对角线
      } else if (prev[j] >= curr[j - 1]) {
        curr[j] = prev[j]
        path[i][j] = 1 // 上
      } else {
        curr[j] = curr[j - 1]
        path[i][j] = 2 // 左
      }
    }
    ;[prev, curr] = [curr, prev]
  }

  // 回溯构建 LCS
  const lcs: string[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (path[i]?.[j] === 0) {
      lcs.unshift(a[i - 1])
      i--
      j--
    } else if (path[i]?.[j] === 1) {
      i--
    } else {
      j--
    }
  }

  return lcs
}

// ===== Diff 计算 =====
function computeDiff(original: string, modified: string): DiffLine[] {
  const originalLines = original.split('\n')
  const modifiedLines = modified.split('\n')
  const diff: DiffLine[] = []

  const lcs = computeLCS(originalLines, modifiedLines)
  let oldIdx = 0
  let newIdx = 0
  let lcsIdx = 0

  while (oldIdx < originalLines.length || newIdx < modifiedLines.length) {
    if (lcsIdx < lcs.length && oldIdx < originalLines.length && originalLines[oldIdx] === lcs[lcsIdx]) {
      if (newIdx < modifiedLines.length && modifiedLines[newIdx] === lcs[lcsIdx]) {
        diff.push({
          type: 'unchanged',
          content: originalLines[oldIdx],
          oldLineNum: oldIdx + 1,
          newLineNum: newIdx + 1,
        })
        oldIdx++
        newIdx++
        lcsIdx++
      } else {
        diff.push({
          type: 'add',
          content: modifiedLines[newIdx],
          newLineNum: newIdx + 1,
        })
        newIdx++
      }
    } else if (oldIdx < originalLines.length) {
      diff.push({
        type: 'remove',
        content: originalLines[oldIdx],
        oldLineNum: oldIdx + 1,
      })
      oldIdx++
    } else if (newIdx < modifiedLines.length) {
      diff.push({
        type: 'add',
        content: modifiedLines[newIdx],
        newLineNum: newIdx + 1,
      })
      newIdx++
    }
  }

  return diff
}

// 转换为 Split 视图格式
function convertToSplitView(diff: DiffLine[]): SplitDiffLine[] {
  const result: SplitDiffLine[] = []
  let i = 0

  while (i < diff.length) {
    const line = diff[i]

    if (line.type === 'unchanged') {
      result.push({
        left: { lineNum: line.oldLineNum, content: line.content, type: 'unchanged' },
        right: { lineNum: line.newLineNum, content: line.content, type: 'unchanged' },
      })
      i++
    } else if (line.type === 'remove') {
      // 查找配对的 add
      const nextAdd = diff[i + 1]?.type === 'add' ? diff[i + 1] : null

      if (nextAdd) {
        result.push({
          left: { lineNum: line.oldLineNum, content: line.content, type: 'remove' },
          right: { lineNum: nextAdd.newLineNum, content: nextAdd.content, type: 'add' },
        })
        i += 2
      } else {
        result.push({
          left: { lineNum: line.oldLineNum, content: line.content, type: 'remove' },
          right: { content: '', type: 'empty' },
        })
        i++
      }
    } else {
      result.push({
        left: { content: '', type: 'empty' },
        right: { lineNum: line.newLineNum, content: line.content, type: 'add' },
      })
      i++
    }
  }

  return result
}

// ===== 虚拟化行组件 =====
const VirtualRow = memo(function VirtualRow({
  line,
  style,
}: {
  line: DiffLine
  style: React.CSSProperties
}) {
  return (
    <tr
      style={style}
      className={`
        ${line.type === 'add' ? 'bg-green-500/10' : ''}
        ${line.type === 'remove' ? 'bg-red-500/10' : ''}
      `}
    >
      <td className="w-12 px-2 py-0.5 text-right text-editor-text-muted select-none border-r border-editor-border text-xs">
        {line.oldLineNum || ''}
      </td>
      <td className="w-12 px-2 py-0.5 text-right text-editor-text-muted select-none border-r border-editor-border text-xs">
        {line.newLineNum || ''}
      </td>
      <td className="w-6 px-1 py-0.5 text-center select-none">
        {line.type === 'add' && <span className="text-green-400">+</span>}
        {line.type === 'remove' && <span className="text-red-400">-</span>}
      </td>
      <td className="px-3 py-0.5 whitespace-pre overflow-hidden text-ellipsis">
        <span className={`
          ${line.type === 'add' ? 'text-green-300' : ''}
          ${line.type === 'remove' ? 'text-red-300' : 'text-editor-text'}
        `}>
          {line.content}
        </span>
      </td>
    </tr>
  )
})

// ===== Split 视图行组件 =====
const SplitRow = memo(function SplitRow({
  line,
  style,
}: {
  line: SplitDiffLine
  style?: React.CSSProperties
}) {
  const leftBg = line.left.type === 'remove' ? 'bg-red-500/10' : line.left.type === 'empty' ? 'bg-editor-bg/30' : ''
  const rightBg = line.right.type === 'add' ? 'bg-green-500/10' : line.right.type === 'empty' ? 'bg-editor-bg/30' : ''

  return (
    <tr style={style}>
      {/* Left side */}
      <td className={`w-10 px-2 py-0.5 text-right text-editor-text-muted select-none border-r border-editor-border text-xs ${leftBg}`}>
        {line.left.lineNum || ''}
      </td>
      <td className={`w-1/2 px-3 py-0.5 whitespace-pre overflow-hidden text-ellipsis border-r border-editor-border ${leftBg}`}>
        <span className={line.left.type === 'remove' ? 'text-red-300' : 'text-editor-text'}>
          {line.left.content}
        </span>
      </td>
      {/* Right side */}
      <td className={`w-10 px-2 py-0.5 text-right text-editor-text-muted select-none border-r border-editor-border text-xs ${rightBg}`}>
        {line.right.lineNum || ''}
      </td>
      <td className={`w-1/2 px-3 py-0.5 whitespace-pre overflow-hidden text-ellipsis ${rightBg}`}>
        <span className={line.right.type === 'add' ? 'text-green-300' : 'text-editor-text'}>
          {line.right.content}
        </span>
      </td>
    </tr>
  )
})

// ===== 主组件 =====
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
  const { language } = useStore()
  const [collapsed, setCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('unified')
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(400)

  // 计算 diff（使用 useMemo 缓存）
  const diff = useMemo(
    () => computeDiff(originalContent, modifiedContent),
    [originalContent, modifiedContent]
  )

  // Split 视图数据
  const splitDiff = useMemo(
    () => viewMode === 'split' ? convertToSplitView(diff) : [],
    [diff, viewMode]
  )

  // 统计信息
  const stats = useMemo(() => {
    const added = diff.filter(d => d.type === 'add').length
    const removed = diff.filter(d => d.type === 'remove').length
    return { added, removed, total: diff.length }
  }, [diff])

  // 是否启用虚拟化
  const useVirtualization = diff.length > MAX_VISIBLE_ROWS

  // 虚拟化计算
  const virtualData = useMemo(() => {
    if (!useVirtualization) return null

    const totalHeight = diff.length * VIRTUAL_ROW_HEIGHT
    const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN)
    const endIndex = Math.min(
      diff.length,
      Math.ceil((scrollTop + containerHeight) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN
    )

    return {
      totalHeight,
      startIndex,
      endIndex,
      offsetY: startIndex * VIRTUAL_ROW_HEIGHT,
    }
  }, [diff.length, scrollTop, containerHeight, useVirtualization])

  // 滚动处理
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (useVirtualization) {
      setScrollTop(e.currentTarget.scrollTop)
    }
  }, [useVirtualization])

  // 监听容器大小变化
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // 流式模式自动滚动到底部
  useEffect(() => {
    if (isStreaming && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [isStreaming, modifiedContent])

  const fileName = filePath.split(/[/\\]/).pop() || filePath

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(modifiedContent)
  }, [modifiedContent])

  // 渲染 Unified 视图
  const renderUnifiedView = () => {
    if (useVirtualization && virtualData) {
      const visibleLines = diff.slice(virtualData.startIndex, virtualData.endIndex)

      return (
        <div
          ref={containerRef}
          className="max-h-96 overflow-auto"
          onScroll={handleScroll}
        >
          <div style={{ height: virtualData.totalHeight, position: 'relative' }}>
            <table
              className="w-full text-sm font-mono"
              style={{
                position: 'absolute',
                top: virtualData.offsetY,
                left: 0,
                right: 0,
              }}
            >
              <tbody>
                {visibleLines.map((line, idx) => (
                  <VirtualRow
                    key={virtualData.startIndex + idx}
                    line={line}
                    style={{ height: VIRTUAL_ROW_HEIGHT }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    }

    return (
      <div ref={containerRef} className="max-h-96 overflow-auto">
        <table className="w-full text-sm font-mono">
          <tbody>
            {diff.map((line, idx) => (
              <VirtualRow key={idx} line={line} style={{}} />
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // 渲染 Split 视图
  const renderSplitView = () => {
    return (
      <div ref={containerRef} className="max-h-96 overflow-auto">
        <table className="w-full text-sm font-mono table-fixed">
          <thead className="sticky top-0 bg-editor-sidebar z-10">
            <tr>
              <th className="w-10 px-2 py-1 text-left text-xs text-editor-text-muted border-b border-editor-border">#</th>
              <th className="w-1/2 px-3 py-1 text-left text-xs text-editor-text-muted border-b border-r border-editor-border">
                {t('original', language)}
              </th>
              <th className="w-10 px-2 py-1 text-left text-xs text-editor-text-muted border-b border-editor-border">#</th>
              <th className="w-1/2 px-3 py-1 text-left text-xs text-editor-text-muted border-b border-editor-border">
                {t('modified', language)}
              </th>
            </tr>
          </thead>
          <tbody>
            {splitDiff.map((line, idx) => (
              <SplitRow key={idx} line={line} />
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // 极简模式下，直接返回内容区域
  if (minimal) {
      return (
          <div className="bg-editor-bg border border-editor-border rounded-lg overflow-hidden">
             {viewMode === 'unified' ? renderUnifiedView() : renderSplitView()}
          </div>
      )
  }

  return (
    <div className="bg-editor-sidebar border border-editor-border rounded-xl overflow-hidden shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-editor-border bg-editor-bg/50">
        <div className="flex items-center gap-3">
          <FileEdit className="w-5 h-5 text-editor-accent" />
          <span className="font-medium text-editor-text">{fileName}</span>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-green-400">+{stats.added}</span>
            <span className="text-red-400">-{stats.removed}</span>
            {isStreaming && (
              <span className="text-yellow-400 animate-pulse">● {t('streaming', language)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-editor-hover rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('unified')}
              className={`p-1.5 rounded transition-colors ${ viewMode === 'unified' ? 'bg-editor-accent text-white' : 'text-editor-text-muted hover:text-editor-text'}`}
              title={t('unifiedView', language)}
            >
              <AlignJustify className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`p-1.5 rounded transition-colors ${ viewMode === 'split' ? 'bg-editor-accent text-white' : 'text-editor-text-muted hover:text-editor-text'}`}
              title={t('splitView', language)}
            >
              <Columns className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={copyToClipboard}
            className="p-2 rounded-lg hover:bg-editor-hover transition-colors"
            title={t('copyModified', language)}
          >
            <Copy className="w-4 h-4 text-editor-text-muted" />
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 rounded-lg hover:bg-editor-hover transition-colors"
          >
            {collapsed ? (
              <ChevronDown className="w-4 h-4 text-editor-text-muted" />
            ) : (
              <ChevronUp className="w-4 h-4 text-editor-text-muted" />
            )}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-editor-hover transition-colors"
            >
              <X className="w-4 h-4 text-editor-text-muted" />
            </button>
          )}
        </div>
      </div>

      {/* Diff Content */}
      {!collapsed && (
        viewMode === 'unified' ? renderUnifiedView() : renderSplitView()
      )}

      {/* Actions */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-editor-border bg-editor-bg/50">
        <div className="text-xs text-editor-text-muted">
          {stats.total} {t('lines', language)} • {useVirtualization ? t('virtualized', language) : t('fullRender', language)}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReject}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
            disabled={isStreaming}
          >
            <X className="w-4 h-4" />
            {t('rejectChanges', language)}
          </button>
          <button
            onClick={onAccept}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors disabled:opacity-50"
            disabled={isStreaming}
          >
            <Check className="w-4 h-4" />
            {t('acceptChanges', language)}
          </button>
        </div>
      </div>
    </div>
  )
}

// 导出工具函数供其他组件使用
export { computeDiff, convertToSplitView }
export type { DiffLine, SplitDiffLine }
