/**
 * 编辑器断点装饰器 Hook
 * 在 Monaco 编辑器中显示断点并处理点击事件
 */
import { useEffect, useRef, useCallback } from 'react'
import type { editor } from 'monaco-editor'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'

// 断点装饰器样式
const BREAKPOINT_DECORATION: editor.IModelDecorationOptions = {
  glyphMarginClassName: 'breakpoint-glyph',
  glyphMarginHoverMessage: { value: 'Click to remove breakpoint' },
  stickiness: 1, // NeverGrowsWhenTypingAtEdges
}

const BREAKPOINT_DISABLED_DECORATION: editor.IModelDecorationOptions = {
  glyphMarginClassName: 'breakpoint-glyph-disabled',
  glyphMarginHoverMessage: { value: 'Breakpoint (disabled)' },
  stickiness: 1,
}

// 注入断点样式
function injectBreakpointStyles() {
  const styleId = 'breakpoint-styles'
  if (document.getElementById(styleId)) return

  const style = document.createElement('style')
  style.id = styleId
  style.textContent = `
    .breakpoint-glyph {
      background: rgb(var(--status-error));
      border-radius: 50%;
      width: 10px !important;
      height: 10px !important;
      margin-left: 5px;
      margin-top: 5px;
      cursor: pointer;
    }
    .breakpoint-glyph-disabled {
      background: rgb(var(--surface-muted));
      border-radius: 50%;
      width: 10px !important;
      height: 10px !important;
      margin-left: 5px;
      margin-top: 5px;
      cursor: pointer;
      opacity: 0.5;
    }
    .monaco-editor .margin-view-overlays .cgmr {
      cursor: pointer;
    }
    .breakpoint-candidate {
      background: rgb(var(--status-error) / 0.3);
      border-radius: 50%;
      width: 10px !important;
      height: 10px !important;
      margin-left: 5px;
      margin-top: 5px;
    }
  `
  document.head.appendChild(style)
}

export function useEditorBreakpoints(
  editor: editor.IStandaloneCodeEditor | null,
  filePath: string | null
) {
  const decorationsRef = useRef<string[]>([])
  const { breakpoints, toggleBreakpoint, getBreakpointsForFile } = useStore(useShallow(s => ({ breakpoints: s.breakpoints, toggleBreakpoint: s.toggleBreakpoint, getBreakpointsForFile: s.getBreakpointsForFile })))

  // 注入样式
  useEffect(() => {
    injectBreakpointStyles()
  }, [])

  // 更新断点装饰器
  const updateDecorations = useCallback(() => {
    if (!editor || !filePath) return

    const model = editor.getModel()
    if (!model) return

    const fileBreakpoints = getBreakpointsForFile(filePath)
    
    const newDecorations: editor.IModelDeltaDecoration[] = fileBreakpoints.map(bp => ({
      range: {
        startLineNumber: bp.line,
        startColumn: 1,
        endLineNumber: bp.line,
        endColumn: 1,
      },
      options: bp.enabled ? BREAKPOINT_DECORATION : BREAKPOINT_DISABLED_DECORATION,
    }))

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations)
  }, [editor, filePath, getBreakpointsForFile])

  // 监听断点变化
  useEffect(() => {
    updateDecorations()
  }, [breakpoints, updateDecorations])

  // 处理 glyph margin 点击
  useEffect(() => {
    if (!editor || !filePath) return

    const disposable = editor.onMouseDown((e) => {
      // 检查是否点击了 glyph margin (行号左侧区域)
      if (e.target.type === 2) { // GLYPH_MARGIN
        const line = e.target.position?.lineNumber
        if (line) {
          toggleBreakpoint(filePath, line)
        }
      }
      // 也支持点击行号
      else if (e.target.type === 3) { // LINE_NUMBERS
        const line = e.target.position?.lineNumber
        if (line) {
          toggleBreakpoint(filePath, line)
        }
      }
    })

    return () => disposable.dispose()
  }, [editor, filePath, toggleBreakpoint])

  // 清理装饰器
  useEffect(() => {
    return () => {
      if (editor && decorationsRef.current.length > 0) {
        editor.deltaDecorations(decorationsRef.current, [])
        decorationsRef.current = []
      }
    }
  }, [editor])

  return { updateDecorations }
}
