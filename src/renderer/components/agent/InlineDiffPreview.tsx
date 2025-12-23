/**
 * InlineDiffPreview - 轻量级内联 Diff 预览组件
 * 用于在聊天面板中显示代码变更的 unified diff 视图
 * 支持语法高亮、删除/新增行颜色区分
 */

import React, { useMemo } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

export interface DiffLine {
    type: 'add' | 'remove' | 'unchanged' | 'context'
    content: string
    oldLineNumber?: number
    newLineNumber?: number
}

interface InlineDiffPreviewProps {
    oldContent: string
    newContent: string
    filePath: string
    isStreaming?: boolean
    maxLines?: number
}

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

// 简单的 diff 算法 - 基于双指针比较
function computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
    // 性能保护：如果文件过大，降级为简单显示，避免卡死 UI
    if (oldLines.length + newLines.length > 3000) {
        return newLines.map((line, i) => ({
            type: 'add',
            content: line,
            newLineNumber: i + 1
        }))
    }

    const result: DiffLine[] = []

    let oldIdx = 0
    let newIdx = 0
    let oldLineNum = 1
    let newLineNum = 1

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
        const oldLine = oldLines[oldIdx]
        const newLine = newLines[newIdx]

        if (oldIdx >= oldLines.length) {
            result.push({ type: 'add', content: newLine, newLineNumber: newLineNum++ })
            newIdx++
        } else if (newIdx >= newLines.length) {
            result.push({ type: 'remove', content: oldLine, oldLineNumber: oldLineNum++ })
            oldIdx++
        } else if (oldLine === newLine) {
            result.push({ type: 'unchanged', content: oldLine, oldLineNumber: oldLineNum++, newLineNumber: newLineNum++ })
            oldIdx++
            newIdx++
        } else {
            const lookAhead = 3
            let foundInOld = -1
            let foundInNew = -1

            for (let i = 0; i < lookAhead && newIdx + i < newLines.length; i++) {
                if (newLines[newIdx + i] === oldLine) { foundInNew = i; break }
            }
            for (let i = 0; i < lookAhead && oldIdx + i < oldLines.length; i++) {
                if (oldLines[oldIdx + i] === newLine) { foundInOld = i; break }
            }

            if (foundInNew >= 0 && (foundInOld < 0 || foundInNew <= foundInOld)) {
                for (let i = 0; i < foundInNew; i++) {
                    result.push({ type: 'add', content: newLines[newIdx + i], newLineNumber: newLineNum++ })
                }
                newIdx += foundInNew
            } else if (foundInOld >= 0) {
                for (let i = 0; i < foundInOld; i++) {
                    result.push({ type: 'remove', content: oldLines[oldIdx + i], oldLineNumber: oldLineNum++ })
                }
                oldIdx += foundInOld
            } else {
                result.push({ type: 'remove', content: oldLine, oldLineNumber: oldLineNum++ })
                result.push({ type: 'add', content: newLine, newLineNumber: newLineNum++ })
                oldIdx++
                newIdx++
            }
        }
    }

    return result
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

            {/* 代码内容 */}
            <div className="flex-1 overflow-hidden">
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
            </div>
        </div>
    )
})

export default function InlineDiffPreview({
    oldContent,
    newContent,
    filePath,
    isStreaming = false,
    maxLines = 50,
}: InlineDiffPreviewProps) {
    const language = useMemo(() => getLanguageFromPath(filePath), [filePath])

    const diffLines = useMemo(() => {
        const oldLines = oldContent.split('\n')
        const newLines = newContent.split('\n')
        return computeDiff(oldLines, newLines)
    }, [oldContent, newContent])

    // 过滤只显示变更行及其上下文
    const displayLines = useMemo(() => {
        if (diffLines.length <= maxLines) return diffLines

        const contextSize = 2
        const changedIndices = new Set<number>()

        diffLines.forEach((line, idx) => {
            if (line.type === 'add' || line.type === 'remove') {
                for (let i = Math.max(0, idx - contextSize); i <= Math.min(diffLines.length - 1, idx + contextSize); i++) {
                    changedIndices.add(i)
                }
            }
        })

        const result: (DiffLine | { type: 'ellipsis' })[] = []
        let lastIdx = -1

        Array.from(changedIndices).sort((a, b) => a - b).forEach(idx => {
            if (lastIdx >= 0 && idx - lastIdx > 1) {
                result.push({ type: 'ellipsis' })
            }
            result.push(diffLines[idx])
            lastIdx = idx
        })

        return result.slice(0, maxLines)
    }, [diffLines, maxLines])

    if (displayLines.length === 0) {
        return (
            <div className="text-[10px] text-text-muted italic px-2 py-1">
                No changes
            </div>
        )
    }

    return (
        <div className="font-mono text-[11px] leading-relaxed">
            {displayLines.map((line, idx) => {
                if ('type' in line && line.type === 'ellipsis') {
                    return (
                        <div key={`ellipsis-${idx}`} className="text-text-muted/50 text-center py-0.5 text-[10px]">
                            ···
                        </div>
                    )
                }

                return (
                    <DiffLineItem
                        key={`${(line as DiffLine).type}-${idx}`}
                        line={line as DiffLine}
                        language={language}
                    />
                )
            })}

            {/* 流式生成指示器 */}
            {isStreaming && (
                <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-accent">
                    <span className="inline-block w-1.5 h-3 bg-accent animate-pulse rounded-sm" />
                    <span className="opacity-70">Generating...</span>
                </div>
            )}

            {/* 截断提示 */}
            {diffLines.length > maxLines && (
                <div className="text-[10px] text-text-muted/60 text-center py-1 border-t border-white/5">
                    ... {diffLines.length - maxLines} more lines
                </div>
            )}
        </div>
    )
}

// 导出统计工具函数
export function getDiffStats(oldContent: string, newContent: string): { added: number; removed: number } {
    const oldLines = oldContent.split('\n')
    const newLines = newContent.split('\n')
    const diff = computeDiff(oldLines, newLines)

    let added = 0
    let removed = 0
    diff.forEach(line => {
        if (line.type === 'add') added++
        if (line.type === 'remove') removed++
    })

    return { added, removed }
}
