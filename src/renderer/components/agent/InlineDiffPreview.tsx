/**
 * InlineDiffPreview - 内联 Diff 预览组件
 * 使用 diff 库（Myers 算法，Git 同款）计算精确的文件差异
 * 支持语法高亮、删除/新增行颜色区分
 * 
 * 优化：
 * 1. 异步 Diff 计算，避免阻塞 UI
 * 2. 大文件保护，避免计算耗时过长
 * 3. 限制渲染行数，避免 DOM 过多
 * 4. 流式模式：内容变化时只显示新增行，避免频繁 diff 计算
 */

import React, { useMemo, useState, useEffect, useRef } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import * as Diff from 'diff'
import { CodeSkeleton } from '../ui/Loading'
import { logger } from '@shared/utils/Logger'

export interface DiffLine {
    type: 'add' | 'remove' | 'unchanged'
    content: string
    oldLineNumber?: number
    newLineNumber?: number
}

interface InlineDiffPreviewProps {
    oldContent: string
    newContent: string
    filePath: string
    /** 是否处于流式更新模式（工具正在执行中） */
    isStreaming?: boolean
    maxLines?: number
}

// 超过此字符数则视为大文件，降级处理或截断
const MAX_FILE_SIZE_FOR_DIFF = 50000
// 流式模式下的更新节流间隔 (ms)
const STREAMING_THROTTLE_MS = 100

// 根据文件路径推断语言
function getLanguageFromPath(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase()
    const langMap: Record<string, string> = {
        ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
        py: 'python', rs: 'rust', go: 'go', java: 'java',
        cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
        css: 'css', scss: 'scss', less: 'less',
        html: 'html', vue: 'vue', svelte: 'svelte',
        json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
        md: 'markdown', sql: 'sql', sh: 'bash', bash: 'bash',
        xml: 'xml', graphql: 'graphql', prisma: 'prisma',
    }
    return langMap[ext || ''] || 'text'
}

/**
 * 流式模式下的简化 diff：只显示新内容为新增行
 * 不做完整 diff 计算，性能更好
 * 限制最大行数避免卡顿
 */
function createStreamingDiff(newContent: string, maxLines = 100): DiffLine[] {
    if (!newContent) return []
    
    const lines = newContent.split('\n').slice(0, maxLines)
    return lines.map((content, idx) => ({
        type: 'add' as const,
        content: content.slice(0, 500), // 限制单行长度
        newLineNumber: idx + 1,
    }))
}

/**
 * 完整 diff 计算（异步）
 */
function computeFullDiff(oldContent: string, newContent: string): DiffLine[] {
    const changes = Diff.diffLines(oldContent, newContent)
    const result: DiffLine[] = []
    
    let oldLineNum = 1
    let newLineNum = 1

    for (const change of changes) {
        const lines = change.value.split('\n')
        // 移除最后一个空行（split 产生的）
        if (lines[lines.length - 1] === '') {
            lines.pop()
        }

        for (const line of lines) {
            if (change.added) {
                result.push({
                    type: 'add',
                    content: line,
                    newLineNumber: newLineNum++
                })
            } else if (change.removed) {
                result.push({
                    type: 'remove',
                    content: line,
                    oldLineNumber: oldLineNum++
                })
            } else {
                result.push({
                    type: 'unchanged',
                    content: line,
                    oldLineNumber: oldLineNum++,
                    newLineNumber: newLineNum++
                })
            }
        }
    }
    return result
}

