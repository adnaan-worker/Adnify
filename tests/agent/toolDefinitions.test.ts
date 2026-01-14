/**
 * 工具定义测试
 * 测试 Zod Schema 验证和工具定义
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  toolRegistry,
  getToolApprovalType,
  TOOL_SCHEMAS,
  builtinToolProvider,
  setToolLoadingContext,
  initializeToolProviders,
} from '../../src/renderer/agent/tools'

// 从 schemas 中获取具体的 schema
const ReadFileSchema = TOOL_SCHEMAS.read_file
const EditFileSchema = TOOL_SCHEMAS.edit_file
const RunCommandSchema = TOOL_SCHEMAS.run_command
const CreatePlanSchema = TOOL_SCHEMAS.create_plan

describe('Tool Definitions', () => {
  beforeEach(() => {
    initializeToolProviders()
  })

  describe('getToolDefinitions with context', () => {
    it('should return core tools in agent mode', () => {
      setToolLoadingContext({ mode: 'agent' })
      const tools = builtinToolProvider.getToolDefinitions()
      expect(tools.length).toBeGreaterThan(0)
      expect(tools.find(t => t.name === 'read_file')).toBeDefined()
      expect(tools.find(t => t.name === 'edit_file')).toBeDefined()
      expect(tools.find(t => t.name === 'run_command')).toBeDefined()
    })

    it('should include plan tools in plan mode', () => {
      setToolLoadingContext({ mode: 'plan' })
      const tools = builtinToolProvider.getToolDefinitions()
      expect(tools.find(t => t.name === 'create_plan')).toBeDefined()
      expect(tools.find(t => t.name === 'update_plan')).toBeDefined()
    })

    it('should exclude plan tools in agent mode', () => {
      setToolLoadingContext({ mode: 'agent' })
      const tools = builtinToolProvider.getToolDefinitions()
      expect(tools.find(t => t.name === 'create_plan')).toBeUndefined()
      expect(tools.find(t => t.name === 'update_plan')).toBeUndefined()
    })

    it('should return no tools in chat mode', () => {
      setToolLoadingContext({ mode: 'chat' })
      const tools = builtinToolProvider.getToolDefinitions()
      expect(tools.length).toBe(0)
    })

    it('should include role-specific tools when templateId is set', () => {
      setToolLoadingContext({ mode: 'agent', templateId: 'uiux-designer' })
      const tools = builtinToolProvider.getToolDefinitions()
      expect(tools.find(t => t.name === 'uiux_search')).toBeDefined()
    })

    it('should not include role-specific tools without templateId', () => {
      setToolLoadingContext({ mode: 'agent' })
      const tools = builtinToolProvider.getToolDefinitions()
      expect(tools.find(t => t.name === 'uiux_search')).toBeUndefined()
    })
  })

  describe('getToolApprovalType', () => {
    it('should return terminal for run_command', () => {
      expect(getToolApprovalType('run_command')).toBe('terminal')
    })

    it('should return dangerous for delete_file_or_folder', () => {
      expect(getToolApprovalType('delete_file_or_folder')).toBe('dangerous')
    })

    it('should return none for read tools', () => {
      expect(getToolApprovalType('read_file')).toBe('none')
      expect(getToolApprovalType('list_directory')).toBe('none')
    })
  })
})

describe('Tool Schema Validation', () => {
  describe('ReadFileSchema', () => {
    it('should validate valid path', () => {
      const result = ReadFileSchema.safeParse({ path: 'src/main.ts' })
      expect(result.success).toBe(true)
    })

    it('should validate with line range', () => {
      const result = ReadFileSchema.safeParse({
        path: 'src/main.ts',
        start_line: 1,
        end_line: 10,
      })
      expect(result.success).toBe(true)
    })

    it('should reject empty path', () => {
      const result = ReadFileSchema.safeParse({ path: '' })
      expect(result.success).toBe(false)
    })

    it('should reject invalid line range', () => {
      const result = ReadFileSchema.safeParse({
        path: 'src/main.ts',
        start_line: 10,
        end_line: 5,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('EditFileSchema', () => {
    it('should validate valid old_string/new_string', () => {
      const result = EditFileSchema.safeParse({
        path: 'src/main.ts',
        old_string: 'const a = 1;',
        new_string: 'const a = 2;',
      })
      expect(result.success).toBe(true)
    })

    it('should reject missing old_string', () => {
      const result = EditFileSchema.safeParse({
        path: 'src/main.ts',
        new_string: 'const a = 2;',
      })
      expect(result.success).toBe(false)
    })

    it('should reject missing new_string', () => {
      const result = EditFileSchema.safeParse({
        path: 'src/main.ts',
        old_string: 'const a = 1;',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('RunCommandSchema', () => {
    it('should validate valid command', () => {
      const result = RunCommandSchema.safeParse({ command: 'npm install' })
      expect(result.success).toBe(true)
    })

    it('should validate with cwd and timeout', () => {
      const result = RunCommandSchema.safeParse({
        command: 'npm test',
        cwd: './src',
        timeout: 60,
      })
      expect(result.success).toBe(true)
    })

    it('should reject empty command', () => {
      const result = RunCommandSchema.safeParse({ command: '' })
      expect(result.success).toBe(false)
    })

    it('should reject timeout over 600', () => {
      const result = RunCommandSchema.safeParse({
        command: 'npm test',
        timeout: 1000,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('CreatePlanSchema', () => {
    it('should validate valid plan', () => {
      const result = CreatePlanSchema.safeParse({
        items: [
          { title: 'Step 1', description: 'First step' },
          { title: 'Step 2' },
        ],
      })
      expect(result.success).toBe(true)
    })

    it('should reject empty items', () => {
      const result = CreatePlanSchema.safeParse({ items: [] })
      expect(result.success).toBe(false)
    })

    it('should reject items without title', () => {
      const result = CreatePlanSchema.safeParse({
        items: [{ description: 'No title' }],
      })
      expect(result.success).toBe(false)
    })
  })
})

describe('toolRegistry.validate', () => {
  it('should return success for valid args', () => {
    const result = toolRegistry.validate('read_file', { path: 'src/main.ts' })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ path: 'src/main.ts' })
  })

  it('should return error for invalid args', () => {
    const result = toolRegistry.validate('read_file', { path: '' })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('should return error for unknown tool', () => {
    const result = toolRegistry.validate('unknown_tool', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown tool')
  })
})
