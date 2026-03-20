/**
 * Inline diff preview with a lightweight streaming path and a full diff path
 * once the tool has settled.
 */

import React, { useMemo, useState, useEffect, useRef } from 'react'
import { SyntaxHighlighter } from '@renderer/utils/syntaxHighlighter'
import { oneDark, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useStore } from '@store'
import * as Diff from 'diff'
import { CodeSkeleton } from '../ui/Loading'
import { logger } from '@shared/utils/Logger'
import { getExtension } from '@shared/utils/pathUtils'

export interface DiffLine {
    type: 'add' | 'remove' | 'unchanged'
    content: string
    oldLineNumber?: number
    newLineNumber?: number
}

type DisplayDiffLine = DiffLine | { type: 'ellipsis'; count: number }

interface InlineDiffPreviewProps {
    oldContent: string
    newContent: string
    filePath: string
    isStreaming?: boolean
    maxLines?: number
}

type ScheduledFrame =
    | { kind: 'raf'; id: number }
    | { kind: 'timeout'; id: ReturnType<typeof setTimeout> }

const MAX_FILE_SIZE_FOR_DIFF = 50000

const scheduleNextFrame = (callback: () => void): ScheduledFrame => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        return { kind: 'raf', id: window.requestAnimationFrame(callback) }
    }

    return { kind: 'timeout', id: setTimeout(callback, 16) }
}

const cancelScheduledFrame = (frame: ScheduledFrame): void => {
    if (frame.kind === 'raf') {
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(frame.id)
            return
        }

        clearTimeout(frame.id)
        return
    }

    clearTimeout(frame.id)
}

function getLanguageFromPath(path: string): string {
    const ext = getExtension(path)
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

function createStreamingDiff(newContent: string, maxLines = 100): DiffLine[] {
    if (!newContent) return []

    const lines = newContent.split('\n').slice(0, maxLines)
    return lines.map((content, idx) => ({
        type: 'add' as const,
        content: content.slice(0, 500),
        newLineNumber: idx + 1,
    }))
}

function computeFullDiff(oldContent: string, newContent: string): DiffLine[] {
    const changes = Diff.diffLines(oldContent, newContent)
    const result: DiffLine[] = []

    let oldLineNum = 1
    let newLineNum = 1

    for (const change of changes) {
        const lines = change.value.split('\n')
        if (lines[lines.length - 1] === '') {
            lines.pop()
        }

        for (const line of lines) {
            if (change.added) {
                result.push({
                    type: 'add',
                    content: line,
                    newLineNumber: newLineNum++,
                })
            } else if (change.removed) {
                result.push({
                    type: 'remove',
                    content: line,
                    oldLineNumber: oldLineNum++,
                })
            } else {
                result.push({
                    type: 'unchanged',
                    content: line,
                    oldLineNumber: oldLineNum++,
                    newLineNumber: newLineNum++,
                })
            }
        }
    }

    return result
}

export function countContentLines(content: string): number {
    if (!content) return 0

    let count = 1
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10) {
            count++
        }
    }

    return count
}

export function getApproxLineDeltaStats(oldContent: string, newContent: string): { added: number; removed: number } {
    const oldLines = countContentLines(oldContent)
    const newLines = countContentLines(newContent)

    return {
        added: Math.max(0, newLines - oldLines),
        removed: Math.max(0, oldLines - newLines),
    }
}

function useAsyncDiff(
    oldContent: string,
    newContent: string,
    isStreaming: boolean,
    enabled: boolean,
    maxLines: number
) {
    const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const pendingFrameRef = useRef<ScheduledFrame | null>(null)

    useEffect(() => {
        if (!enabled) {
            setDiffLines(null)
            return
        }

        if (!oldContent && !newContent) {
            setDiffLines([])
            setIsLoading(false)
            setError(null)
            return
        }

        if (pendingFrameRef.current) {
            cancelScheduledFrame(pendingFrameRef.current)
            pendingFrameRef.current = null
        }

        if (isStreaming) {
            setIsLoading(false)
            setError(null)

            pendingFrameRef.current = scheduleNextFrame(() => {
                pendingFrameRef.current = null
                setDiffLines(createStreamingDiff(newContent, maxLines))
            })

            return () => {
                if (pendingFrameRef.current) {
                    cancelScheduledFrame(pendingFrameRef.current)
                    pendingFrameRef.current = null
                }
            }
        }

        if (oldContent.length + newContent.length > MAX_FILE_SIZE_FOR_DIFF * 2) {
            setError('File too large for inline diff. Open in editor to view changes.')
            setIsLoading(false)
            return
        }

        setIsLoading(true)
        setError(null)

        const timerId = setTimeout(() => {
            try {
                if (oldContent.length + newContent.length > MAX_FILE_SIZE_FOR_DIFF * 2) {
                    throw new Error('File too large')
                }

                setDiffLines(computeFullDiff(oldContent, newContent))
            } catch (err) {
                logger.ui.error('Diff calculation failed:', err)
                setError('Diff calculation too complex or timed out.')
            } finally {
                setIsLoading(false)
            }
        }, 50)

        return () => {
            clearTimeout(timerId)
            if (pendingFrameRef.current) {
                cancelScheduledFrame(pendingFrameRef.current)
                pendingFrameRef.current = null
            }
        }
    }, [oldContent, newContent, isStreaming, enabled, maxLines])

    return { diffLines, isLoading, error }
}

