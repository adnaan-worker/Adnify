
/**
 * useComposerInlineDiff
 * Renders inline diffs in the Monaco editor for pending composer changes.
 */

import { useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { composerService, FileChange } from '@renderer/agent/services/composerService'

// ===== 类型定义 =====
export interface DiffLine {
    type: 'add' | 'remove' | 'unchanged'
    content: string
    oldLineNum?: number
    newLineNum?: number
}

// ===== 优化的 LCS 算法 =====
function computeLCS(a: string[], b: string[]): string[] {
    const m = a.length
    const n = b.length

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

function computeLCSOptimized(a: string[], b: string[]): string[] {
    const m = a.length
    const n = b.length

    let prev = new Array(n + 1).fill(0)
    let curr = new Array(n + 1).fill(0)
    const path: number[][] = []

    for (let i = 1; i <= m; i++) {
        path[i] = []
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                curr[j] = prev[j - 1] + 1
                path[i][j] = 0
            } else if (prev[j] >= curr[j - 1]) {
                curr[j] = prev[j]
                path[i][j] = 1
            } else {
                curr[j] = curr[j - 1]
                path[i][j] = 2
            }
        }
        ;[prev, curr] = [curr, prev]
    }

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
export function computeDiff(original: string, modified: string): DiffLine[] {
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
                diff.push({ type: 'add', content: modifiedLines[newIdx], newLineNum: newIdx + 1 })
                newIdx++
            }
        } else if (oldIdx < originalLines.length) {
            diff.push({ type: 'remove', content: originalLines[oldIdx], oldLineNum: oldIdx + 1 })
            oldIdx++
        } else if (newIdx < modifiedLines.length) {
            diff.push({ type: 'add', content: modifiedLines[newIdx], newLineNum: newIdx + 1 })
            newIdx++
        }
    }

    return diff
}

