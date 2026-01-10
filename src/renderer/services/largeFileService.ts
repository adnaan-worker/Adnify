/**
 * 大文件处理服务
 * 提供大文件的分块加载、虚拟滚动支持、性能优化
 */

import { getEditorConfig } from '@renderer/settings'

// 文件大小阈值（字节）- 从配置获取
function getLargeFileThreshold(): number {
  const config = getEditorConfig()
  return (config.performance.largeFileWarningThresholdMB || 5) * 1024 * 1024
}

// 行数阈值 - 从配置获取
function getLargeLineCount(): number {
  return getEditorConfig().performance.largeFileLineCount
}

function getVeryLargeLineCount(): number {
  return getEditorConfig().performance.veryLargeFileLineCount
}

const CHUNK_SIZE = 64 * 1024 // 64KB per chunk

export interface FileChunk {
  startLine: number
  endLine: number
  content: string
  startOffset: number
  endOffset: number
}

export interface LargeFileInfo {
  path: string
  size: number
  lineCount: number
  isLarge: boolean
  isVeryLarge: boolean
  reason?: 'size' | 'lines' | 'both'
}

/**
 * 快速估算行数（不完全分割字符串）
 */
function estimateLineCount(content: string): number {
  let count = 1
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) count++ // \n
  }
  return count
}

/**
 * 检查文件是否为大文件
 */
export function isLargeFile(content: string): boolean {
  const threshold = getLargeFileThreshold()
  if (content.length > threshold * 0.2) return true
  if (content.length > 100000) { // 只有超过 100KB 才检查行数
    return estimateLineCount(content) > getLargeLineCount()
  }
  return false
}

/**
 * 检查文件是否为超大文件
 */
export function isVeryLargeFile(content: string): boolean {
  const threshold = getLargeFileThreshold()
  if (content.length > threshold) return true
  if (content.length > 500000) { // 只有超过 500KB 才检查行数
    return estimateLineCount(content) > getVeryLargeLineCount()
  }
  return false
}

/**
 * 获取文件信息（优化版：延迟计算行数）
 */
export function getFileInfo(path: string, content: string): LargeFileInfo {
  const size = content.length
  const threshold = getLargeFileThreshold()
  
  // 先检查大小
  const isSizeLarge = size > threshold * 0.2
  const isSizeVeryLarge = size > threshold
  
  // 只有在需要时才计算行数
  let lineCount = 0
  let isLineLarge = false
  let isLineVeryLarge = false
  
  if (!isSizeVeryLarge && size > 100000) {
    lineCount = estimateLineCount(content)
    isLineLarge = lineCount > getLargeLineCount()
    isLineVeryLarge = lineCount > getVeryLargeLineCount()
  } else if (isSizeVeryLarge) {
    // 超大文件不计算行数，直接标记
    lineCount = -1 // 表示未计算
  } else {
    lineCount = estimateLineCount(content)
  }
  
  const isLarge = isSizeLarge || isLineLarge
  const isVeryLarge = isSizeVeryLarge || isLineVeryLarge
  
  let reason: 'size' | 'lines' | 'both' | undefined
  if (isLarge) {
    if ((isSizeLarge || isSizeVeryLarge) && (isLineLarge || isLineVeryLarge)) {
      reason = 'both'
    } else if (isSizeLarge || isSizeVeryLarge) {
      reason = 'size'
    } else {
      reason = 'lines'
    }
  }
  
  return {
    path,
    size,
    lineCount,
    isLarge,
    isVeryLarge,
    reason,
  }
}

/**
 * 将大文件分块（优化版：流式处理）
 */
