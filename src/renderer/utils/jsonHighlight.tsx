/**
 * JSON 语法高亮工具
 * 用于在工具调用参数展示时提供代码着色
 */

import React, { useCallback } from 'react'
import { api } from '@/renderer/services/electronAPI'
import { useStore } from '@store'
import { joinPath } from '@shared/utils/pathUtils'

export interface HighlightStyle {
    string: string
    number: string
    boolean: string
    null: string
    key: string
    punctuation: string
}

const defaultStyle: HighlightStyle = {
    string: 'text-green-400',
    number: 'text-blue-400',
    boolean: 'text-yellow-400',
    null: 'text-gray-400',
    key: 'text-purple-400',
    punctuation: 'text-text-muted',
}

/**
 * 将 JSON 字符串转换为带语法高亮的 React 元素
 */
export function highlightJson(
    json: string | unknown,
    style: Partial<HighlightStyle> = {},
    onFileClick?: (path: string) => void
): React.ReactNode {
    const s = { ...defaultStyle, ...style }

    let text: string
    if (typeof json === 'string') {
        try {
            // 尝试格式化 JSON
            text = JSON.stringify(JSON.parse(json), null, 2)
        } catch {
            text = json
        }
    } else {
        text = JSON.stringify(json, null, 2)
    }

    if (!text) return null

    const tokens: React.ReactNode[] = []
    let i = 0
    let keyIdx = 0

    while (i < text.length) {
        const char = text[i]

        // 字符串
        if (char === '"') {
            const start = i
            i++
            while (i < text.length && (text[i] !== '"' || text[i - 1] === '\\')) {
                i++
            }
            i++ // 包含结束引号
            const str = text.slice(start, i)

            const nextNonSpace = text.slice(i).match(/^\s*:/)
            const innerStr = str.slice(1, -1) // 去掉外层引号

            // 判断是否像一个文件路径 (值或键中的字符串)
            // 1. 包含点号或斜杠，并且不包含空格或换行
            // 2. 或是绝对路径 (以 / 或 C: 之类开头)
            const isPossibleFilePath =
                ((innerStr.includes('.') || innerStr.includes('/')) && !/\s/.test(innerStr) && innerStr.length > 0) ||
                /^([a-zA-Z]:[\\/]|[/])/.test(innerStr)

            if (isPossibleFilePath && onFileClick) {
                const clickSpan = (
                    <span
                        className="cursor-pointer hover:underline hover:text-accent transition-colors"
                        onClick={(e) => {
                            e.stopPropagation()
                            onFileClick(innerStr)
                        }}
                        title="Click to open file"
                    >
                        {innerStr}
                    </span>
                )

                if (nextNonSpace) {
                    tokens.push(
                        <span key={keyIdx++} className={s.key}>"{clickSpan}"</span>
                    )
                } else {
                    tokens.push(
                        <span key={keyIdx++} className={s.string}>"{clickSpan}"</span>
                    )
                }
            } else {
                if (nextNonSpace) {
                    tokens.push(<span key={keyIdx++} className={s.key}>{str}</span>)
                } else {
                    tokens.push(<span key={keyIdx++} className={s.string}>{str}</span>)
                }
            }
            continue
        }

        // 数字
        if (char === '-' || (char >= '0' && char <= '9')) {
            const start = i
            while (i < text.length && /[\d.eE+-]/.test(text[i])) {
                i++
            }
            tokens.push(
                <span key={keyIdx++} className={s.number}>{text.slice(start, i)}</span>
            )
            continue
        }

        // true/false/null
        if (text.slice(i, i + 4) === 'true') {
            tokens.push(<span key={keyIdx++} className={s.boolean}>true</span>)
            i += 4
            continue
        }
        if (text.slice(i, i + 5) === 'false') {
            tokens.push(<span key={keyIdx++} className={s.boolean}>false</span>)
            i += 5
            continue
        }
        if (text.slice(i, i + 4) === 'null') {
            tokens.push(<span key={keyIdx++} className={s.null}>null</span>)
            i += 4
            continue
        }

        // 标点符号
        if ('{}[],:'.includes(char)) {
            tokens.push(<span key={keyIdx++} className={s.punctuation}>{char}</span>)
            i++
            continue
        }

        // 空白字符保持原样
        if (/\s/.test(char)) {
            // 收集连续空白
            const start = i
            while (i < text.length && /\s/.test(text[i])) {
                i++
            }
            tokens.push(text.slice(start, i))
            continue
        }

        // 其他字符
        tokens.push(char)
        i++
    }

    return <>{tokens}</>
}

/**
 * JSON 高亮预览组件
 */
export function JsonHighlight({
    data,
    className = '',
    maxHeight = 'max-h-64',
    maxLength = 2000, // 最大字符数
}: {
    data: unknown
    className?: string
    maxHeight?: string
    maxLength?: number
}) {
    // 预处理数据：截断过长的内容
    const processedData = React.useMemo(() => {
        let text: string
        if (typeof data === 'string') {
            text = data
        } else {
            try {
                text = JSON.stringify(data, null, 2)
            } catch {
                text = String(data)
            }
        }

        if (text.length > maxLength) {
            return {
                content: text.slice(0, maxLength),
                truncated: true,
                originalLength: text.length
            }
        }
        return { content: text, truncated: false, originalLength: text.length }
    }, [data, maxLength])

    const { workspacePath, openFile, setActiveFile } = useStore()

    const handleFileClick = useCallback(async (filePath: string) => {
        let absPath = filePath
        // 如果是相对路径，则拼上 workspacePath
        const isAbsolute = /^([a-zA-Z]:[\\/]|[/])/.test(filePath)
        if (!isAbsolute && workspacePath) {
            absPath = joinPath(workspacePath, absPath)
        }

        try {
            const content = await api.file.read(absPath)
            if (content !== null) {
                openFile(absPath, content)
                setActiveFile(absPath)
            } else {
                // 如果不仅是个文件，就不报错默默忽略（因为可能是误判）
                // toast.warning('Not a valid readable file.') 
            }
        } catch (error) {
            // 不弹出错误，因为这说明这个字符串实际上不是文件
        }
    }, [workspacePath, openFile, setActiveFile])

    return (
        <pre className={`text-xs font-mono overflow-auto ${maxHeight} ${className}`}>
            <code>{highlightJson(processedData.content, {}, handleFileClick)}</code>
            {processedData.truncated && (
                <span className="text-text-muted/50 italic block mt-2">
                    ... ({(processedData.originalLength / 1000).toFixed(1)}KB truncated)
                </span>
            )}
        </pre>
    )
}