// 异步计算 diff（支持流式模式优化）
function useAsyncDiff(
    oldContent: string, 
    newContent: string, 
    isStreaming: boolean,
    enabled: boolean
) {
    const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    
    // 节流控制
    const lastUpdateRef = useRef<number>(0)
    const pendingUpdateRef = useRef<NodeJS.Timeout | null>(null)

    useEffect(() => {
        if (!enabled) {
            setDiffLines(null)
            return
        }

        if (!oldContent && !newContent) {
            setDiffLines([])
            return
        }

        // 清理待处理的更新
        if (pendingUpdateRef.current) {
            clearTimeout(pendingUpdateRef.current)
            pendingUpdateRef.current = null
        }

        // 流式模式：使用简化 diff，带节流
        if (isStreaming) {
            const now = Date.now()
            const timeSinceLastUpdate = now - lastUpdateRef.current

            const doStreamingUpdate = () => {
                lastUpdateRef.current = Date.now()
                // 流式模式：如果没有旧内容，直接显示新内容为新增
                // 如果有旧内容，也只显示新内容（避免频繁 diff）
                const streamingLines = createStreamingDiff(newContent)
                setDiffLines(streamingLines)
                setIsLoading(false)
                setError(null)
            }

            if (timeSinceLastUpdate >= STREAMING_THROTTLE_MS) {
                // 立即更新
                doStreamingUpdate()
            } else {
                // 节流：延迟更新
                pendingUpdateRef.current = setTimeout(
                    doStreamingUpdate, 
                    STREAMING_THROTTLE_MS - timeSinceLastUpdate
                )
            }
            return
        }

        // 非流式模式：完整 diff 计算
        // 大文件检查
        if (oldContent.length + newContent.length > MAX_FILE_SIZE_FOR_DIFF * 2) {
            setError("File too large for inline diff. Open in editor to view changes.")
            setIsLoading(false)
            return
        }

        setIsLoading(true)
        setError(null)

        // 使用 setTimeout 将计算移出当前事件循环，让 UI 先响应
        const timerId = setTimeout(() => {
            try {
                if (oldContent.length + newContent.length > MAX_FILE_SIZE_FOR_DIFF * 2) {
                    throw new Error("File too large")
                }

                const result = computeFullDiff(oldContent, newContent)
                setDiffLines(result)
            } catch (err) {
                logger.ui.error("Diff calculation failed:", err)
                setError("Diff calculation too complex or timed out.")
            } finally {
                setIsLoading(false)
            }
        }, 50)

        return () => {
            clearTimeout(timerId)
            if (pendingUpdateRef.current) {
                clearTimeout(pendingUpdateRef.current)
            }
        }
    }, [oldContent, newContent, isStreaming, enabled])

    return { diffLines, isLoading, error }
}

// 自定义 SyntaxHighlighter 样式
const customStyle = {
    ...oneDark,
    'pre[class*="language-"]': {
        ...oneDark['pre[class*="language-"]'],
        margin: 0,
        padding: 0,
        background: 'transparent',
        fontSize: '11px',
        lineHeight: '1.4',
    },
    'code[class*="language-"]': {
        ...oneDark['code[class*="language-"]'],
        background: 'transparent',
        fontSize: '11px',
    },
}

// 提取单个行组件并使用 React.memo 优化性能
const DiffLineItem = React.memo(({ line, language }: { line: DiffLine, language: string }) => {
    const bgClass = line.type === 'add'
        ? 'bg-green-500/15 border-l-2 border-green-500/50'
        : line.type === 'remove'
            ? 'bg-red-500/15 border-l-2 border-red-500/50'
            : 'border-l-2 border-transparent'

    const symbolClass = line.type === 'add'
        ? 'text-green-400'
        : line.type === 'remove'
            ? 'text-red-400'
            : 'text-text-muted/30'

    const symbol = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
    const lineNum = line.type === 'remove' ? line.oldLineNumber : line.newLineNumber

    return (
        <div className={`flex ${bgClass} hover:brightness-110 transition-all`}>
            {/* 行号 */}
            <span className="w-8 shrink-0 text-right pr-2 text-text-muted/40 select-none text-[10px]">
                {lineNum || ''}
            </span>

            {/* 符号 */}
            <span className={`w-4 shrink-0 text-center select-none font-bold ${symbolClass}`}>
                {symbol}
            </span>

            {/* 代码内容 - 如果行超长，截断它以保护渲染性能 */}
            <div className="flex-1 overflow-hidden">
                {line.content.length > 500 ? (
                     <div className="whitespace-pre text-text-muted truncate">
                        {line.content.slice(0, 500)}... (line too long)
                     </div>
                ) : (
                    <SyntaxHighlighter
                        language={language}
                        style={customStyle}
                        customStyle={{
                            margin: 0,
                            padding: 0,
                            background: 'transparent',
                            whiteSpace: 'pre',
                            overflow: 'visible',
                        }}
                        wrapLines={false}
                        PreTag="span"
                        CodeTag="span"
                    >
                        {line.content || ' '}
                    </SyntaxHighlighter>
                )}
            </div>
        </div>
    )
})

DiffLineItem.displayName = 'DiffLineItem'

// 骨架屏组件 - 使用统一的 CodeSkeleton
export const DiffSkeleton = CodeSkeleton

