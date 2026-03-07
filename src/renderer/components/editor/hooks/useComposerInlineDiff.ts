/**
 * useComposerInlineDiff
 * Renders inline diffs in the Monaco editor for pending composer changes.
 */

import { useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { composerService, FileChange } from '@renderer/agent/services/composerService'
import { computeDiff } from '../DiffViewer'

export function useComposerInlineDiff(
    activeFilePath: string | null,
    editorInstance: editor.IStandaloneCodeEditor | null,
    monacoInstance: typeof import('monaco-editor') | typeof import('monaco-editor/esm/vs/editor/editor.api') | null
) {
    const [pendingChange, setPendingChange] = useState<FileChange | null>(null)
    const zoneIdsRef = useRef<string[]>([])
    const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
    const containerRefs = useRef<HTMLElement[]>([])

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

        if (!pendingChange || !pendingChange.oldContent || !pendingChange.newContent) {
            cleanup()
            return
        }

        // Here we assume the editor buffer CONTAINS the newContent,
        // so we will show additions as green highlights, and deletions as red view zones.
        // If the editor currently has oldContent and hasn't been updated to newContent yet,
        // we should wait or update it. For now, we calculate diff against current editor value.
        const currentModelValue = editorInstance.getValue()
        const currentOldContent = pendingChange.oldContent

        const diffLines = computeDiff(currentOldContent, currentModelValue)
        const decorationsModel: editor.IModelDeltaDecoration[] = []

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
                // A line was added, so any pending removed block can be attached before it
                if (currentBlock) {
                    removedBlocks.push(currentBlock)
                    currentBlock = null
                }
            } else if (line.type === 'remove' && line.content !== undefined) {
                if (!currentBlock) {
                    // Try to figure out where to place it. We place it AFTER the previous unchanged/add line
                    let attachLine = 0
                    // Go back to find a valid new line number
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

        // 1. Add green highlights for added lines
        if (decorationsModel.length > 0) {
            decorationsRef.current = editorInstance.createDecorationsCollection(decorationsModel)
        }

        // 2. Add red View Zones for removed lines
        if (removedBlocks.length > 0) {
            editorInstance.changeViewZones((accessor: editor.IViewZoneChangeAccessor) => {
                for (const block of removedBlocks) {
                    const domNode = document.createElement('div')
                    domNode.className = 'inline-diff-remove-zone'
                    domNode.style.fontFamily = 'monospace'
                    domNode.style.fontSize = '13px'
                    domNode.style.lineHeight = '1.5'
                    domNode.style.pointerEvents = 'none'

                    block.lines.forEach((text, lineIdx) => {
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
                        // We could also show the original line number if tracked, but empty is fine for ghost deletions
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
                        marginDomNode: document.createElement('div'), // Empty margin
                    })
                    zoneIdsRef.current.push(zoneId)
                }
            })
        }

        return cleanup
    }, [pendingChange, editorInstance, monacoInstance])

    return pendingChange !== null
}