export function chunkFile(content: string): FileChunk[] {
  const chunks: FileChunk[] = []
  let startLine = 0
  let currentChunkStart = 0
  let lineCount = 0
  
  for (let i = 0; i <= content.length; i++) {
    const isEnd = i === content.length
    const isNewline = !isEnd && content.charCodeAt(i) === 10
    
    if (isNewline || isEnd) {
      lineCount++
      const chunkSize = i - currentChunkStart
      
      // 当块大小超过阈值时，保存当前块
      if (chunkSize >= CHUNK_SIZE || isEnd) {
        if (i > currentChunkStart) {
          chunks.push({
            startLine,
            endLine: startLine + lineCount - 1,
            content: content.slice(currentChunkStart, isEnd ? i : i + 1),
            startOffset: currentChunkStart,
            endOffset: isEnd ? i : i + 1,
          })
        }
        
        if (!isEnd) {
          startLine += lineCount
          lineCount = 0
          currentChunkStart = i + 1
        }
      }
    }
  }
  
  return chunks
}

/**
 * 获取指定行范围的内容（优化版：避免完整分割）
 */
export function getLineRange(content: string, startLine: number, endLine: number): string {
  let currentLine = 0
  let rangeStart = 0
  let rangeEnd = content.length
  
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      currentLine++
      if (currentLine === startLine) {
        rangeStart = i + 1
      } else if (currentLine === endLine + 1) {
        rangeEnd = i
        break
      }
    }
  }
  
  return content.slice(rangeStart, rangeEnd)
}

/**
 * 获取指定行周围的上下文
 */
export function getLineContext(
  content: string,
  line: number,
  contextLines: number = 50
): { content: string; startLine: number; endLine: number } {
  const startLine = Math.max(0, line - contextLines)
  const endLine = line + contextLines
  
  return {
    content: getLineRange(content, startLine, endLine),
    startLine,
    endLine,
  }
}

/**
 * 优化大文件的 Monaco 编辑器选项
 */
export function getLargeFileEditorOptions(fileInfo: LargeFileInfo): Record<string, unknown> {
  const options: Record<string, unknown> = {}
  
  if (fileInfo.isLarge) {
    // 禁用性能消耗大的功能
    options.minimap = { enabled: false }
    options.folding = false
    options.wordWrap = 'off'
    options.renderWhitespace = 'none'
    options.renderLineHighlight = 'none'
    options.guides = { indentation: false, bracketPairs: false }
    options.matchBrackets = 'never'
    options.occurrencesHighlight = 'off'
    options.selectionHighlight = false
    options.links = false
    options.colorDecorators = false
  }
  
  if (fileInfo.isVeryLarge) {
    // 超大文件额外禁用
    options.lineNumbers = 'off'
    options.glyphMargin = false
    options.lineDecorationsWidth = 0
    options.lineNumbersMinChars = 0
    options.overviewRulerLanes = 0
    options.hideCursorInOverviewRuler = true
    options.overviewRulerBorder = false
    options.scrollbar = {
      vertical: 'auto',
      horizontal: 'auto',
      useShadows: false,
      verticalHasArrows: false,
      horizontalHasArrows: false,
    }
    // 禁用语法高亮（通过设置语言为 plaintext）
    options.suggestOnTriggerCharacters = false
    options.quickSuggestions = false
    options.parameterHints = { enabled: false }
  }
  
  return options
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 大文件警告消息
 */
export function getLargeFileWarning(fileInfo: LargeFileInfo, language: 'en' | 'zh'): string | null {
  if (!fileInfo.isLarge) return null
  
  const size = formatFileSize(fileInfo.size)
  const lines = fileInfo.lineCount > 0 ? `, ${fileInfo.lineCount.toLocaleString()} lines` : ''
  
  if (fileInfo.isVeryLarge) {
    return language === 'zh'
      ? `此文件较大 (${size}${lines})，部分编辑器功能已禁用以提高性能`
      : `This file is large (${size}${lines}), some editor features are disabled for performance`
  }
  
  return language === 'zh'
    ? `此文件较大 (${size}${lines})，可能影响编辑器性能`
    : `This file is large (${size}${lines}), editor performance may be affected`
}

/**
 * 判断是否应该使用只读模式
 */
export function shouldUseReadOnlyMode(fileInfo: LargeFileInfo): boolean {
  // 超过 50MB 或 100000 行建议只读
  return fileInfo.size > 50 * 1024 * 1024 || fileInfo.lineCount > 100000
}
