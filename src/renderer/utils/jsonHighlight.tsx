/**
 * JSON 语法高亮工具
 * 用于在工具调用参数展示时提供代码着色
 */

import React from 'react'

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
    style: Partial<HighlightStyle> = {}
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

            // 判断是否是 key（后面紧跟 :）
            const nextNonSpace = text.slice(i).match(/^\s*:/)
            if (nextNonSpace) {
                tokens.push(
                    <span key={keyIdx++} className={s.key}>{str}</span>
                )
            } else {
                tokens.push(
                    <span key={keyIdx++} className={s.string}>{str}</span>
                )
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

    return (
        <pre className={`text-xs font-mono overflow-auto ${maxHeight} ${className}`}>
            <code>{highlightJson(processedData.content)}</code>
            {processedData.truncated && (
                <span className="text-text-muted/50 italic block mt-2">
                    ... ({(processedData.originalLength / 1000).toFixed(1)}KB truncated)
                </span>
            )}
        </pre>
    )
}