const getCustomStyle = (isLight: boolean) => {
    const baseStyle = isLight ? vs : oneDark
    return {
        ...baseStyle,
        'pre[class*="language-"]': {
            ...baseStyle['pre[class*="language-"]'],
            margin: 0,
            padding: 0,
            background: 'transparent',
            backgroundColor: 'transparent',
            border: 'none',
            boxShadow: 'none',
            fontSize: '11px',
            lineHeight: '1.4',
            textShadow: 'none',
        },
        'code[class*="language-"]': {
            ...baseStyle['code[class*="language-"]'],
            background: 'transparent',
            backgroundColor: 'transparent',
            border: 'none',
            boxShadow: 'none',
            fontSize: '11px',
            textShadow: 'none',
        },
    }
}

const DiffLineItem = React.memo(({ line, language, style }: { line: DiffLine, language: string, style: any }) => {
    const bgClass = line.type === 'add'
        ? 'bg-green-500/15 border-l-2 border-green-500/50'
        : line.type === 'remove'
            ? 'bg-red-500/15 border-l-2 border-red-500/50'
            : 'border-l-2 border-transparent'

    const symbolClass = line.type === 'add'
        ? 'text-green-500 dark:text-green-400'
        : line.type === 'remove'
            ? 'text-red-500 dark:text-red-400'
            : 'text-text-muted/30'

    const symbol = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
    const lineNum = line.type === 'remove' ? line.oldLineNumber : line.newLineNumber

    return (
        <div className={`flex ${bgClass} hover:brightness-95 dark:hover:brightness-110 transition-all`}>
            <span className="w-8 shrink-0 text-right pr-2 text-text-muted/40 select-none text-[10px]">
                {lineNum || ''}
            </span>

            <span className={`w-4 shrink-0 text-center select-none font-bold ${symbolClass}`}>
                {symbol}
            </span>

            <div className="flex-1 overflow-hidden">
                {line.content.length > 500 ? (
                    <div className="whitespace-pre text-text-muted truncate">
                        {line.content.slice(0, 500)}... (line too long)
                    </div>
                ) : (
                    <SyntaxHighlighter
                        language={language}
                        style={style}
                        customStyle={{
                            margin: 0,
                            padding: 0,
                            background: 'transparent',
                            border: 'none',
                            boxShadow: 'none',
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

export const DiffSkeleton = CodeSkeleton

export default function InlineDiffPreview({
    oldContent,
    newContent,
    filePath,
    isStreaming = false,
    maxLines = 100,
}: InlineDiffPreviewProps) {
    const language = useMemo(() => getLanguageFromPath(filePath), [filePath])
    const currentTheme = useStore(s => s.currentTheme)
    const isLight = currentTheme === 'dawn'
    const codeStyle = useMemo(() => getCustomStyle(isLight), [isLight])

    const { diffLines, isLoading, error } = useAsyncDiff(
        oldContent,
        newContent,
        isStreaming,
        true,
        maxLines
    )

    const displayLines = useMemo<DisplayDiffLine[]>(() => {
        if (!diffLines) return []

        if (diffLines.length <= maxLines) {
            return diffLines
        }

        if (isStreaming) {
            const truncated = diffLines.slice(0, maxLines)
            if (diffLines.length > maxLines) {
                return [...truncated, { type: 'ellipsis', count: diffLines.length - maxLines }]
            }
            return truncated
        }

        const changedCount = diffLines.filter(l => l.type !== 'unchanged').length
        if (changedCount > maxLines * 0.8) {
            const truncated = diffLines.slice(0, maxLines)
            return [...truncated, { type: 'ellipsis', count: diffLines.length - maxLines }]
        }

        const contextSize = 3
        const changedIndices = new Set<number>()

        diffLines.forEach((line, idx) => {
            if (line.type === 'add' || line.type === 'remove') {
                for (let i = Math.max(0, idx - contextSize); i <= Math.min(diffLines.length - 1, idx + contextSize); i++) {
                    changedIndices.add(i)
                }
            }
        })

        const result: DisplayDiffLine[] = []
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
            {isStreaming && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 border-b border-accent/20 text-accent text-[10px]">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    <span>Streaming changes...</span>
                </div>
            )}

            {displayLines.map((line, idx) => {
                if ('count' in line && line.type === 'ellipsis') {
                    return (
                        <div key={`ellipsis-${idx}`} className="text-text-muted/40 text-center py-1 text-[10px] bg-surface-active/30">
                            ... {line.count} {isStreaming ? 'more' : 'unchanged'} lines ...
                        </div>
                    )
                }

                return (
                    <DiffLineItem
                        key={`${line.type}-${idx}-${line.oldLineNumber || line.newLineNumber}`}
                        line={line}
                        language={language}
                        style={codeStyle}
                    />
                )
            })}
        </div>
    )
}

export function getDiffStats(oldContent: string, newContent: string): { added: number; removed: number } {
    if (oldContent.length + newContent.length > MAX_FILE_SIZE_FOR_DIFF * 2) {
        return { added: 0, removed: 0 }
    }

    try {
        const changes = Diff.diffLines(oldContent, newContent)

        let added = 0
        let removed = 0

        for (const change of changes) {
            const lineCount = change.value.split('\n').filter(line => line !== '' || change.value === '\n').length

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