export default function InlineDiffPreview({
    oldContent,
    newContent,
    filePath,
    isStreaming = false,
    maxLines = 100,
}: InlineDiffPreviewProps) {
    const language = useMemo(() => getLanguageFromPath(filePath), [filePath])
    
    // 使用优化后的异步 diff hook
    const { diffLines, isLoading, error } = useAsyncDiff(
        oldContent, 
        newContent, 
        isStreaming,
        true
    )

    // 智能过滤：只显示变更行及其上下文
    const displayLines = useMemo(() => {
        if (!diffLines) return []

        // 1. 如果总行数在限制内，直接显示全部
        if (diffLines.length <= maxLines) {
            return diffLines
        }

        // 2. 流式模式或纯新增文件：直接截断显示
        // 流式模式下不需要计算上下文，因为全是新增行
        if (isStreaming) {
            const truncated = diffLines.slice(0, maxLines)
            if (diffLines.length > maxLines) {
                return [...truncated, { type: 'ellipsis', count: diffLines.length - maxLines }] as (DiffLine | { type: 'ellipsis'; count: number })[]
            }
            return truncated
        }

        // 3. 如果是纯新增/纯删除文件（或几乎全是变更），直接截断
        const changedCount = diffLines.filter(l => l.type !== 'unchanged').length
        if (changedCount > maxLines * 0.8) {
            const truncated = diffLines.slice(0, maxLines)
            return [...truncated, { type: 'ellipsis', count: diffLines.length - maxLines }] as (DiffLine | { type: 'ellipsis'; count: number })[]
        }

        // 4. 常规 Diff：计算上下文
        const contextSize = 3 
        const changedIndices = new Set<number>()

        diffLines.forEach((line, idx) => {
            if (line.type === 'add' || line.type === 'remove') {
                for (let i = Math.max(0, idx - contextSize); i <= Math.min(diffLines.length - 1, idx + contextSize); i++) {
                    changedIndices.add(i)
                }
            }
        })

        const result: (DiffLine | { type: 'ellipsis'; count: number })[] = []
        let lastIdx = -1
        const sortedIndices = Array.from(changedIndices).sort((a, b) => a - b)

        for (const idx of sortedIndices) {
            if (lastIdx >= 0 && idx - lastIdx > 1) {
                result.push({ type: 'ellipsis', count: idx - lastIdx - 1 })
            }
            result.push(diffLines[idx])
            lastIdx = idx
            
            if (result.length >= maxLines) {
                result.push({ type: 'ellipsis', count: diffLines.length - idx - 1 })
                return result
            }
        }

        if (lastIdx < diffLines.length - 1) {
            result.push({ type: 'ellipsis', count: diffLines.length - lastIdx - 1 })
        }

        return result
    }, [diffLines, maxLines, isStreaming])

    // 流式模式下不显示 loading（因为有节流，会有短暂延迟）
    if (isLoading && !isStreaming) {
        return <DiffSkeleton />
    }

    if (error) {
        return (
            <div className="px-4 py-3 text-xs text-text-muted bg-white/5 italic text-center">
                {error}
            </div>
        )
    }

    if (!diffLines || displayLines.length === 0) {
        return (
            <div className="text-[10px] text-text-muted italic px-2 py-1">
                {isStreaming ? 'Waiting for content...' : 'No changes'}
            </div>
        )
    }

    return (
        <div className="font-mono text-[11px] leading-relaxed">
            {/* 流式模式指示器 */}
            {isStreaming && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 border-b border-accent/20 text-accent text-[10px]">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    <span>Streaming changes...</span>
                </div>
            )}
            
            {displayLines.map((line, idx) => {
                if ('count' in line && line.type === 'ellipsis') {
                    return (
                        <div key={`ellipsis-${idx}`} className="text-text-muted/40 text-center py-1 text-[10px] bg-white/5">
                            ··· {line.count} {isStreaming ? 'more' : 'unchanged'} lines ···
                        </div>
                    )
                }

                return (
                    <DiffLineItem
                        key={`${(line as DiffLine).type}-${idx}-${(line as DiffLine).oldLineNumber || (line as DiffLine).newLineNumber}`}
                        line={line as DiffLine}
                        language={language}
                    />
                )
            })}
        </div>
    )
}

// 导出统计工具函数
export function getDiffStats(oldContent: string, newContent: string): { added: number; removed: number } {
    if (oldContent.length + newContent.length > MAX_FILE_SIZE_FOR_DIFF * 2) {
        return { added: 0, removed: 0 }
    }

    try {
        const changes = Diff.diffLines(oldContent, newContent)
        
        let added = 0
        let removed = 0
        
        for (const change of changes) {
            const lineCount = change.value.split('\n').filter(l => l !== '' || change.value === '\n').length
            
            if (change.added) {
                added += lineCount
            } else if (change.removed) {
                removed += lineCount
            }
        }
    
        return { added, removed }
    } catch {
        return { added: 0, removed: 0 }
    }
}