export function useComposerInlineDiff(
    activeFilePath: string | null,
    editorInstance: editor.IStandaloneCodeEditor | null,
    monacoInstance: typeof import('monaco-editor') | typeof import('monaco-editor/esm/vs/editor/editor.api') | null
) {
    const [pendingChange, setPendingChange] = useState<FileChange | null>(null)
    const [debouncedChange, setDebouncedChange] = useState<FileChange | null>(null)
    const zoneIdsRef = useRef<string[]>([])
    const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
    const containerRefs = useRef<HTMLElement[]>([])
    const timerRef = useRef<NodeJS.Timeout | null>(null)

    // Listen to Composer Service
    useEffect(() => {
        if (!activeFilePath) {
            setPendingChange(null)
            return
        }

        const checkState = () => {
            const state = composerService.getState()
            const session = state.currentSession
            if (!session) {
                setPendingChange(null)
                return
            }

            const change = session.changes.find((c: FileChange) => c.filePath === activeFilePath && c.status === 'pending')
            setPendingChange(change || null)
        }

        checkState()
        return composerService.subscribe(checkState)
    }, [activeFilePath])

    // Debounce pendingChange updates to avoid high-frequency diffing during streaming
    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current)

        if (!pendingChange) {
            setDebouncedChange(null)
            return
        }

        // Low latency for the first update, then debounce
        const delay = debouncedChange ? 300 : 50
        timerRef.current = setTimeout(() => {
            setDebouncedChange(pendingChange)
        }, delay)

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [pendingChange])

    // Apply Inline Diff
    useEffect(() => {
        if (!editorInstance || !monacoInstance) return

        // Clean up previous zones and decorations
        const cleanup = () => {
            if (decorationsRef.current) {
                decorationsRef.current.clear()
                decorationsRef.current = null
            }
            if (zoneIdsRef.current.length > 0) {
                editorInstance.changeViewZones((accessor: editor.IViewZoneChangeAccessor) => {
                    zoneIdsRef.current.forEach(id => accessor.removeZone(id))
                })
                zoneIdsRef.current = []
            }
            containerRefs.current = []
        }

        if (!debouncedChange || !debouncedChange.oldContent || !debouncedChange.newContent) {
            cleanup()
            return
        }

        // Here we assume the editor buffer CONTAINS the newContent,
        const currentModelValue = editorInstance.getValue()
        const currentOldContent = debouncedChange.oldContent

        // Optimization: if values are same, no need to diff
        if (currentModelValue === currentOldContent) {
            cleanup()
            return
        }

        const diffLines = computeDiff(currentOldContent, currentModelValue)
        const decorationsModel: editor.IModelDeltaDecoration[] = []

        // ... rest of the logic
        // Group removed lines into continuous blocks
        const removedBlocks: { afterLineNumber: number; lines: string[] }[] = []
        let currentBlock: { afterLineNumber: number; lines: string[] } | null = null

        for (let i = 0; i < diffLines.length; i++) {
            const line = diffLines[i]

            if (line.type === 'add' && line.newLineNum) {
                decorationsModel.push({
                    range: new monacoInstance.Range(line.newLineNum, 1, line.newLineNum, 1),
                    options: {
                        isWholeLine: true,
                        className: 'inline-diff-add-line',
                        marginClassName: 'inline-diff-add-margin'
                    }
                })
                if (currentBlock) {
                    removedBlocks.push(currentBlock)
                    currentBlock = null
                }
            } else if (line.type === 'remove' && line.content !== undefined) {
                if (!currentBlock) {
                    let attachLine = 0
                    for (let j = i - 1; j >= 0; j--) {
                        if (diffLines[j].newLineNum) {
                            attachLine = diffLines[j].newLineNum!
                            break
                        }
                    }
                    currentBlock = { afterLineNumber: attachLine, lines: [] }
                }
                currentBlock.lines.push(line.content)
            } else if (line.type === 'unchanged') {
                if (currentBlock) {
                    removedBlocks.push(currentBlock)
                    currentBlock = null
                }
            }
        }

        if (currentBlock) {
            removedBlocks.push(currentBlock)
        }

        cleanup()

        if (decorationsModel.length > 0) {
            decorationsRef.current = editorInstance.createDecorationsCollection(decorationsModel)
        }

        if (removedBlocks.length > 0) {
            editorInstance.changeViewZones((accessor: editor.IViewZoneChangeAccessor) => {
                let lineHeight = 21
                let fontFamily = 'monospace'
                let fontSize = 14

                try {
                    lineHeight = editorInstance.getOption(monacoInstance.editor.EditorOption.lineHeight)
                    const fontInfo = editorInstance.getOption(monacoInstance.editor.EditorOption.fontInfo)
                    fontFamily = fontInfo.fontFamily
                    fontSize = fontInfo.fontSize
                } catch (e) { }

                for (const block of removedBlocks) {
                    const domNode = document.createElement('div')
                    domNode.className = 'inline-diff-remove-zone'
                    domNode.style.fontFamily = fontFamily
                    domNode.style.fontSize = `${fontSize}px`
                    domNode.style.lineHeight = `${lineHeight}px`
                    domNode.style.pointerEvents = 'none'

                    const marginDomNode = document.createElement('div')
                    marginDomNode.className = 'inline-diff-remove-zone'
                    marginDomNode.style.fontFamily = fontFamily
                    marginDomNode.style.fontSize = `${fontSize}px`
                    marginDomNode.style.lineHeight = `${lineHeight}px`
                    marginDomNode.style.pointerEvents = 'none'

                    block.lines.forEach((text) => {
                        // Content line
                        const lineDiv = document.createElement('div')
                        lineDiv.style.height = `${lineHeight}px`
                        lineDiv.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'
                        lineDiv.style.color = '#ff6b6b'
                        lineDiv.style.whiteSpace = 'pre'
                        lineDiv.textContent = text || ' '

                        // Margin line
                        const marginLineDiv = document.createElement('div')
                        marginLineDiv.style.height = `${lineHeight}px`
                        marginLineDiv.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'
                        marginLineDiv.style.color = '#ff6b6b'
                        marginLineDiv.style.display = 'flex'
                        marginLineDiv.style.justifyContent = 'flex-end'
                        marginLineDiv.style.alignItems = 'center'
                        marginLineDiv.style.borderRight = '1px dashed rgba(239, 68, 68, 0.3)'
                        marginLineDiv.style.boxSizing = 'border-box'
                        marginLineDiv.style.paddingRight = '16px'

                        const minusSpan = document.createElement('span')
                        minusSpan.textContent = '-'
                        minusSpan.style.opacity = '0.5'
                        marginLineDiv.appendChild(minusSpan)

                        domNode.appendChild(lineDiv)
                        marginDomNode.appendChild(marginLineDiv)
                    })

                    containerRefs.current.push(domNode)

                    const zoneId = accessor.addZone({
                        afterLineNumber: block.afterLineNumber,
                        heightInLines: block.lines.length,
                        domNode: domNode,
                        marginDomNode: marginDomNode,
                    })
                    zoneIdsRef.current.push(zoneId)
                }
            })
        }

        return cleanup
    }, [debouncedChange, editorInstance, monacoInstance])

    return pendingChange !== null
}
