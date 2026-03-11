/**
 * 测试批量编辑功能
 * 
 * 注意：这是集成测试，需要模拟文件系统
 */
import { describe, it, expect } from 'vitest'

describe('批量编辑功能测试', () => {
  describe('编辑排序', () => {
    it('应该从后往前排序编辑操作', () => {
      const edits = [
        { action: 'replace' as const, start_line: 5, end_line: 7, content: 'edit 1' },
        { action: 'replace' as const, start_line: 15, end_line: 17, content: 'edit 2' },
        { action: 'replace' as const, start_line: 10, end_line: 12, content: 'edit 3' },
      ]

      const sorted = [...edits].sort((a, b) => {
        const aLine = a.start_line || 0
        const bLine = b.start_line || 0
        return bLine - aLine
      })

      expect(sorted[0].start_line).toBe(15)
      expect(sorted[1].start_line).toBe(10)
      expect(sorted[2].start_line).toBe(5)
    })

    it('应该正确处理 insert 操作的排序', () => {
      const edits = [
        { action: 'insert' as const, after_line: 5, content: 'insert 1' },
        { action: 'replace' as const, start_line: 10, end_line: 12, content: 'replace 1' },
        { action: 'insert' as const, after_line: 15, content: 'insert 2' },
      ]

      const sorted = [...edits].sort((a, b) => {
        const aLine = (a as any).start_line || (a as any).after_line || 0
        const bLine = (b as any).start_line || (b as any).after_line || 0
        return bLine - aLine
      })

      expect(sorted[0]).toMatchObject({ action: 'insert', after_line: 15 })
      expect(sorted[1]).toMatchObject({ action: 'replace', start_line: 10 })
      expect(sorted[2]).toMatchObject({ action: 'insert', after_line: 5 })
    })
  })

  describe('重叠检测', () => {
    it('应该检测到重叠的 replace 操作', () => {
      const edits = [
        { action: 'replace' as const, start_line: 5, end_line: 10, content: 'edit 1' },
        { action: 'replace' as const, start_line: 8, end_line: 12, content: 'edit 2' },
      ]

      const getEditRange = (edit: typeof edits[0]): [number, number] => {
        if (edit.action === 'replace') {
          return [edit.start_line, edit.end_line]
        }
        return [0, 0]
      }

      const ranges = edits.map((edit, idx) => {
        const [start, end] = getEditRange(edit)
        return [start, end, idx, edit.action] as [number, number, number, string]
      })

      ranges.sort((a, b) => a[0] - b[0])

      let hasOverlap = false
      for (let i = 0; i < ranges.length - 1; i++) {
        const [, e1] = ranges[i]
        const [s2] = ranges[i + 1]
        if (s2 <= e1) {
          hasOverlap = true
          break
        }
      }

      expect(hasOverlap).toBe(true)
    })

    it('不应该将同一行的两个 insert 视为重叠', () => {
      const edits = [
        { action: 'insert' as const, after_line: 10, content: 'insert 1' },
        { action: 'insert' as const, after_line: 10, content: 'insert 2' },
      ]

      const getEditRange = (edit: typeof edits[0]): [number, number] => {
        if (edit.action === 'insert') {
          return [edit.after_line, edit.after_line]
        }
        return [0, 0]
      }

      const ranges = edits.map((edit, idx) => {
        const [start, end] = getEditRange(edit)
        return [start, end, idx, edit.action] as [number, number, number, string]
      })

      ranges.sort((a, b) => a[0] - b[0])

      let hasOverlap = false
      for (let i = 0; i < ranges.length - 1; i++) {
        const [, , , act1] = ranges[i]
        const [s2, e1, , act2] = ranges[i + 1]

        if (act1 === 'insert' && act2 === 'insert') continue

        if (s2 <= e1) {
          hasOverlap = true
          break
        }
      }

      expect(hasOverlap).toBe(false)
    })

    it('不应该将不重叠的编辑视为重叠', () => {
      const edits = [
        { action: 'replace' as const, start_line: 5, end_line: 7, content: 'edit 1' },
        { action: 'replace' as const, start_line: 10, end_line: 12, content: 'edit 2' },
      ]

      const getEditRange = (edit: typeof edits[0]): [number, number] => {
        if (edit.action === 'replace') {
          return [edit.start_line, edit.end_line]
        }
        return [0, 0]
      }

      const ranges = edits.map((edit, idx) => {
        const [start, end] = getEditRange(edit)
        return [start, end, idx, edit.action] as [number, number, number, string]
      })

      ranges.sort((a, b) => a[0] - b[0])

      let hasOverlap = false
      for (let i = 0; i < ranges.length - 1; i++) {
        const [, e1] = ranges[i]
        const [s2] = ranges[i + 1]
        if (s2 <= e1) {
          hasOverlap = true
          break
        }
      }

      expect(hasOverlap).toBe(false)
    })
  })

  describe('批量编辑模拟', () => {
    it('应该正确应用多个 replace 操作', () => {
      const content = 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10'
      let lines = content.split('\n')

      const edits = [
        { action: 'replace' as const, start_line: 2, end_line: 3, content: 'replaced 2-3' },
        { action: 'replace' as const, start_line: 7, end_line: 8, content: 'replaced 7-8' },
      ]

      // 从后往前排序
      const sortedEdits = [...edits].sort((a, b) => b.start_line - a.start_line)

      for (const edit of sortedEdits) {
        const newLines = edit.content.split('\n')
        lines = [
          ...lines.slice(0, edit.start_line - 1),
          ...newLines,
          ...lines.slice(edit.end_line)
        ]
      }

      expect(lines[1]).toBe('replaced 2-3')
      expect(lines[5]).toBe('replaced 7-8')
    })

    it('应该正确应用 insert 操作', () => {
      const content = 'line 1\nline 2\nline 3'
      let lines = content.split('\n')

      const edits = [
        { action: 'insert' as const, after_line: 1, content: 'inserted after 1' },
        { action: 'insert' as const, after_line: 0, content: 'inserted at start' },
      ]

      const sortedEdits = [...edits].sort((a, b) => b.after_line - a.after_line)

      for (const edit of sortedEdits) {
        const newLines = edit.content.split('\n')
        lines = [
          ...lines.slice(0, edit.after_line),
          ...newLines,
          ...lines.slice(edit.after_line)
        ]
      }

      expect(lines[0]).toBe('inserted at start')
      expect(lines[2]).toBe('inserted after 1')
      expect(lines.length).toBe(5)
    })

    it('应该正确应用 delete 操作', () => {
      const content = 'line 1\nline 2\nline 3\nline 4\nline 5'
      let lines = content.split('\n')

      const edits = [
        { action: 'delete' as const, start_line: 2, end_line: 3 },
      ]

      for (const edit of edits) {
        lines = [
          ...lines.slice(0, edit.start_line - 1),
          ...lines.slice(edit.end_line)
        ]
      }

      expect(lines).toEqual(['line 1', 'line 4', 'line 5'])
    })

    it('应该正确应用混合操作', () => {
      const content = 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8'
      let lines = content.split('\n')

      const edits = [
        { action: 'replace' as const, start_line: 2, end_line: 3, content: 'replaced 2-3' },
        { action: 'insert' as const, after_line: 5, content: 'inserted after 5' },
        { action: 'delete' as const, start_line: 7, end_line: 8 },
      ]

      // 从后往前排序
      const sortedEdits = [...edits].sort((a, b) => {
        const aLine = (a as any).start_line || (a as any).after_line || 0
        const bLine = (b as any).start_line || (b as any).after_line || 0
        return bLine - aLine
      })

      for (const edit of sortedEdits) {
        if (edit.action === 'replace') {
          const newLines = edit.content.split('\n')
          lines = [
            ...lines.slice(0, edit.start_line - 1),
            ...newLines,
            ...lines.slice(edit.end_line)
          ]
        } else if (edit.action === 'insert') {
          const newLines = edit.content.split('\n')
          lines = [
            ...lines.slice(0, edit.after_line),
            ...newLines,
            ...lines.slice(edit.after_line)
          ]
        } else if (edit.action === 'delete') {
          lines = [
            ...lines.slice(0, edit.start_line - 1),
            ...lines.slice(edit.end_line)
          ]
        }
      }

      expect(lines.length).toBe(6) // 8 - 1 (replace 2->1) + 1 (inserted) - 2 (deleted)
      expect(lines[1]).toBe('replaced 2-3')
    })
  })
})
