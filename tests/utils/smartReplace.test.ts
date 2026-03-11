/**
 * 测试 fast-edit 精华功能：智能警告系统
 */
import { describe, it, expect } from 'vitest'
import { checkLineReplaceWarnings } from '../../src/renderer/utils/smartReplace'

describe('Fast-Edit 智能警告系统', () => {
  describe('重复行检测', () => {
    it('应该检测到 off-by-one 错误（最后一行与下一行重复）', () => {
      const oldLines = ['line 1', 'line 2', 'line 3']
      const newLines = ['new line 1', 'new line 2', 'this is a duplicated long line']
      const resultLines = ['new line 1', 'new line 2', 'this is a duplicated long line', 'this is a duplicated long line', 'line 5']
      
      const warnings = checkLineReplaceWarnings(oldLines, newLines, resultLines, 1, 3)
      
      expect(warnings).toHaveLength(1)
      expect(warnings[0].type).toBe('DUPLICATE_LINE')
      expect(warnings[0].message).toContain('off-by-one')
    })

    it('不应该对短行（<10字符）报重复警告', () => {
      const oldLines = ['a', 'b']
      const newLines = ['x', 'y']
      const resultLines = ['x', 'y', 'y']
      
      const warnings = checkLineReplaceWarnings(oldLines, newLines, resultLines, 1, 2)
      
      expect(warnings).toHaveLength(0)
    })

    it('不应该对不重复的行报警', () => {
      const oldLines = ['line 1', 'line 2']
      const newLines = ['new line 1', 'new line 2']
      const resultLines = ['new line 1', 'new line 2', 'different line']
      
      const warnings = checkLineReplaceWarnings(oldLines, newLines, resultLines, 1, 2)
      
      expect(warnings).toHaveLength(0)
    })
  })

  describe('括号平衡检测', () => {
    it('应该检测到括号不平衡（增加了开括号）', () => {
      const oldLines = ['function test() {', '  return 1', '}']
      const newLines = ['function test() {', '  if (true) {', '    return 1', '}']
      const resultLines = newLines
      
      const warnings = checkLineReplaceWarnings(oldLines, newLines, resultLines, 1, 3)
      
      expect(warnings.length).toBeGreaterThan(0)
      const bracketWarning = warnings.find(w => w.type === 'BRACKET_BALANCE')
      expect(bracketWarning).toBeDefined()
      expect(bracketWarning?.message).toContain('more opens')
    })

    it('应该检测到括号不平衡（增加了闭括号）', () => {
      const oldLines = ['function test() {', '  return 1']
      const newLines = ['function test() {', '  return 1', '}', '}']
      const resultLines = newLines
      
      const warnings = checkLineReplaceWarnings(oldLines, newLines, resultLines, 1, 2)
      
      const bracketWarning = warnings.find(w => w.type === 'BRACKET_BALANCE')
      expect(bracketWarning).toBeDefined()
      expect(bracketWarning?.message).toContain('more closes')
    })

    it('不应该对平衡的括号报警', () => {
      const oldLines = ['function test() {', '  return 1', '}']
      const newLines = ['function test() {', '  if (true) { return 1 }', '}']
      const resultLines = newLines
      
      const warnings = checkLineReplaceWarnings(oldLines, newLines, resultLines, 1, 3)
      
      const bracketWarning = warnings.find(w => w.type === 'BRACKET_BALANCE')
      expect(bracketWarning).toBeUndefined()
    })

    it('应该忽略字符串中的括号', () => {
      const oldLines = ['const str = "test"']
      const newLines = ['const str = "test { } ( )"']
      const resultLines = newLines
      
      const warnings = checkLineReplaceWarnings(oldLines, newLines, resultLines, 1, 1)
      
      const bracketWarning = warnings.find(w => w.type === 'BRACKET_BALANCE')
      expect(bracketWarning).toBeUndefined()
    })

    it('应该处理转义字符', () => {
      const oldLines = ['const str = "test"']
      const newLines = ['const str = "test \\"quote\\""']
      const resultLines = newLines
      
      const warnings = checkLineReplaceWarnings(oldLines, newLines, resultLines, 1, 1)
      
      // 不应该因为转义的引号而误报
      expect(warnings).toHaveLength(0)
    })
  })

  describe('综合场景', () => {
    it('应该同时检测多个问题', () => {
      const oldLines = ['function test() {', '  return 1', '}']
      const newLines = ['function test() {', '  if (true) {', '    return 1', 'duplicate line']
      const resultLines = ['function test() {', '  if (true) {', '    return 1', 'duplicate line', 'duplicate line']
      
      const warnings = checkLineReplaceWarnings(oldLines, newLines, resultLines, 1, 3)
      
      expect(warnings.length).toBeGreaterThanOrEqual(2)
      expect(warnings.some(w => w.type === 'DUPLICATE_LINE')).toBe(true)
      expect(warnings.some(w => w.type === 'BRACKET_BALANCE')).toBe(true)
    })
  })
})
