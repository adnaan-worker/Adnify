/**
 * useComposerInlineDiff
 * Renders inline diffs in the Monaco editor for pending composer changes.
 */

import { useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { composerService, FileChange } from '@renderer/agent/services/composerService'
import { computeDiff } from '../DiffViewer'
import { useStore } from '@store'

export function useComposerInlineDiff(
    activeFilePath: string | null,
    editorInstance: editor.IStandaloneCodeEditor | null,
    monacoInstance: typeof import('monaco-editor') | typeof import('monaco-editor/esm/vs/editor/editor.api') | null
) {
    const { editorConfig } = useStore()
    const [pendingChange, setPendingChange] = useState<FileChange | null>(null)
    const [debouncedChange, setDebouncedChange] = useState<FileChange | null>(null)
    const zoneIdsRef = useRef<string[]>([])
    const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
    const containerRefs = useRef<HTMLElement[]>([])
    const timerRef = useRef<NodeJS.Timeout | null>(null)

    // Listen to Composer Service
    useEffect(() => {
        if (!activeFilePath || !editorConfig.enableInlineDiff) {
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
    }, [activeFilePath, editorConfig.enableInlineDiff])

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
        if (!editorInstance || !monacoInstance || !editorConfig.enableInlineDiff) return

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
                for (const block of removedBlocks) {
                    const domNode = document.createElement('div')
                    domNode.className = 'inline-diff-remove-zone'
                    domNode.style.fontFamily = 'monospace'
                    domNode.style.fontSize = '13px'
                    domNode.style.lineHeight = '1.5'
                    domNode.style.pointerEvents = 'none'

                    block.lines.forEach((text) => {
                        const lineDiv = document.createElement('div')
                        lineDiv.style.display = 'flex'
                        lineDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.1)'
                        lineDiv.style.color = '#ff6b6b'

                        const gutter = document.createElement('div')
                        gutter.style.width = '64px'
                        gutter.style.textAlign = 'right'
                        gutter.style.paddingRight = '16px'
                        gutter.style.borderRight = '1px solid rgba(255, 255, 255, 0.1)'
                        gutter.style.opacity = '0.5'
                        gutter.textContent = '-'
                        gutter.style.flexShrink = '0'
                        gutter.style.marginRight = '8px'

                        const contentNode = document.createElement('div')
                        contentNode.style.whiteSpace = 'pre'
                        contentNode.textContent = text || ' '

                        lineDiv.appendChild(gutter)
                        lineDiv.appendChild(contentNode)
                        domNode.appendChild(lineDiv)
                    })

                    containerRefs.current.push(domNode)

                    const zoneId = accessor.addZone({
                        afterLineNumber: block.afterLineNumber,
                        heightInLines: block.lines.length,
                        domNode: domNode,
                        marginDomNode: document.createElement('div'),
                    })
                    zoneIdsRef.current.push(zoneId)
                }
            })
        }

        return cleanup
    }, [debouncedChange, editorInstance, monacoInstance, editorConfig.enableInlineDiff])

    return pendingChange !== null
}
