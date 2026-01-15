import { describe, it, expect } from 'vitest'
import { toFullPath, isPathInWorkspace, validatePath } from '../src/shared/utils/pathUtils'

describe('pathUtils', () => {
  const workspacePath = 'C:\\Users\\test\\workspace'

  describe('toFullPath', () => {
    it('should handle "." as workspace root', () => {
      expect(toFullPath('.', workspacePath)).toBe(workspacePath)
    })

    it('should handle "./" prefix', () => {
      expect(toFullPath('./src/main.ts', workspacePath)).toBe('C:\\Users\\test\\workspace\\src/main.ts')
    })

    it('should handle relative path without "./"', () => {
      expect(toFullPath('src/main.ts', workspacePath)).toBe('C:\\Users\\test\\workspace\\src/main.ts')
    })

    it('should handle absolute path', () => {
      const absolutePath = 'C:\\Users\\test\\workspace\\src\\main.ts'
      expect(toFullPath(absolutePath, workspacePath)).toBe(absolutePath)
    })

    it('should handle empty relative path after "./"', () => {
      expect(toFullPath('./', workspacePath)).toBe(workspacePath)
    })
  })

  describe('isPathInWorkspace', () => {
    it('should accept "." as workspace root', () => {
      expect(isPathInWorkspace('.', workspacePath)).toBe(true)
    })

    it('should accept "./" prefix paths', () => {
      expect(isPathInWorkspace('./src/main.ts', workspacePath)).toBe(true)
    })

    it('should accept relative paths', () => {
      expect(isPathInWorkspace('src/main.ts', workspacePath)).toBe(true)
    })

    it('should accept absolute paths in workspace', () => {
      expect(isPathInWorkspace('C:\\Users\\test\\workspace\\src\\main.ts', workspacePath)).toBe(true)
    })

    it('should reject paths outside workspace', () => {
      expect(isPathInWorkspace('C:\\Users\\other\\file.ts', workspacePath)).toBe(false)
    })
  })

  describe('validatePath', () => {
    it('should validate "." as workspace root', () => {
      const result = validatePath('.', workspacePath)
      expect(result.valid).toBe(true)
      expect(result.sanitizedPath).toBe(workspacePath)
    })

    it('should validate "./" prefix paths', () => {
      const result = validatePath('./src/main.ts', workspacePath)
      expect(result.valid).toBe(true)
      expect(result.sanitizedPath).toContain('src')
    })

    it('should validate relative paths', () => {
      const result = validatePath('src/main.ts', workspacePath)
      expect(result.valid).toBe(true)
    })

    it('should reject path traversal', () => {
      const result = validatePath('../../../etc/passwd', workspacePath)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('traversal')
    })
  })
})
